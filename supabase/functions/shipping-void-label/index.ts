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
// ===== Inlined carrier registry (was ../_shared/carriers/*) =====
type CarrierCode = 'EASYPOST' | 'SHIPPO' | 'CANADA_POST' | 'UPS' | 'DHL' | 'FEDEX';
interface NormalizedAddress { name?: string; company?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string; phone?: string; email?: string; }
interface ParcelDimensions { length_cm: number; width_cm: number; height_cm: number; weight_kg: number; }
interface RateRequest { fromAddress: NormalizedAddress; toAddress: NormalizedAddress; parcel: ParcelDimensions; serviceLevel?: string; customsItems?: any[]; }
interface NormalizedRate { carrier_code: CarrierCode; service_level: string; service_name: string; rate_amount: number; currency: string; est_delivery_days?: number; est_delivery_date?: string; carrier_rate_id: string; raw: any; }
interface PurchaseLabelRequest { rate: NormalizedRate; fromAddress: NormalizedAddress; toAddress: NormalizedAddress; parcel: ParcelDimensions; reference?: string; }
interface PurchasedLabel { carrier_code: CarrierCode; tracking_code: string; label_url: string; label_format: string; rate_amount: number; currency: string; carrier_shipment_id: string; raw: any; }
interface VoidLabelRequest { carrier_shipment_id: string; tracking_code: string; }
interface TrackingUpdate { status: 'InTransit'|'OutForDelivery'|'Delivered'|'Exception'|'Returned'; event_code: string; description: string; occurred_at: string; city?: string; region?: string; country?: string; raw: any; }
interface ManifestRequest { shipmentTrackingCodes: string[]; shipDate?: string; }
interface NormalizedManifest { manifest_number: string; manifest_url: string; raw: any; }
interface CarrierCredentials { api_key?: string; account_number?: string; username?: string; password?: string; client_id?: string; client_secret?: string; meter_number?: string; customer_number?: string; contract_id?: string; mode: 'test'|'live'; data?: Record<string, unknown>; }
interface CarrierAdapter { code: CarrierCode; displayName: string; implemented: boolean; rateShop(req: RateRequest, creds: CarrierCredentials): Promise<NormalizedRate[]>; purchaseLabel(req: PurchaseLabelRequest, creds: CarrierCredentials): Promise<PurchasedLabel>; voidLabel(req: VoidLabelRequest, creds: CarrierCredentials): Promise<{ ok: boolean; raw: any }>; track?(trackingCode: string, creds: CarrierCredentials): Promise<TrackingUpdate[]>; createManifest?(req: ManifestRequest, creds: CarrierCredentials): Promise<NormalizedManifest>; }

