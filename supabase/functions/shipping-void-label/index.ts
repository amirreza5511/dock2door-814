// Supabase Edge Function — shipping-void-label
// Voids/refunds a previously purchased label via the carrier adapter, then
// flips the shipment to status='Voided' through `mark_shipment_voided` RPC.
//
// Auth: Supabase JWT (provider company member or admin).
// Body: { shipment_id: string, reason?: string }
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getAdapter, resolveCredentials } from '../_shared/carriers/registry.ts';

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
  const reason = String(body.reason ?? '').trim();
  if (!shipmentId) return jsonResp({ error: 'shipment_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: shipment } = await admin
    .from('shipments')
    .select('id, provider_company_id, carrier_code, carrier_account_id, tracking_code, label_url, status')
    .eq('id', shipmentId)
    .maybeSingle();
  if (!shipment) return jsonResp({ error: 'shipment_not_found' }, 404);
  if (!shipment.label_url || !shipment.tracking_code) return jsonResp({ error: 'no_label_to_void' }, 400);
  if (shipment.status === 'Voided') return jsonResp({ error: 'already_voided' }, 409);

  const { data: account } = shipment.carrier_account_id
    ? await admin.from('carrier_accounts').select('*').eq('id', shipment.carrier_account_id).maybeSingle()
    : await admin.from('carrier_accounts').select('*').eq('carrier_code', shipment.carrier_code).limit(1).maybeSingle();

  if (!account) return jsonResp({ error: 'carrier_account_missing' }, 400);

  const adapter = getAdapter(shipment.carrier_code);
  const creds = resolveCredentials(shipment.carrier_code, account);

  // carrier_shipment_id is stored in tracking_events.payload by EP/Shippo, but
  // we also persist it as part of the bought label (see purchase-shipping-label).
  // For EasyPost the carrier_shipment_id is the EP shipment id (label_url path).
  const carrierShipId = extractEpShipId(shipment.label_url ?? '');

  let voidedRaw: any = null;
  try {
    const r = await adapter.voidLabel({ carrier_shipment_id: carrierShipId, tracking_code: shipment.tracking_code }, creds);
    voidedRaw = r.raw;
  } catch (e) {
    return jsonResp({ error: 'carrier_void_failed', detail: (e as Error).message }, 502);
  }

  await userClient.rpc('mark_shipment_voided', { p_shipment_id: shipmentId, p_reason: reason });
  return jsonResp({ ok: true, raw: voidedRaw }, 200);
});

function extractEpShipId(labelUrl: string): string {
  // EP urls look like https://easypost-files.s3.amazonaws.com/files/postage_label/<date>/<id>.pdf
  // We don't strictly need the EP shipment id — EP refund accepts tracking_code via /refund.
  // Fall back to URL parsing; adapters that need a real id should look up tracking via API.
  const m = labelUrl.match(/shp_[A-Za-z0-9]+/);
  return m ? m[0] : '';
}

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
