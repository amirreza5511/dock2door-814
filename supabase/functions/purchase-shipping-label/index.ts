// Supabase Edge Function — purchase-shipping-label (multi-carrier)
// Single-file, Dashboard-deployable. All `_shared/*` code is inlined below.
//
// Auth: Supabase JWT (provider company member or admin).
// Body:
//   { shipment_id: string, rate_quote_id?: string, carrier_account_id?: string }
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ─────────────────────────────────────────────────────────────────────────────
// Inlined: _shared/carriers/types.ts
// ─────────────────────────────────────────────────────────────────────────────
type CarrierCode = 'EASYPOST' | 'SHIPPO' | 'CANADA_POST' | 'UPS' | 'DHL' | 'FEDEX';

interface NormalizedAddress {
  name?: string; company?: string; street1?: string; street2?: string;
  city?: string; state?: string; zip?: string; country?: string;
  phone?: string; email?: string;
}
interface ParcelDimensions {
  length_cm: number; width_cm: number; height_cm: number; weight_kg: number;
}
interface RateRequest {
  fromAddress: NormalizedAddress;
  toAddress: NormalizedAddress;
  parcel: ParcelDimensions;
  serviceLevel?: string;
  customsItems?: any[];
}
interface NormalizedRate {
  carrier_code: CarrierCode;
  service_level: string;
  service_name: string;
  rate_amount: number;
  currency: string;
  est_delivery_days?: number;
  est_delivery_date?: string;
  carrier_rate_id: string;
  raw: any;
}
interface PurchaseLabelRequest {
  rate: NormalizedRate;
  fromAddress: NormalizedAddress;
  toAddress: NormalizedAddress;
  parcel: ParcelDimensions;
  reference?: string;
}
interface PurchasedLabel {
  carrier_code: CarrierCode;
  tracking_code: string;
  label_url: string;
  label_format: string;
  rate_amount: number;
  currency: string;
  carrier_shipment_id: string;
  raw: any;
}
interface VoidLabelRequest { carrier_shipment_id: string; tracking_code: string; }
interface CarrierCredentials {
  api_key?: string; account_number?: string; username?: string; password?: string;
  client_id?: string; client_secret?: string; meter_number?: string;
  customer_number?: string; contract_id?: string; mode: 'test' | 'live';
  data?: Record<string, unknown>;
}
interface CarrierAdapter {
  code: CarrierCode;
  displayName: string;
  implemented: boolean;
  rateShop(req: RateRequest, creds: CarrierCredentials): Promise<NormalizedRate[]>;
  purchaseLabel(req: PurchaseLabelRequest, creds: CarrierCredentials): Promise<PurchasedLabel>;
  voidLabel(req: VoidLabelRequest, creds: CarrierCredentials): Promise<{ ok: boolean; raw: any }>;
}

