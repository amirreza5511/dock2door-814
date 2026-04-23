// Supabase Edge Function — stripe-webhook
// Receives Stripe webhook events (payment_intent.succeeded, charge.refunded, etc.)
// Verifies the signature, then calls the `public.record_payment` SECURITY DEFINER RPC.
//
// Required env (set via `supabase secrets set`):
//   STRIPE_SECRET_KEY         — Stripe restricted / secret key
//   STRIPE_WEBHOOK_SECRET     — whsec_... from the Stripe dashboard
//   SUPABASE_URL              — project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Stripe metadata convention:
//   payment_intent.metadata.invoice_id  — Dock2Door invoice UUID
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const stripe = STRIPE_SECRET
  ? new Stripe(STRIPE_SECRET, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() })
  : null;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
  if (!stripe) return new Response('stripe_not_configured', { status: 500 });

  const signature = req.headers.get('stripe-signature') ?? '';
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.log('[stripe-webhook] signature verification failed', (err as Error).message);
    return new Response('invalid_signature', { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = pi.metadata?.invoice_id ?? null;
        if (!invoiceId) {
          console.log('[stripe-webhook] missing invoice_id metadata on', pi.id);
          break;
        }
        const gross = (pi.amount_received ?? pi.amount ?? 0) / 100;
        const { error } = await admin.rpc('record_payment', {
          p_invoice_id: invoiceId,
          p_gross: gross,
          p_currency: (pi.currency ?? 'cad').toUpperCase(),
          p_stripe_intent: pi.id,
          p_method: pi.payment_method_types?.[0] ?? 'card',
        });
        if (error) {
          console.log('[stripe-webhook] record_payment error', error.message);
          return new Response('rpc_failed', { status: 500 });
        }
        break;
      }
      case 'charge.refunded': {
        const ch = event.data.object as Stripe.Charge;
        const intentId = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id;
        if (!intentId) break;
        const { data: payment } = await admin
          .from('payments')
          .select('id, gross_amount')
          .eq('stripe_payment_intent_id', intentId)
          .maybeSingle();
        if (!payment) break;
        const refunded = (ch.amount_refunded ?? 0) / 100;
        const status = refunded >= Number(payment.gross_amount) ? 'Refunded' : 'PartiallyRefunded';
        await admin.from('payments').update({ status, refunded_at: new Date().toISOString() }).eq('id', payment.id);
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await admin.from('payments')
          .update({ status: 'Failed' })
          .eq('stripe_payment_intent_id', pi.id);
        break;
      }
      default:
        // Acknowledge other events (e.g. payout.*, account.*) without side-effects.
        console.log('[stripe-webhook] unhandled event', event.type);
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.log('[stripe-webhook] fatal', err);
    return new Response('internal', { status: 500 });
  }
});
