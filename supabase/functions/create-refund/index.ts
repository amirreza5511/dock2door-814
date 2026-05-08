// Supabase Edge Function — create-refund
// Initiates a Stripe refund for a payment, then records it via the
// SECURITY DEFINER `admin_initiate_refund` RPC (which audits + flips
// payments.status to Refunded / PartiallyRefunded).
//
// Required env (`supabase secrets set`):
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Deploy:
//   supabase functions deploy create-refund
//
// Body: { payment_id: string; amount?: number; reason: string }
// Auth: caller must be admin (RPC enforces require_admin()).
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const stripe = STRIPE_SECRET
  ? new Stripe(STRIPE_SECRET, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() })
  : null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing_authorization' }, 401);

  let payload: { payment_id?: string; amount?: number; reason?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const paymentId = payload.payment_id?.trim();
  const reason = (payload.reason ?? '').trim();
  if (!paymentId) return json({ error: 'payment_id_required' }, 400);
  if (!reason) return json({ error: 'reason_required' }, 400);

  // Auth-scoped client (RLS) for caller identity + RPC enforcement.
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: 'unauthorized' }, 401);

  // Service-role client to read the payment for refund amount/intent.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: payment, error: payErr } = await admin
    .from('payments')
    .select('id, gross_amount, currency, stripe_payment_intent_id, stripe_charge_id, status')
    .eq('id', paymentId)
    .single();

  if (payErr || !payment) return json({ error: 'payment_not_found', detail: payErr?.message }, 404);

  const grossNum = Number(payment.gross_amount ?? 0);
  const amountNum = typeof payload.amount === 'number' && payload.amount > 0
    ? Number(payload.amount)
    : grossNum;

  if (amountNum <= 0 || amountNum > grossNum) {
    return json({ error: 'invalid_amount', max: grossNum }, 400);
  }

  // Initiate Stripe refund (best-effort). If no Stripe linkage, we still
  // proceed to record the refund row for manual reconciliation.
  let stripeRefundId: string | null = null;
  let stripeError: string | null = null;
  if (stripe && (payment.stripe_payment_intent_id || payment.stripe_charge_id)) {
    try {
      const refund = await stripe.refunds.create({
        ...(payment.stripe_payment_intent_id
          ? { payment_intent: payment.stripe_payment_intent_id }
          : { charge: payment.stripe_charge_id! }),
        amount: Math.round(amountNum * 100),
        reason: 'requested_by_customer',
        metadata: { payment_id: paymentId, reason },
      });
      stripeRefundId = refund.id;
    } catch (err) {
      stripeError = err instanceof Error ? err.message : String(err);
    }
  }

  // Record refund + audit via RPC (require_admin enforced server-side).
  const { data: refundId, error: rpcErr } = await userClient.rpc('admin_initiate_refund', {
    p_payment_id: paymentId,
    p_amount: amountNum,
    p_reason: reason,
  });

  if (rpcErr) {
    return json({
      error: 'rpc_failed',
      detail: rpcErr.message,
      stripe_refund_id: stripeRefundId,
      stripe_error: stripeError,
    }, 500);
  }

  // Persist Stripe id on the refund row if we got one.
  if (stripeRefundId) {
    await admin
      .from('refunds')
      .update({ stripe_refund_id: stripeRefundId, status: 'Processing' })
      .eq('id', refundId as string);
  }

  return json({
    refund_id: refundId,
    stripe_refund_id: stripeRefundId,
    stripe_error: stripeError,
    amount: amountNum,
  });
});