class CarrierNotImplementedError extends Error {
  constructor(public code: CarrierCode, op: string) {
    super(`carrier_${code.toLowerCase()}_${op}_not_implemented`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inlined: _shared/carriers/easypost.ts (live)
// ─────────────────────────────────────────────────────────────────────────────
const EP_BASE = 'https://api.easypost.com/v2';

async function ep(path: string, key: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${EP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: 'Basic ' + btoa(`${key}:`),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error?.message ?? `easypost_${r.status}`);
  return json;
}

function parcelToEP(p: ParcelDimensions) {
  return {
    length: p.length_cm || 10,
    width: p.width_cm || 10,
    height: p.height_cm || 10,
    weight: (p.weight_kg || 0.5) * 35.274, // kg → oz
  };
}

const easypost: CarrierAdapter = {
  code: 'EASYPOST',
  displayName: 'EasyPost',
  implemented: true,

  async rateShop(req, creds) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const epShipment = await ep('/shipments', creds.api_key, {
      method: 'POST',
      body: JSON.stringify({
        shipment: {
          to_address: req.toAddress,
          from_address: req.fromAddress,
          parcel: parcelToEP(req.parcel),
          options: { label_format: 'PDF' },
        },
      }),
    });
    const rates: any[] = Array.isArray(epShipment.rates) ? epShipment.rates : [];
    return rates.map((r) => ({
      carrier_code: 'EASYPOST',
      service_level: String(r.service ?? '').toUpperCase(),
      service_name: `${r.carrier} ${r.service}`,
      rate_amount: Number(r.rate ?? 0),
      currency: String(r.currency ?? 'USD'),
      est_delivery_days: r.delivery_days ?? r.est_delivery_days ?? undefined,
      est_delivery_date: r.delivery_date ?? undefined,
      carrier_rate_id: `${epShipment.id}:${r.id}`,
      raw: { ep_shipment_id: epShipment.id, rate: r, carrier: r.carrier },
    }));
  },

  async purchaseLabel(req, creds) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const [epShipmentId, rateId] = String(req.rate.carrier_rate_id).split(':');
    if (!epShipmentId || !rateId) throw new Error('invalid_rate_id');
    const bought = await ep(`/shipments/${epShipmentId}/buy`, creds.api_key, {
      method: 'POST',
      body: JSON.stringify({ rate: { id: rateId } }),
    });
    return {
      carrier_code: 'EASYPOST',
      tracking_code: String(bought.tracking_code ?? ''),
      label_url: String(bought.postage_label?.label_url ?? ''),
      label_format: 'PDF',
      rate_amount: Number(bought.selected_rate?.rate ?? 0),
      currency: String(bought.selected_rate?.currency ?? 'USD'),
      carrier_shipment_id: String(bought.id ?? ''),
      raw: bought,
    };
  },

  async voidLabel(req, creds) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const r = await ep(`/shipments/${req.carrier_shipment_id}/refund`, creds.api_key, { method: 'POST' });
    return { ok: true, raw: r };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Inlined: stub adapters for other carriers (not implemented)
// ─────────────────────────────────────────────────────────────────────────────
function makeStub(code: CarrierCode, displayName: string): CarrierAdapter {
  return {
    code, displayName, implemented: false,
    rateShop: () => { throw new CarrierNotImplementedError(code, 'rate_shop'); },
    purchaseLabel: () => { throw new CarrierNotImplementedError(code, 'purchase_label'); },
    voidLabel: () => { throw new CarrierNotImplementedError(code, 'void_label'); },
  };
}
const shippo = makeStub('SHIPPO', 'Shippo');
const canadaPost = makeStub('CANADA_POST', 'Canada Post');
const ups = makeStub('UPS', 'UPS');
const dhl = makeStub('DHL', 'DHL');
const fedex = makeStub('FEDEX', 'FedEx');

// ─────────────────────────────────────────────────────────────────────────────
// Inlined: _shared/carriers/registry.ts
// ─────────────────────────────────────────────────────────────────────────────
const ADAPTERS: Record<CarrierCode, CarrierAdapter> = {
  EASYPOST: easypost,
  SHIPPO: shippo,
  CANADA_POST: canadaPost,
  UPS: ups,
  DHL: dhl,
  FEDEX: fedex,
};

function getAdapter(code: string): CarrierAdapter {
  const u = String(code ?? '').toUpperCase() as CarrierCode;
  const a = ADAPTERS[u];
  if (!a) throw new Error(`carrier_${u}_unsupported`);
  return a;
}

function resolveCredentials(
  carrierCode: string,
  account: { credentials_secret_ref?: string; mode?: string; data?: any; account_number?: string },
): CarrierCredentials {
  const ref = account.credentials_secret_ref ?? '';
  const mode: 'test' | 'live' = (account.mode === 'live' ? 'live' : 'test');
  const fallbackEnv = (() => {
    switch (carrierCode.toUpperCase()) {
      case 'EASYPOST': return 'EASYPOST_API_KEY';
      case 'SHIPPO': return 'SHIPPO_API_KEY';
      case 'CANADA_POST': return 'CANADA_POST_CREDENTIALS';
      case 'UPS': return 'UPS_CREDENTIALS';
      case 'DHL': return 'DHL_CREDENTIALS';
      case 'FEDEX': return 'FEDEX_CREDENTIALS';
      default: return '';
    }
  })();
  const raw = (ref && Deno.env.get(ref)) || (fallbackEnv && Deno.env.get(fallbackEnv)) || '';
  if (!raw) {
    return { mode, account_number: account.account_number, data: account.data ?? {} };
  }
  try {
    const obj = JSON.parse(raw);
    return { mode, account_number: account.account_number, ...obj };
  } catch {
    return { api_key: raw, mode, account_number: account.account_number, data: account.data ?? {} };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handler
// ─────────────────────────────────────────────────────────────────────────────
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
