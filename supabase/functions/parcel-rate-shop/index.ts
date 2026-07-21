// Supabase Edge Function — parcel-rate-shop (consumer Ship & Return flow)
// Stateless live rate-shopping for the consumer parcel flow. Calls Shippo and
// EasyPost directly using project env keys (SHIPPO_API_KEY / EASYPOST_API_KEY),
// so it needs no carrier_accounts rows or the business `shipments` table.
//
// Auth: Supabase JWT (any signed-in user).
// Body: {
//   from: { name?, street1?, city?, state?, zip, country },
//   to:   { name?, street1?, city?, state?, zip, country },
//   parcel: { length_cm, width_cm, height_cm, weight_kg },
//   carriers?: string[]  // subset of ['SHIPPO','EASYPOST']; defaults to both
// }
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

interface Addr { name?: string; company?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string; phone?: string; email?: string; }
interface Dims { length_cm: number; width_cm: number; height_cm: number; weight_kg: number; }
interface Rate {
  carrier: 'SHIPPO' | 'EASYPOST';
  provider: string;
  service_level: string;
  service_name: string;
  amount: number;
  currency: string;
  est_delivery_days?: number;
  carrier_rate_id: string;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

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
function parcelToEP(p: Dims) {
  return { length: p.length_cm || 10, width: p.width_cm || 10, height: p.height_cm || 10, weight: (p.weight_kg || 0.5) * 35.274 };
}
async function easypostRates(from: Addr, to: Addr, parcel: Dims): Promise<Rate[]> {
  const key = Deno.env.get('EASYPOST_API_KEY') ?? '';
  if (!key) return [];
  const s = await ep('/shipments', key, {
    method: 'POST',
    body: JSON.stringify({ shipment: { to_address: to, from_address: from, parcel: parcelToEP(parcel), options: { label_format: 'PDF' } } }),
  });
  return (s.rates ?? []).map((r: any) => ({
    carrier: 'EASYPOST' as const,
    provider: String(r.carrier ?? ''),
    service_level: String(r.service ?? '').toUpperCase(),
    service_name: `${r.carrier} ${r.service}`.trim(),
    amount: Number(r.rate ?? 0),
    currency: String(r.currency ?? 'USD'),
    est_delivery_days: r.delivery_days ?? r.est_delivery_days ?? undefined,
    carrier_rate_id: `${s.id}:${r.id}`,
  }));
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
function addrShippo(a: Addr) {
  return { name: a.name ?? 'Customer', company: a.company ?? '', street1: a.street1 ?? '', city: a.city ?? '', state: a.state ?? '', zip: a.zip ?? '', country: a.country ?? 'US', phone: a.phone ?? '', email: a.email ?? '' };
}
function parcelShippo(p: Dims) {
  return { length: String(p.length_cm || 10), width: String(p.width_cm || 10), height: String(p.height_cm || 10), distance_unit: 'cm', weight: String(p.weight_kg || 0.5), mass_unit: 'kg' };
}
async function shippoRates(from: Addr, to: Addr, parcel: Dims): Promise<Rate[]> {
  const key = Deno.env.get('SHIPPO_API_KEY') ?? '';
  if (!key) return [];
  const s = await sp('/shipments/', key, {
    method: 'POST',
    body: JSON.stringify({ address_from: addrShippo(from), address_to: addrShippo(to), parcels: [parcelShippo(parcel)], async: false }),
  });
  return (s.rates ?? []).map((r: any) => ({
    carrier: 'SHIPPO' as const,
    provider: String(r.provider ?? ''),
    service_level: String(r.servicelevel?.token ?? '').toUpperCase(),
    service_name: `${r.provider} ${r.servicelevel?.name ?? ''}`.trim(),
    amount: Number(r.amount ?? 0),
    currency: String(r.currency ?? 'USD'),
    est_delivery_days: r.estimated_days ?? undefined,
    carrier_rate_id: String(r.object_id ?? ''),
  }));
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
  const from: Addr = body.from ?? {};
  const to: Addr = body.to ?? {};
  const parcel: Dims = {
    length_cm: Number(body.parcel?.length_cm ?? 10),
    width_cm: Number(body.parcel?.width_cm ?? 10),
    height_cm: Number(body.parcel?.height_cm ?? 10),
    weight_kg: Number(body.parcel?.weight_kg ?? 0.5),
  };
  const carriers: string[] = Array.isArray(body.carriers) && body.carriers.length
    ? body.carriers.map((c: string) => String(c).toUpperCase())
    : ['SHIPPO', 'EASYPOST'];

  const rates: Rate[] = [];
  const errors: { carrier: string; error: string }[] = [];

  await Promise.all(carriers.map(async (c) => {
    try {
      if (c === 'SHIPPO') rates.push(...await shippoRates(from, to, parcel));
      else if (c === 'EASYPOST') rates.push(...await easypostRates(from, to, parcel));
    } catch (e) {
      errors.push({ carrier: c, error: (e as Error).message });
    }
  }));

  rates.sort((a, b) => a.amount - b.amount);
  return jsonResp({ rates, errors, attempted: carriers.length }, 200);
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
