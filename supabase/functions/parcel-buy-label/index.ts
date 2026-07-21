// Supabase Edge Function — parcel-buy-label (consumer Ship & Return flow)
// Buys a real shipping label from Shippo or EasyPost using a rate id returned
// by parcel-rate-shop, then attaches the tracking + label URL onto the given
// parcel_shipments row via parcel_attach_label (RLS-aware).
//
// Auth: Supabase JWT (must be a member of the parcel's company).
// Body: {
//   parcel_shipment_id: string,
//   carrier: 'SHIPPO' | 'EASYPOST',
//   carrier_rate_id: string,
//   amount?: number, currency?: string
// }
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── EasyPost ────────────────────────────────────────────────────────────────
const EP_BASE = 'https://api.easypost.com/v2';
async function ep(path: string, key: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${EP_BASE}${path}`, {
    ...init,
    headers: { Authorization: 'Basic ' + btoa(`${key}:`), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `easypost_${r.status}`);
  return j;
}
async function easypostBuy(rateId: string) {
  const key = Deno.env.get('EASYPOST_API_KEY') ?? '';
  if (!key) throw new Error('easypost_api_key_missing');
  const [sid, rid] = String(rateId).split(':');
  if (!sid || !rid) throw new Error('invalid_rate_id');
  const b = await ep(`/shipments/${sid}/buy`, key, { method: 'POST', body: JSON.stringify({ rate: { id: rid } }) });
  return {
    carrier_code: 'EASYPOST',
    tracking_code: String(b.tracking_code ?? ''),
    label_url: String(b.postage_label?.label_url ?? ''),
    label_format: 'PDF',
    amount: Number(b.selected_rate?.rate ?? 0),
    currency: String(b.selected_rate?.currency ?? 'USD'),
    carrier_shipment_id: String(b.id ?? ''),
    raw: b,
  };
}

// ── Shippo ──────────────────────────────────────────────────────────────────
const SP_BASE = 'https://api.goshippo.com';
async function sp(path: string, key: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SP_BASE}${path}`, {
    ...init,
    headers: { Authorization: `ShippoToken ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.detail ?? j?.error ?? `shippo_${r.status}`);
  return j;
}
async function shippoBuy(rateId: string) {
  const key = Deno.env.get('SHIPPO_API_KEY') ?? '';
  if (!key) throw new Error('shippo_api_key_missing');
  const tx = await sp('/transactions/', key, { method: 'POST', body: JSON.stringify({ rate: rateId, label_file_type: 'PDF', async: false }) });
  if (tx.status !== 'SUCCESS') throw new Error(tx.messages?.[0]?.text ?? 'shippo_purchase_failed');
  return {
    carrier_code: 'SHIPPO',
    tracking_code: String(tx.tracking_number ?? ''),
    label_url: String(tx.label_url ?? ''),
    label_format: 'PDF',
    amount: Number(tx.rate?.amount ?? 0),
    currency: String(tx.rate?.currency ?? 'USD'),
    carrier_shipment_id: String(tx.object_id ?? ''),
    raw: tx,
  };
}

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

  let body: any; try { body = await req.json(); } catch { return jsonResp({ error: 'invalid_json' }, 400); }
  const parcelId = String(body.parcel_shipment_id ?? '').trim();
  const carrier = String(body.carrier ?? '').toUpperCase();
  const rateId = String(body.carrier_rate_id ?? '').trim();
  if (!parcelId) return jsonResp({ error: 'parcel_shipment_id required' }, 400);
  if (!rateId) return jsonResp({ error: 'carrier_rate_id required' }, 400);
  if (carrier !== 'SHIPPO' && carrier !== 'EASYPOST') return jsonResp({ error: 'carrier_unsupported' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: parcel } = await admin.from('parcel_shipments').select('id, label_url').eq('id', parcelId).maybeSingle();
  if (!parcel) return jsonResp({ error: 'parcel_not_found' }, 404);
  if (parcel.label_url) return jsonResp({ error: 'label_already_purchased' }, 409);

  let bought;
  try {
    bought = carrier === 'SHIPPO' ? await shippoBuy(rateId) : await easypostBuy(rateId);
  } catch (e) {
    return jsonResp({ error: 'purchase_failed', detail: (e as Error).message }, 502);
  }

  // Persist via RLS-aware RPC using the caller's JWT.
  const { error: attachErr } = await userClient.rpc('parcel_attach_label', {
    p_id: parcelId,
    p_carrier_code: bought.carrier_code,
    p_tracking: bought.tracking_code,
    p_label_url: bought.label_url,
    p_label_format: bought.label_format,
    p_carrier_shipment_id: bought.carrier_shipment_id,
    p_price: bought.amount,
    p_currency: bought.currency,
    p_rate_raw: bought.raw ?? {},
  });
  if (attachErr) return jsonResp({ error: 'attach_failed', detail: attachErr.message }, 500);

  return jsonResp({
    parcel_shipment_id: parcelId,
    carrier: bought.carrier_code,
    tracking_code: bought.tracking_code,
    label_url: bought.label_url,
    label_format: bought.label_format,
    amount: bought.amount,
    currency: bought.currency,
  }, 200);
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