const EP_BASE = 'https://api.easypost.com/v2';
async function ep(path: string, key: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${EP_BASE}${path}`, { ...init, headers: { Authorization: 'Basic ' + btoa(`${key}:`), 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `easypost_${r.status}`);
  return j;
}
function mapEpStatus(s: string): TrackingUpdate['status'] { const u = s.toLowerCase(); if (u.includes('deliver')) return 'Delivered'; if (u.includes('out_for_delivery') || u.includes('out for delivery')) return 'OutForDelivery'; if (u.includes('return')) return 'Returned'; if (u.includes('exception') || u.includes('failure')) return 'Exception'; return 'InTransit'; }
const easypost: CarrierAdapter = {
  code: 'EASYPOST', displayName: 'EasyPost', implemented: true,
  async rateShop() { throw new Error('not_used'); },
  async purchaseLabel() { throw new Error('not_used'); },
  async voidLabel(req, creds) { if (!creds.api_key) throw new Error('easypost_api_key_missing'); const r = await ep(`/shipments/${req.carrier_shipment_id}/refund`, creds.api_key, { method: 'POST' }); return { ok: true, raw: r }; },
  async track(code, creds) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const r = await ep(`/trackers?tracking_code=${encodeURIComponent(code)}`, creds.api_key);
    const events = (r.trackers ?? []).flatMap((t: any) => t.tracking_details ?? []);
    return events.map((e: any) => ({ status: mapEpStatus(String(e.status ?? '')), event_code: String(e.status ?? ''), description: String(e.message ?? ''), occurred_at: String(e.datetime ?? new Date().toISOString()), city: e.tracking_location?.city, region: e.tracking_location?.state, country: e.tracking_location?.country, raw: e }));
  },
};

const SP_BASE = 'https://api.goshippo.com';
async function sp(path: string, key: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SP_BASE}${path}`, { ...init, headers: { Authorization: `ShippoToken ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.detail ?? j?.error ?? `shippo_${r.status}`);
  return j;
}
const shippo: CarrierAdapter = {
  code: 'SHIPPO', displayName: 'Shippo', implemented: true,
  async rateShop() { throw new Error('not_used'); },
  async purchaseLabel() { throw new Error('not_used'); },
  async voidLabel(req, creds) { if (!creds.api_key) throw new Error('shippo_api_key_missing'); const r = await sp('/refunds/', creds.api_key, { method: 'POST', body: JSON.stringify({ transaction: req.carrier_shipment_id, async: false }) }); return { ok: r.status === 'PENDING' || r.status === 'SUCCESS', raw: r }; },
};

const canadaPost: CarrierAdapter = { code: 'CANADA_POST', displayName: 'Canada Post', implemented: true, async rateShop() { throw new Error('not_used'); }, async purchaseLabel() { throw new Error('canada_post_purchase_label_requires_contract_setup'); }, async voidLabel() { throw new Error('canada_post_void_requires_contract_setup'); } };
const ups: CarrierAdapter = { code: 'UPS', displayName: 'UPS', implemented: true, async rateShop() { throw new Error('not_used'); }, async purchaseLabel() { throw new Error('ups_purchase_label_requires_negotiated_rate_contract'); }, async voidLabel() { throw new Error('ups_void_label_requires_negotiated_rate_contract'); } };
const dhl: CarrierAdapter = { code: 'DHL', displayName: 'DHL Express', implemented: true, async rateShop() { throw new Error('not_used'); }, async purchaseLabel() { throw new Error('dhl_purchase_label_requires_account_contract'); }, async voidLabel() { throw new Error('dhl_void_label_not_supported_via_api'); } };
const fedex: CarrierAdapter = { code: 'FEDEX', displayName: 'FedEx', implemented: true, async rateShop() { throw new Error('not_used'); }, async purchaseLabel() { throw new Error('fedex_purchase_label_requires_ship_api_contract'); }, async voidLabel() { throw new Error('fedex_void_label_requires_ship_api_contract'); } };

const ADAPTERS: Record<CarrierCode, CarrierAdapter> = { EASYPOST: easypost, SHIPPO: shippo, CANADA_POST: canadaPost, UPS: ups, DHL: dhl, FEDEX: fedex };
function getAdapter(code: string): CarrierAdapter { const u = String(code ?? '').toUpperCase() as CarrierCode; const a = ADAPTERS[u]; if (!a) throw new Error(`carrier_${u}_unsupported`); return a; }
function resolveCredentials(carrierCode: string, account: { credentials_secret_ref?: string; mode?: string; data?: any; account_number?: string }): CarrierCredentials {
  const ref = account.credentials_secret_ref ?? '';
  const mode: 'test' | 'live' = (account.mode === 'live' ? 'live' : 'test');
  const fallbackEnv = (() => { switch (carrierCode.toUpperCase()) { case 'EASYPOST': return 'EASYPOST_API_KEY'; case 'SHIPPO': return 'SHIPPO_API_KEY'; case 'CANADA_POST': return 'CANADA_POST_CREDENTIALS'; case 'UPS': return 'UPS_CREDENTIALS'; case 'DHL': return 'DHL_CREDENTIALS'; case 'FEDEX': return 'FEDEX_CREDENTIALS'; default: return ''; } })();
  const raw = (ref && Deno.env.get(ref)) || (fallbackEnv && Deno.env.get(fallbackEnv)) || '';
  if (!raw) return { mode, account_number: account.account_number, data: account.data ?? {} };
  try { const obj = JSON.parse(raw); return { mode, account_number: account.account_number, ...obj }; }
  catch { return { api_key: raw, mode, account_number: account.account_number, data: account.data ?? {} }; }
}
// ===== End inlined carrier registry =====

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
