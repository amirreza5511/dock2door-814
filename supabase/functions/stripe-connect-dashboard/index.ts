// Supabase Edge Function — stripe-connect-dashboard
// Returns a one-time Stripe Express dashboard login link for a provider company
// whose Connect account is fully onboarded. Used after onboarding completes so
// the provider can view balances / payouts in the Stripe Express dashboard.
//
// Authenticated: Supabase JWT required. Caller must be admin or member of `company_id`.
// Request JSON: { company_id: string }
// Response: { url: string, account_id: string }
//
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405, headers: CORS });
  if (!STRIPE_SECRET) return json({ error: 'stripe_not_configured' }, 500);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, auth.replace('Bearer ', ''), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
  const user = userData.user;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const companyId = String(body.company_id ?? '').trim();
  if (!companyId) return json({ error: 'company_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: roleRows } = await admin.from('user_roles').select('role').eq('user_id', user.id);
  const isAdmin = (roleRows ?? []).some((r) => String(r.role).toLowerCase() === 'admin');
  if (!isAdmin) {
    const { data: membership } = await admin
      .from('company_users').select('company_id')
      .eq('user_id', user.id).eq('company_id', companyId).maybeSingle();
    if (!membership) return json({ error: 'forbidden' }, 403);
  }

  const { data: company, error: cErr } = await admin
    .from('companies')
    .select('id, stripe_connect_account_id, stripe_connect_onboarded')
    .eq('id', companyId).maybeSingle();
  if (cErr || !company) return json({ error: 'company_not_found' }, 404);
  if (!company.stripe_connect_account_id) return json({ error: 'not_connected' }, 409);

  const stripe = new Stripe(STRIPE_SECRET, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  // Re-verify status with Stripe in case DB flag is stale
  try {
    const acc = await stripe.accounts.retrieve(company.stripe_connect_account_id);
    const done = Boolean(acc.details_submitted && acc.charges_enabled !== false);
    if (done !== Boolean(company.stripe_connect_onboarded)) {
      await admin.from('companies').update({ stripe_connect_onboarded: done }).eq('id', company.id);
    }
    if (!done) return json({ error: 'onboarding_incomplete' }, 409);
  } catch (err) {
    return json({ error: 'stripe_account_unreachable', detail: (err as Error).message }, 502);
  }

  try {
    const link = await stripe.accounts.createLoginLink(company.stripe_connect_account_id);
    return json({ url: link.url, account_id: company.stripe_connect_account_id }, 200);
  } catch (err) {
    return json({ error: 'login_link_failed', detail: (err as Error).message }, 502);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
