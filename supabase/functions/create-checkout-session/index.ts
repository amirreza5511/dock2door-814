// Supabase Edge Function — create-checkout-session
// Creates a Stripe Checkout Session for a Dock2Door invoice. Customer opens the returned
// URL (hosted Stripe Checkout) and pays. Completion is handled by `stripe-webhook`.
//
// Authenticated: Supabase JWT required. Caller must be admin or member of invoice.customer_company_id.
// Request JSON: { invoice_id: string, success_url: string, cancel_url: string }
// Response: { url: string, session_id: string }
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
  const invoiceId = String(body.invoice_id ?? '').trim();
  const successUrl = String(body.success_url ?? '').trim() || 'https://dock2door.app/payment-success';
  const cancelUrl = String(body.cancel_url ?? '').trim() || 'https://dock2door.app/payment-cancel';
  if (!invoiceId) return json({ error: 'invoice_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .select('id, total_amount, currency, status, customer_company_id, provider_company_id, invoice_number')
    .eq('id', invoiceId).maybeSingle();
  if (invErr || !invoice) return json({ error: 'invoice_not_found' }, 404);
  if (invoice.status === 'Paid') return json({ error: 'invoice_already_paid' }, 409);
  if (invoice.status === 'Void') return json({ error: 'invoice_void' }, 409);

  const { data: roleRows } = await admin.from('user_roles').select('role').eq('user_id', user.id);
  const isAdmin = (roleRows ?? []).some((r) => String(r.role).toLowerCase() === 'admin');
  if (!isAdmin) {
    const { data: membership } = await admin
      .from('company_users').select('company_id')
      .eq('user_id', user.id).eq('company_id', invoice.customer_company_id).maybeSingle();
    if (!membership) return json({ error: 'forbidden' }, 403);
  }

  const amountCents = Math.round(Number(invoice.total_amount ?? 0) * 100);
  const currency = String(invoice.currency ?? 'CAD').toLowerCase();
  if (amountCents <= 0) return json({ error: 'invalid_amount' }, 400);

  const stripe = new Stripe(STRIPE_SECRET, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amountCents,
          product_data: {
            name: `Dock2Door Invoice ${invoice.invoice_number ?? invoice.id}`,
          },
        },
      },
    ],
    payment_intent_data: {
      metadata: {
        invoice_id: invoice.id,
        customer_company_id: invoice.customer_company_id ?? '',
        provider_company_id: invoice.provider_company_id ?? '',
        user_id: user.id,
      },
    },
    metadata: { invoice_id: invoice.id },
  });

  await admin.from('invoices').update({
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
  }).eq('id', invoice.id);

  return json({ url: session.url, session_id: session.id }, 200);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
