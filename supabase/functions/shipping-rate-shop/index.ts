// Supabase Edge Function — shipping-rate-shop
// Multi-carrier rate shopping. For a given shipment, calls every active
// carrier_account adapter and persists normalized rates to shipping_rate_quotes.
//
// Auth: Supabase JWT (provider/customer member of the shipment).
// Body: { shipment_id: string, carrier_codes?: string[] }
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getAdapter, resolveCredentials, ADAPTERS } from '../_shared/carriers/registry.ts';
import type { CarrierCode, NormalizedRate, RateRequest } from '../_shared/carriers/types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResp({ error: 'unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, auth.replace('Bearer ', ''), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResp({ error: 'unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return jsonResp({ error: 'invalid_json' }, 400); }
  const shipmentId = String(body.shipment_id ?? '').trim();
  if (!shipmentId) return jsonResp({ error: 'shipment_id required' }, 400);
  const requestedCarriers: string[] = Array.isArray(body.carrier_codes) ? body.carrier_codes : [];

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: shipment } = await admin
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .maybeSingle();
  if (!shipment) return jsonResp({ error: 'shipment_not_found' }, 404);

  // Find candidate carrier accounts: provider company first, then platform
  const { data: companyAccounts } = await admin
    .from('carrier_accounts')
    .select('*')
    .eq('is_active', true)
    .eq('company_id', shipment.provider_company_id);
  const { data: platformAccounts } = await admin
    .from('carrier_accounts')
    .select('*')
    .eq('is_active', true)
    .eq('scope', 'platform');

  const accounts = [...(companyAccounts ?? []), ...(platformAccounts ?? [])].filter(
    (a) => requestedCarriers.length === 0 || requestedCarriers.map((c) => c.toUpperCase()).includes(String(a.carrier_code).toUpperCase()),
  );
  if (accounts.length === 0) return jsonResp({ error: 'no_carrier_accounts_configured' }, 400);

  const rateReq: RateRequest = {
    fromAddress: shipment.ship_from ?? {},
    toAddress: shipment.ship_to ?? {},
    parcel: {
      length_cm: Number(shipment.length_cm ?? 10),
      width_cm: Number(shipment.width_cm ?? 10),
      height_cm: Number(shipment.height_cm ?? 10),
      weight_kg: Number(shipment.weight_kg ?? 0.5),
    },
    serviceLevel: shipment.service_level || undefined,
  };

  const allRates: NormalizedRate[] = [];
  const errors: { carrier: string; error: string }[] = [];

  await Promise.all(accounts.map(async (acc) => {
    try {
      const adapter = getAdapter(acc.carrier_code);
      const creds = resolveCredentials(acc.carrier_code, acc);
      const rates = await adapter.rateShop(rateReq, creds);
      rates.forEach((r) => { (r.raw as any).carrier_account_id = acc.id; });
      allRates.push(...rates);
    } catch (e) {
      errors.push({ carrier: acc.carrier_code, error: (e as Error).message });
    }
  }));

  // Persist via RPC (security definer, RLS-aware)
  if (allRates.length > 0) {
    const { error: saveErr } = await userClient.rpc('save_rate_quotes', {
      p_shipment_id: shipmentId,
      p_quotes: allRates.map((r) => ({
        carrier_code: r.carrier_code,
        service_level: r.service_level,
        service_name: r.service_name,
        rate_amount: r.rate_amount,
        currency: r.currency,
        est_delivery_days: r.est_delivery_days ?? null,
        est_delivery_date: r.est_delivery_date ?? null,
        carrier_rate_id: r.carrier_rate_id,
        raw: r.raw,
      })),
    });
    if (saveErr) console.log('[shipping-rate-shop] save error', saveErr.message);
  }

  return jsonResp({ rates: allRates, errors, attempted: accounts.length }, 200);
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
