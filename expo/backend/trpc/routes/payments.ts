import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { requireAdmin, requireAuthUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { stripe } from '@/backend/stripe';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { env } from '@/backend/env';
import { computeCommission, getCommissionPercentage } from '@/backend/commission';
import { findIdempotentResponse, storeIdempotentResponse } from '@/backend/idempotency';

interface PaymentRow {
  id: string;
  company_id: string | null;
  booking_id: string | null;
  gross_amount: string;
  commission_amount: string;
  net_amount: string;
  currency: string;
  stripe_payment_intent_id: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export const paymentsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    const rows = user.role === 'Admin' || user.role === 'SuperAdmin'
      ? await queryRows<PaymentRow>('SELECT * FROM payments WHERE deleted_at IS NULL ORDER BY created_at DESC', [])
      : await queryRows<PaymentRow>('SELECT * FROM payments WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [user.companyId]);
    return rows;
  }),
  getPayment: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const row = user.role === 'Admin' || user.role === 'SuperAdmin'
      ? await queryRow<PaymentRow>('SELECT * FROM payments WHERE id = $1 AND deleted_at IS NULL', [input.id])
      : await queryRow<PaymentRow>('SELECT * FROM payments WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [input.id, user.companyId]);
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Payment not found' });
    }
    return row;
  }),
  listInvoices: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    return user.role === 'Admin' || user.role === 'SuperAdmin'
      ? queryRows('SELECT * FROM invoices WHERE deleted_at IS NULL ORDER BY created_at DESC', [])
      : queryRows('SELECT * FROM invoices WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [user.companyId]);
  }),
  getInvoice: protectedProcedure.input(z.object({ paymentId: z.string().optional(), id: z.string().optional() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!input.paymentId && !input.id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invoice identifier is required' });
    }
    const row = user.role === 'Admin' || user.role === 'SuperAdmin'
      ? await queryRow(input.id
        ? 'SELECT * FROM invoices WHERE id = $1 AND deleted_at IS NULL'
        : 'SELECT * FROM invoices WHERE payment_id = $1 AND deleted_at IS NULL', [input.id ?? input.paymentId])
      : await queryRow(input.id
        ? 'SELECT invoices.* FROM invoices WHERE invoices.id = $1 AND invoices.company_id = $2 AND invoices.deleted_at IS NULL'
        : 'SELECT invoices.* FROM invoices INNER JOIN payments ON payments.id = invoices.payment_id WHERE invoices.payment_id = $1 AND payments.company_id = $2 AND invoices.deleted_at IS NULL', [input.id ?? input.paymentId, user.companyId]);
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
    }
    return row;
  }),
  updateInvoiceStatus: protectedProcedure.input(z.object({ id: z.string(), status: z.enum(['Draft', 'Issued', 'Paid', 'Void']) })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    await withTransaction(async (client) => {
      await client.query('UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2', [input.status, input.id]);
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: 'invoices', entityId: input.id, action: 'status_update', newValue: { status: input.status }, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  listPayouts: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    return user.role === 'Admin' || user.role === 'SuperAdmin'
      ? queryRows('SELECT * FROM payouts WHERE deleted_at IS NULL ORDER BY created_at DESC', [])
      : queryRows('SELECT * FROM payouts WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [user.companyId]);
  }),
  getPayout: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const row = user.role === 'Admin' || user.role === 'SuperAdmin'
      ? await queryRow('SELECT * FROM payouts WHERE id = $1 AND deleted_at IS NULL', [input.id])
      : await queryRow('SELECT * FROM payouts WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [input.id, user.companyId]);
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Payout not found' });
    }
    return row;
  }),
  updatePayoutStatus: protectedProcedure.input(z.object({ id: z.string(), status: z.enum(['Pending', 'Processing', 'Paid', 'Failed', 'Cancelled']) })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    await withTransaction(async (client) => {
      await client.query('UPDATE payouts SET status = $1, updated_at = NOW() WHERE id = $2', [input.status, input.id]);
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: 'payouts', entityId: input.id, action: 'status_update', newValue: { status: input.status }, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  createIntent: protectedProcedure.input(z.object({ paymentId: z.string().optional(), bookingId: z.string().nullable().optional(), amount: z.number().positive(), currency: z.string().default('cad'), idempotencyKey: z.string().min(8).max(128).optional() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!stripe) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe is not configured' });
    }

    if (input.idempotencyKey) {
      const cached = await findIdempotentResponse<{ paymentId: string; clientSecret: string | null; publishableKeyRequired: boolean; currency: string }>(input.idempotencyKey, 'payments.createIntent');
      if (cached) {
        return cached;
      }
    }

    const paymentId = input.paymentId ?? crypto.randomUUID();
    const percentage = await getCommissionPercentage('warehouse');
    const { commission: commissionAmount, net: netAmount } = computeCommission(input.amount, percentage);

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(input.amount * 100),
      currency: input.currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        paymentId,
        bookingId: input.bookingId ?? '',
        companyId: user.companyId ?? '',
      },
    });

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO payments (id, company_id, booking_id, gross_amount, commission_amount, net_amount, currency, stripe_payment_intent_id, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', $9::jsonb)
         ON CONFLICT (id) DO UPDATE SET gross_amount = EXCLUDED.gross_amount, commission_amount = EXCLUDED.commission_amount, net_amount = EXCLUDED.net_amount, stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id, updated_at = NOW()`,
        [paymentId, user.companyId, input.bookingId ?? null, input.amount, commissionAmount, netAmount, input.currency, intent.id, JSON.stringify({ source: 'stripe' })],
      );
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId: user.companyId,
        entityName: 'payments',
        entityId: paymentId,
        action: 'create_intent',
        newValue: { amount: input.amount, currency: input.currency, stripePaymentIntentId: intent.id },
        requestId: ctx.requestId,
      });
    });

    const response = { paymentId, clientSecret: intent.client_secret, publishableKeyRequired: true, currency: env.stripeCurrency };

    if (input.idempotencyKey) {
      await withTransaction(async (client) => {
        await storeIdempotentResponse(client, {
          key: input.idempotencyKey!,
          scope: 'payments.createIntent',
          userId: user.id,
          response,
        });
      });
    }

    return response;
  }),

  issueCreditNote: protectedProcedure.input(z.object({
    invoiceId: z.string(),
    amount: z.number().positive(),
    reason: z.string().max(500).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    const invoice = await queryRow<{ id: string; company_id: string | null; currency: string; total_amount: string }>(
      `SELECT id, company_id, currency, total_amount::text AS total_amount FROM invoices WHERE id = $1 AND deleted_at IS NULL`,
      [input.invoiceId],
    );
    if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
    if (input.amount > Number(invoice.total_amount)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Credit note exceeds invoice total' });
    }
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO credit_notes (id, invoice_id, amount, currency, reason) VALUES ($1, $2, $3, $4, $5)`,
        [id, invoice.id, input.amount, invoice.currency, input.reason ?? null],
      );
      await createAuditLog(client, {
        actorUserId: admin.id, companyId: invoice.company_id,
        entityName: 'credit_notes', entityId: id, action: 'create',
        newValue: { invoiceId: invoice.id, amount: input.amount, reason: input.reason ?? null },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  listCreditNotes: protectedProcedure.input(z.object({ invoiceId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const invoice = await queryRow<{ company_id: string | null }>(`SELECT company_id FROM invoices WHERE id = $1`, [input.invoiceId]);
    if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && invoice.company_id !== user.companyId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    return queryRows(
      `SELECT id, invoice_id, amount::text AS amount, currency, reason, created_at FROM credit_notes WHERE invoice_id = $1 ORDER BY created_at DESC`,
      [input.invoiceId],
    );
  }),

  renderInvoice: protectedProcedure.input(z.object({ invoiceId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const invoice = await queryRow<{ id: string; invoice_number: string; payment_id: string; company_id: string | null; subtotal_amount: string; commission_amount: string; total_amount: string; currency: string; status: string; created_at: string }>(
      `SELECT id, invoice_number, payment_id, company_id,
              subtotal_amount::text AS subtotal_amount,
              commission_amount::text AS commission_amount,
              total_amount::text AS total_amount,
              currency, status::text AS status, created_at
       FROM invoices WHERE id = $1 AND deleted_at IS NULL`,
      [input.invoiceId],
    );
    if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && invoice.company_id !== user.companyId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    const company = invoice.company_id
      ? await queryRow<{ name: string; address: string; city: string; province: string | null; postal_code: string | null }>(`SELECT name, address, city, province, postal_code FROM companies WHERE id = $1`, [invoice.company_id])
      : null;
    const credits = await queryRows<{ amount: string; reason: string | null; created_at: string }>(
      `SELECT amount::text AS amount, reason, created_at FROM credit_notes WHERE invoice_id = $1 ORDER BY created_at ASC`,
      [invoice.id],
    );
    const creditTotal = credits.reduce((s, c) => s + Number(c.amount), 0);
    const net = Number(invoice.total_amount) - creditTotal;
    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${invoice.invoice_number}</title><style>body{font-family:-apple-system,system-ui,sans-serif;padding:40px;color:#111}h1{margin:0 0 6px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{padding:10px;border-bottom:1px solid #eee;text-align:left}.right{text-align:right}.muted{color:#666;font-size:12px}.total{font-weight:700;font-size:18px}</style></head><body><h1>Invoice ${invoice.invoice_number}</h1><div class="muted">${new Date(invoice.created_at).toLocaleDateString()} · Status: ${invoice.status}</div>${company ? `<div style="margin-top:16px"><strong>${company.name}</strong><br/>${company.address}<br/>${company.city}${company.province ? ', ' + company.province : ''} ${company.postal_code ?? ''}</div>` : ''}<table><thead><tr><th>Description</th><th class="right">Amount</th></tr></thead><tbody><tr><td>Subtotal</td><td class="right">${Number(invoice.subtotal_amount).toFixed(2)}</td></tr><tr><td>Platform commission</td><td class="right">${Number(invoice.commission_amount).toFixed(2)}</td></tr>${credits.map((c) => `<tr><td>Credit${c.reason ? ' — ' + c.reason : ''}</td><td class="right">- ${Number(c.amount).toFixed(2)}</td></tr>`).join('')}<tr class="total"><td>Total due</td><td class="right">${net.toFixed(2)} ${invoice.currency.toUpperCase()}</td></tr></tbody></table></body></html>`;
    return { invoice, credits, creditTotal, net, html };
  }),

  refund: protectedProcedure.input(z.object({
    paymentId: z.string(),
    amount: z.number().positive(),
    reason: z.string().max(500).optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    if (!stripe) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe is not configured' });
    }
    if (input.idempotencyKey) {
      const cached = await findIdempotentResponse<{ id: string }>(input.idempotencyKey, 'payments.refund');
      if (cached) return cached;
    }
    const payment = await queryRow<PaymentRow>('SELECT * FROM payments WHERE id = $1 AND deleted_at IS NULL', [input.paymentId]);
    if (!payment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Payment not found' });
    if (!payment.stripe_payment_intent_id) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Payment has no Stripe reference' });
    }
    const stripeRefund = await stripe.refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      amount: Math.round(input.amount * 100),
      reason: 'requested_by_customer',
    });
    const refundId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO refunds (id, payment_id, amount, currency, reason, stripe_refund_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [refundId, payment.id, input.amount, payment.currency, input.reason ?? null, stripeRefund.id, stripeRefund.status ?? 'Pending'],
      );
      await client.query(
        `UPDATE payments SET status = 'Refunded', updated_at = NOW() WHERE id = $1`,
        [payment.id],
      );
      await createAuditLog(client, {
        actorUserId: admin.id, companyId: payment.company_id,
        entityName: 'refunds', entityId: refundId, action: 'create',
        newValue: { amount: input.amount, stripeRefundId: stripeRefund.id, reason: input.reason },
        requestId: ctx.requestId,
      });
      if (input.idempotencyKey) {
        await storeIdempotentResponse(client, {
          key: input.idempotencyKey, scope: 'payments.refund', userId: admin.id, response: { id: refundId },
        });
      }
    });
    return { id: refundId };
  }),
});
