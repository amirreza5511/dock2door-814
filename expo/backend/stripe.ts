import Stripe from 'stripe';
import type { Context as HonoContext } from 'hono';
import { env } from '@/backend/env';
import { queryRow, withTransaction } from '@/backend/db';
import { db } from '@/backend/db';
import { computeCommission, getCommissionPercentage, getModuleForPayment, recordProviderEarning } from '@/backend/commission';
import { notifyCompanyMembers } from '@/backend/events';

export const stripe = env.stripeSecretKey
  ? new Stripe(env.stripeSecretKey, {
      apiVersion: '2026-02-25.clover',
    })
  : null;

interface StripePaymentRow {
  id: string;
  booking_id: string | null;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  currency: string;
  stripe_payment_intent_id: string | null;
  status: string;
  company_id: string | null;
}

function normalizeStripeStatus(status: Stripe.PaymentIntent.Status): 'Pending' | 'Paid' | 'Failed' | 'Cancelled' | 'Refunded' {
  if (status === 'succeeded') {
    return 'Paid';
  }

  if (status === 'canceled') {
    return 'Cancelled';
  }

  if (status === 'requires_payment_method') {
    return 'Failed';
  }

  return 'Pending';
}

export async function syncPaymentIntent(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const paymentId = paymentIntent.metadata.paymentId;
  if (!paymentId) {
    return;
  }

  const payment = await queryRow<StripePaymentRow>('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!payment) {
    return;
  }

  const nextStatus = normalizeStripeStatus(paymentIntent.status);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE payments
       SET status = $1,
           stripe_payment_intent_id = $2,
           paid_at = CASE WHEN $1 = 'Paid' THEN NOW() ELSE paid_at END,
           updated_at = NOW()
       WHERE id = $3`,
      [nextStatus, paymentIntent.id, paymentId],
    );

    if (nextStatus === 'Paid') {
      const moduleKey = await getModuleForPayment(payment.id);
      const percentage = await getCommissionPercentage(moduleKey);
      const gross = Number(payment.gross_amount);
      const { commission, net } = computeCommission(gross, percentage);

      await client.query(
        `UPDATE payments SET commission_amount = $1, net_amount = $2, updated_at = NOW() WHERE id = $3`,
        [commission, net, payment.id],
      );

      const invoiceNumber = `INV-${new Date().getUTCFullYear()}-${paymentId.slice(0, 8).toUpperCase()}`;
      await client.query(
        `INSERT INTO invoices (id, payment_id, company_id, invoice_number, subtotal_amount, commission_amount, total_amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Issued')
         ON CONFLICT (payment_id) DO NOTHING`,
        [
          crypto.randomUUID(),
          payment.id,
          payment.company_id,
          invoiceNumber,
          gross,
          commission,
          gross,
          payment.currency,
        ],
      );

      const providerCompanyId = payment.booking_id
        ? (await client.query<{ provider_company_id: string | null }>(
            `SELECT provider_company_id FROM bookings WHERE id = $1`,
            [payment.booking_id],
          )).rows[0]?.provider_company_id ?? null
        : null;

      await recordProviderEarning(client, {
        paymentId: payment.id,
        providerCompanyId,
        netAmount: net,
        currency: payment.currency,
      });

      if (payment.company_id) {
        await notifyCompanyMembers(client, {
          companyId: payment.company_id,
          eventKey: 'payment.succeeded',
          title: 'Payment received',
          body: `Payment of ${gross.toFixed(2)} ${payment.currency.toUpperCase()} was successful.`,
          metadata: { paymentId: payment.id, bookingId: payment.booking_id },
        });
      }
      if (providerCompanyId && providerCompanyId !== payment.company_id) {
        await notifyCompanyMembers(client, {
          companyId: providerCompanyId,
          eventKey: 'payment.provider_paid',
          title: 'Payout pending',
          body: `Net earnings of ${net.toFixed(2)} ${payment.currency.toUpperCase()} added to your ledger.`,
          metadata: { paymentId: payment.id },
        });
      }
    } else if (nextStatus === 'Failed' && payment.company_id) {
      await notifyCompanyMembers(client, {
        companyId: payment.company_id,
        eventKey: 'payment.failed',
        title: 'Payment failed',
        body: 'A payment attempt failed. Please retry or update payment details.',
        metadata: { paymentId: payment.id },
      });
    }
  });
}

export async function stripeWebhookHandler(context: HonoContext): Promise<Response> {
  if (!stripe || !env.stripeWebhookSecret) {
    return context.json({ error: 'Stripe webhook is not configured' }, 503);
  }

  const signature = context.req.header('stripe-signature');
  if (!signature) {
    return context.json({ error: 'Missing stripe signature' }, 400);
  }

  const payload = await context.req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, env.stripeWebhookSecret);
  } catch (error) {
    console.log('[Stripe] Webhook signature verification failed', error);
    return context.json({ error: 'Invalid webhook signature' }, 400);
  }

  const deliveryId = event.id;
  const existing = await queryRow<{ id: string; status: string }>(
    'SELECT id, status FROM webhook_deliveries WHERE id = $1',
    [deliveryId],
  );
  if (existing && existing.status === 'Processed') {
    return context.json({ received: true, idempotent: true });
  }

  if (!existing) {
    await db.query(
      `INSERT INTO webhook_deliveries (id, source, event_type, payload, status)
       VALUES ($1, 'stripe', $2, $3::jsonb, 'Received')`,
      [deliveryId, event.type, JSON.stringify(event)],
    );
  }

  try {
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
      await syncPaymentIntent(event.data.object as Stripe.PaymentIntent);
    }
    await db.query(
      `UPDATE webhook_deliveries SET status = 'Processed', processed_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
      [deliveryId],
    );
  } catch (error) {
    console.log('[Stripe] Webhook processing failed', error);
    await db.query(
      `UPDATE webhook_deliveries SET status = 'Failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`,
      [deliveryId, error instanceof Error ? error.message : String(error)],
    );
    throw error;
  }

  return context.json({ received: true });
}
