// Supabase Edge Function — create-payment-intent
// Creates a Stripe PaymentIntent for a Dock2Door invoice.
//
// Authenticated: Supabase JWT required (caller must be invoice's customer company member or admin).
// Request JSON: { invoice_id: string, payment_method_types?: string[] }
// Response: { client_secret, payment_intent_id, amount, currency }
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
  const invoiceId = String(body.invoice_id ?? '').trim();
  if (!invoiceId) return json({ error: 'invoice_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .select('id, total_amount, currency, status, customer_company_id, provider_company_id, invoice_number')
    .eq('id', invoiceId)
    .maybeSingle();
  if (invErr || !invoice) return json({ error: 'invoice_not_found' }, 404);
  if (invoice.status === 'Paid') return json({ error: 'invoice_already_paid' }, 409);
  if (invoice.status === 'Void') return json({ error: 'invoice_void' }, 409);

  // Authorize: caller must be admin or member of customer_company_id
  const { data: roleRows } = await admin.from('user_roles').select('role').eq('user_id', user.id);
  const isAdmin = (roleRows ?? []).some((r) => String(r.role).toLowerCase() === 'admin');
  if (!isAdmin) {
    const { data: membership } = await admin
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('company_id', invoice.customer_company_id)
      .maybeSingle();
    if (!membership) return json({ error: 'forbidden' }, 403);
  }

  const amount = Math.round(Number(invoice.total_amount ?? 0) * 100);
  const currency = String(invoice.currency ?? 'CAD').toLowerCase();
  if (amount <= 0) return json({ error: 'invalid_amount' }, 400);

  const stripe = new Stripe(STRIPE_SECRET, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const pi = await stripe.paymentIntents.create({
    amount,
    currency,
    automatic_payment_methods: { enabled: true },
    description: `Dock2Door Invoice ${invoice.invoice_number ?? invoice.id}`,
    metadata: {
      invoice_id: invoice.id,
      customer_company_id: invoice.customer_company_id ?? '',
      provider_company_id: invoice.provider_company_id ?? '',
      user_id: user.id,
    },
  });

  // Persist intent id against invoice (idempotent best-effort)
  await admin
    .from('invoices')
    .update({ stripe_payment_intent_id: pi.id })
    .eq('id', invoice.id);

  return json({
    client_secret: pi.client_secret,
    payment_intent_id: pi.id,
    amount,
    currency,
  }, 200);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
