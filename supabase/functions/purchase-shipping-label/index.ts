// Supabase Edge Function — purchase-shipping-label
// Purchases a real shipping label via EasyPost and attaches it to a Dock2Door shipment.
//
// Authenticated: Supabase JWT required (caller must be provider/warehouse company member).
// Request JSON:
//   { shipment_id: string }
//   (shipment must already be created via `create_shipment_for_order` RPC with a selected rate id OR
//    service level; we build a fresh EasyPost Shipment from the rows to get a rate.)
//
// Required secrets:
//   EASYPOST_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const EASYPOST_KEY = Deno.env.get('EASYPOST_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EP_BASE = 'https://api.easypost.com/v2';

async function ep(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${EP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: 'Basic ' + btoa(`${EASYPOST_KEY}:`),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error?.message ?? `easypost_${r.status}`);
  return json;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405, headers: CORS });
  if (!EASYPOST_KEY) return jsonResp({ error: 'easypost_not_configured' }, 500);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResp({ error: 'unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, auth.replace('Bearer ', ''), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResp({ error: 'unauthorized' }, 401);
  const user = userData.user;

  let body: any;
  try { body = await req.json(); } catch { return jsonResp({ error: 'invalid_json' }, 400); }
  const shipmentId = String(body.shipment_id ?? '').trim();
  if (!shipmentId) return jsonResp({ error: 'shipment_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: shipment, error: sErr } = await admin
    .from('shipments')
    .select('id, order_id, provider_company_id, carrier_code, service_level, tracking_code, label_path, label_url, ship_from, ship_to, weight_kg, length_cm, width_cm, height_cm, status')
    .eq('id', shipmentId)
    .maybeSingle();
  if (sErr || !shipment) return jsonResp({ error: 'shipment_not_found' }, 404);
  if (shipment.label_url || shipment.label_path) return jsonResp({ error: 'label_already_purchased' }, 409);

  // Authorize: caller must be member of provider_company_id or admin
  const { data: roleRows } = await admin.from('user_roles').select('role').eq('user_id', user.id);
  const isAdmin = (roleRows ?? []).some((r) => String(r.role).toLowerCase() === 'admin');
  if (!isAdmin) {
    const { data: membership } = await admin
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('company_id', shipment.provider_company_id)
      .maybeSingle();
    if (!membership) return jsonResp({ error: 'forbidden' }, 403);
  }

  const from = shipment.ship_from ?? {};
  const to = shipment.ship_to ?? {};
  const parcel = {
    length: Number(shipment.length_cm ?? 0) || 10,
    width: Number(shipment.width_cm ?? 0) || 10,
    height: Number(shipment.height_cm ?? 0) || 10,
    weight: Number(shipment.weight_kg ?? 0) * 35.274 || 16,
  };

  // 1) Create EasyPost shipment
  const epShipment = await ep('/shipments', {
    method: 'POST',
    body: JSON.stringify({
      shipment: {
        to_address: to,
        from_address: from,
        parcel,
        options: { label_format: 'PDF' },
      },
    }),
  });

  // 2) Pick lowest rate matching service_level if provided, else cheapest overall
  const rates: any[] = Array.isArray(epShipment.rates) ? epShipment.rates : [];
  if (rates.length === 0) return jsonResp({ error: 'no_rates_available' }, 502);
  const preferred = shipment.service_level
    ? rates.find((r) => String(r.service).toUpperCase() === String(shipment.service_level).toUpperCase())
    : null;
  const chosen = preferred ?? rates.slice().sort((a, b) => Number(a.rate) - Number(b.rate))[0];

  // 3) Buy label
  const bought = await ep(`/shipments/${epShipment.id}/buy`, {
    method: 'POST',
    body: JSON.stringify({ rate: { id: chosen.id } }),
  });

  const tracking = bought.tracking_code ?? '';
  const labelUrl = bought.postage_label?.label_url ?? '';
  const rateCost = Number(bought.selected_rate?.rate ?? chosen.rate ?? 0);
  const currency = bought.selected_rate?.currency ?? chosen.currency ?? 'USD';
  const carrier = (bought.selected_rate?.carrier ?? chosen.carrier ?? 'EasyPost').toString();

  // 4) Attach label to our shipment via audited RPC (signature: uuid, text, text, numeric, text)
  const { error: attachErr } = await admin.rpc('attach_shipment_label', {
    p_shipment_id: shipmentId,
    p_tracking: tracking,
    p_label_path: labelUrl,
    p_rate: rateCost,
    p_currency: currency,
  });
  if (attachErr) {
    console.log('[purchase-shipping-label] attach rpc error', attachErr.message);
    return jsonResp({ error: 'attach_failed', detail: attachErr.message }, 500);
  }

  // Persist url + carrier separately (not covered by RPC)
  await admin.from('shipments').update({
    label_url: labelUrl,
    carrier_code: carrier,
  }).eq('id', shipmentId);

  // 5) Subscribe to tracker webhooks (EasyPost auto-creates when you pass webhook URL)
  try {
    await ep('/trackers', {
      method: 'POST',
      body: JSON.stringify({ tracker: { tracking_code: tracking, carrier } }),
    });
  } catch (err) {
    console.log('[purchase-shipping-label] tracker create non-fatal', (err as Error).message);
  }

  return jsonResp({
    shipment_id: shipmentId,
    tracking_code: tracking,
    label_url: labelUrl,
    carrier,
    rate: rateCost,
    currency,
  }, 200);
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
