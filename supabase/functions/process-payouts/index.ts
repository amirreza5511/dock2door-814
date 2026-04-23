// Supabase Edge Function — process-payouts
// Stripe Connect payout processor: takes pending `payouts` rows with Stripe Connect
// account ids and creates Stripe Transfers to the provider's connected account.
// Then marks the payout as `Processing` (final `Paid` comes from payout.paid webhook).
//
// Authorization: service-role only (called by cron, or via supabase cli).
//
// Request JSON (all optional): { limit?: number, payout_id?: string }
//
// Required secrets:
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.includes(SERVICE_KEY) || !SERVICE_KEY) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!STRIPE_SECRET) return resp({ error: 'stripe_not_configured' }, 500);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(Number(body.limit ?? 25), 100);
  const onlyId = body.payout_id ? String(body.payout_id) : null;

  const stripe = new Stripe(STRIPE_SECRET, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let q = admin
    .from('payouts')
    .select('id, company_id, amount, currency, status, stripe_transfer_id')
    .eq('status', 'Pending')
    .order('created_at');
  if (onlyId) q = q.eq('id', onlyId);
  else q = q.limit(limit);

  const { data: payouts, error } = await q;
  if (error) return resp({ error: error.message }, 500);

  const results: any[] = [];
  for (const p of payouts ?? []) {
    try {
      // Fetch company's Stripe Connect account id
      const { data: company } = await admin
        .from('companies')
        .select('id, name, stripe_connect_account_id')
        .eq('id', p.company_id)
        .maybeSingle();

      const destination = company?.stripe_connect_account_id;
      if (!destination) {
        await admin.from('payouts').update({
          status: 'Failed',
          failure_reason: 'provider_missing_stripe_connect_account',
        }).eq('id', p.id);
        results.push({ id: p.id, ok: false, error: 'no_connect_account' });
        continue;
      }

      const amountCents = Math.round(Number(p.amount) * 100);
      if (amountCents <= 0) {
        await admin.from('payouts').update({ status: 'Failed', failure_reason: 'invalid_amount' }).eq('id', p.id);
        results.push({ id: p.id, ok: false, error: 'invalid_amount' });
        continue;
      }

      const transfer = await stripe.transfers.create({
        amount: amountCents,
        currency: String(p.currency ?? 'CAD').toLowerCase(),
        destination,
        description: `Dock2Door payout ${p.id}`,
        metadata: { payout_id: p.id, company_id: p.company_id },
      });

      await admin.from('payouts').update({
        status: 'Processing',
        stripe_transfer_id: transfer.id,
        processed_at: new Date().toISOString(),
      }).eq('id', p.id);

      results.push({ id: p.id, ok: true, transfer_id: transfer.id });
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown';
      console.log('[process-payouts] transfer failed', p.id, msg);
      await admin.from('payouts').update({ status: 'Failed', failure_reason: msg }).eq('id', p.id);
      results.push({ id: p.id, ok: false, error: msg });
    }
  }

  return resp({ processed: results.length, results }, 200);
});

function resp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
