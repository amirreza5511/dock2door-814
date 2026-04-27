// Supabase Edge Function — purchase-shipping-label (multi-carrier)
// Purchases a real shipping label via the appropriate carrier adapter and
// attaches it to a Dock2Door shipment.
//
// Auth: Supabase JWT (provider company member or admin).
// Body:
//   { shipment_id: string, rate_quote_id?: string, carrier_account_id?: string }
//   - rate_quote_id: id of a row in `shipping_rate_quotes` (preferred — cheapest matching quote is used otherwise)
//   - carrier_account_id: optional explicit carrier account override
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getAdapter, resolveCredentials } from '../_shared/carriers/registry.ts';
import type { NormalizedRate } from '../_shared/carriers/types.ts';

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
  const user = userData.user;

  let body: any; try { body = await req.json(); } catch { return jsonResp({ error: 'invalid_json' }, 400); }
  const shipmentId = String(body.shipment_id ?? '').trim();
  const rateQuoteId = body.rate_quote_id ? String(body.rate_quote_id) : null;
  const explicitAccountId = body.carrier_account_id ? String(body.carrier_account_id) : null;
  if (!shipmentId) return jsonResp({ error: 'shipment_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: shipment } = await admin
    .from('shipments')
    .select('id, order_id, provider_company_id, carrier_code, service_level, tracking_code, label_path, label_url, ship_from, ship_to, weight_kg, length_cm, width_cm, height_cm, status')
    .eq('id', shipmentId).maybeSingle();
  if (!shipment) return jsonResp({ error: 'shipment_not_found' }, 404);
  if (shipment.label_url || shipment.label_path) return jsonResp({ error: 'label_already_purchased' }, 409);

  // Authorize
  const { data: roleRows } = await admin.from('user_roles').select('role').eq('user_id', user.id);
  const isAdmin = (roleRows ?? []).some((r) => String(r.role).toLowerCase() === 'admin');
  if (!isAdmin) {
    const { data: m } = await admin.from('company_users').select('company_id')
      .eq('user_id', user.id).eq('company_id', shipment.provider_company_id).maybeSingle();
    if (!m) return jsonResp({ error: 'forbidden' }, 403);
  }

  // Resolve rate
  let rate: NormalizedRate | null = null;
  if (rateQuoteId) {
    const { data: q } = await admin.from('shipping_rate_quotes').select('*').eq('id', rateQuoteId).maybeSingle();
    if (!q) return jsonResp({ error: 'rate_quote_not_found' }, 404);
    rate = {
      carrier_code: String(q.carrier_code).toUpperCase() as NormalizedRate['carrier_code'],
      service_level: q.service_level,
      service_name: q.service_name,
      rate_amount: Number(q.rate_amount),
      currency: q.currency,
      carrier_rate_id: q.carrier_rate_id,
      raw: q.raw ?? {},
    };
  }

  // Resolve carrier account
  const carrierCode = (rate?.carrier_code ?? shipment.carrier_code ?? '').toUpperCase();
  if (!carrierCode) return jsonResp({ error: 'carrier_code_unknown — call rate-shop first' }, 400);
  const { data: account } = explicitAccountId
    ? await admin.from('carrier_accounts').select('*').eq('id', explicitAccountId).maybeSingle()
    : await admin.from('carrier_accounts').select('*')
        .eq('is_active', true).eq('carrier_code', carrierCode)
        .or(`company_id.eq.${shipment.provider_company_id},scope.eq.platform`)
        .order('scope', { ascending: true })
        .limit(1).maybeSingle();
  if (!account) return jsonResp({ error: 'carrier_account_missing' }, 400);

  const adapter = getAdapter(carrierCode);
  const creds = resolveCredentials(carrierCode, account);

  // If we have no rate yet, do a quick rate-shop on this carrier to pick cheapest.
  if (!rate) {
    try {
      const rates = await adapter.rateShop({
        fromAddress: shipment.ship_from ?? {},
        toAddress: shipment.ship_to ?? {},
        parcel: {
          length_cm: Number(shipment.length_cm ?? 10),
          width_cm: Number(shipment.width_cm ?? 10),
          height_cm: Number(shipment.height_cm ?? 10),
          weight_kg: Number(shipment.weight_kg ?? 0.5),
        },
        serviceLevel: shipment.service_level || undefined,
      }, creds);
      if (rates.length === 0) return jsonResp({ error: 'no_rates_available' }, 502);
      const preferred = shipment.service_level
        ? rates.find((r) => r.service_level === String(shipment.service_level).toUpperCase())
        : null;
      rate = preferred ?? rates.slice().sort((a, b) => a.rate_amount - b.rate_amount)[0];
    } catch (e) {
      return jsonResp({ error: 'rate_shop_failed', detail: (e as Error).message }, 502);
    }
  }

  // Purchase
  let bought;
  try {
    bought = await adapter.purchaseLabel({
      rate: rate!,
      fromAddress: shipment.ship_from ?? {},
      toAddress: shipment.ship_to ?? {},
      parcel: {
        length_cm: Number(shipment.length_cm ?? 10),
        width_cm: Number(shipment.width_cm ?? 10),
        height_cm: Number(shipment.height_cm ?? 10),
        weight_kg: Number(shipment.weight_kg ?? 0.5),
      },
      reference: shipment.order_id ?? shipmentId,
    }, creds);
  } catch (e) {
    return jsonResp({ error: 'purchase_failed', detail: (e as Error).message }, 502);
  }

  // Persist via RPC + side-update for fields not covered by the RPC
  const { error: attachErr } = await admin.rpc('attach_shipment_label', {
    p_shipment_id: shipmentId,
    p_tracking: bought.tracking_code,
    p_label_path: bought.label_url,
    p_rate: bought.rate_amount,
    p_currency: bought.currency,
  });
  if (attachErr) return jsonResp({ error: 'attach_failed', detail: attachErr.message }, 500);

  await admin.from('shipments').update({
    label_url: bought.label_url,
    carrier_code: bought.carrier_code,
    carrier_account_id: account.id,
  }).eq('id', shipmentId);

  return jsonResp({
    shipment_id: shipmentId,
    tracking_code: bought.tracking_code,
    label_url: bought.label_url,
    carrier: bought.carrier_code,
    rate: bought.rate_amount,
    currency: bought.currency,
  }, 200);
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
