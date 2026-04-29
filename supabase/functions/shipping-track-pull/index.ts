// Supabase Edge Function — shipping-track-pull
// Polling fallback for carriers without webhook coverage.
// Auth: service-role header (cron) OR Bearer JWT.
// Body: { shipment_id?: string, max?: number }
//   - shipment_id provided: poll that one shipment
//   - otherwise: poll up to `max` (default 25) in-flight shipments older than 30m
// Each fetched event is forwarded to `record_tracking_event` RPC.
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// ===== Inlined carrier registry (was ../_shared/carriers/*) =====
type CarrierCode = 'EASYPOST' | 'SHIPPO' | 'CANADA_POST' | 'UPS' | 'DHL' | 'FEDEX';
interface TrackingUpdate { status: 'InTransit'|'OutForDelivery'|'Delivered'|'Exception'|'Returned'; event_code: string; description: string; occurred_at: string; city?: string; region?: string; country?: string; raw: any; }
interface CarrierCredentials { api_key?: string; account_number?: string; username?: string; password?: string; client_id?: string; client_secret?: string; meter_number?: string; customer_number?: string; contract_id?: string; mode: 'test'|'live'; data?: Record<string, unknown>; }
interface CarrierAdapter { code: CarrierCode; displayName: string; implemented: boolean; rateShop(req: any, creds: CarrierCredentials): Promise<any[]>; purchaseLabel(req: any, creds: CarrierCredentials): Promise<any>; voidLabel(req: any, creds: CarrierCredentials): Promise<{ ok: boolean; raw: any }>; track?(trackingCode: string, creds: CarrierCredentials): Promise<TrackingUpdate[]>; createManifest?(req: any, creds: CarrierCredentials): Promise<any>; }

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
  async rateShop() { return []; }, async purchaseLabel() { throw new Error('not_used'); }, async voidLabel() { throw new Error('not_used'); },
  async track(code, creds) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const r = await ep(`/trackers?tracking_code=${encodeURIComponent(code)}`, creds.api_key);
    const events = (r.trackers ?? []).flatMap((t: any) => t.tracking_details ?? []);
    return events.map((e: any) => ({ status: mapEpStatus(String(e.status ?? '')), event_code: String(e.status ?? ''), description: String(e.message ?? ''), occurred_at: String(e.datetime ?? new Date().toISOString()), city: e.tracking_location?.city, region: e.tracking_location?.state, country: e.tracking_location?.country, raw: e }));
  },
};
const shippo: CarrierAdapter = { code: 'SHIPPO', displayName: 'Shippo', implemented: true, async rateShop() { return []; }, async purchaseLabel() { throw new Error('not_used'); }, async voidLabel() { throw new Error('not_used'); } };
const canadaPost: CarrierAdapter = { code: 'CANADA_POST', displayName: 'Canada Post', implemented: true, async rateShop() { return []; }, async purchaseLabel() { throw new Error('not_used'); }, async voidLabel() { throw new Error('not_used'); } };
const ups: CarrierAdapter = { code: 'UPS', displayName: 'UPS', implemented: true, async rateShop() { return []; }, async purchaseLabel() { throw new Error('not_used'); }, async voidLabel() { throw new Error('not_used'); } };
const dhl: CarrierAdapter = { code: 'DHL', displayName: 'DHL Express', implemented: true, async rateShop() { return []; }, async purchaseLabel() { throw new Error('not_used'); }, async voidLabel() { throw new Error('not_used'); } };
const fedex: CarrierAdapter = { code: 'FEDEX', displayName: 'FedEx', implemented: true, async rateShop() { return []; }, async purchaseLabel() { throw new Error('not_used'); }, async voidLabel() { throw new Error('not_used'); } };

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

  let body: any = {}; try { body = await req.json(); } catch {}
  const shipmentId = body.shipment_id ? String(body.shipment_id) : null;
  const max = Math.max(1, Math.min(200, Number(body.max ?? 25)));

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const q = admin.from('shipments').select('id, carrier_code, carrier_account_id, tracking_code, status').not('tracking_code', 'eq', '').not('status', 'in', '(Delivered,Voided,Cancelled,Returned)');
  const { data: ships } = shipmentId
    ? await admin.from('shipments').select('id, carrier_code, carrier_account_id, tracking_code, status').eq('id', shipmentId)
    : await q.limit(max);

  let polled = 0; let recorded = 0; const errors: string[] = [];
  for (const s of ships ?? []) {
    try {
      const adapter = getAdapter(s.carrier_code);
      if (!adapter.track) continue;
      const { data: account } = s.carrier_account_id
        ? await admin.from('carrier_accounts').select('*').eq('id', s.carrier_account_id).maybeSingle()
        : await admin.from('carrier_accounts').select('*').eq('carrier_code', s.carrier_code).limit(1).maybeSingle();
      if (!account) continue;
      const creds = resolveCredentials(s.carrier_code, account);
      const events = await adapter.track(s.tracking_code, creds);
      polled++;
      for (const ev of events) {
        const { error } = await admin.rpc('record_tracking_event', {
          p_tracking: s.tracking_code,
          p_event_code: ev.event_code,
          p_description: ev.description,
          p_status: ev.status,
          p_occurred: ev.occurred_at,
          p_payload: ev.raw ?? {},
        });
        if (error) errors.push(`${s.id}: ${error.message}`); else recorded++;
      }
    } catch (e) {
      errors.push(`${s.id}: ${(e as Error).message}`);
    }
  }

  return jsonResp({ polled, recorded, errors }, 200);
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
