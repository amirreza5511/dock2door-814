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

// --- EasyPost ---
const EP_BASE = 'https://api.easypost.com/v2';
async function ep(path: string, key: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${EP_BASE}${path}`, { ...init, headers: { Authorization: 'Basic ' + btoa(`${key}:`), 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `easypost_${r.status}`);
  return j;
}
function parcelToEP(p: ParcelDimensions) { return { length: p.length_cm || 10, width: p.width_cm || 10, height: p.height_cm || 10, weight: (p.weight_kg || 0.5) * 35.274 }; }
function mapEpStatus(s: string): TrackingUpdate['status'] { const u = s.toLowerCase(); if (u.includes('deliver')) return 'Delivered'; if (u.includes('out_for_delivery') || u.includes('out for delivery')) return 'OutForDelivery'; if (u.includes('return')) return 'Returned'; if (u.includes('exception') || u.includes('failure')) return 'Exception'; return 'InTransit'; }
const easypost: CarrierAdapter = {
  code: 'EASYPOST', displayName: 'EasyPost', implemented: true,
  async rateShop(req, creds) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const s = await ep('/shipments', creds.api_key, { method: 'POST', body: JSON.stringify({ shipment: { to_address: req.toAddress, from_address: req.fromAddress, parcel: parcelToEP(req.parcel), options: { label_format: 'PDF' } } }) });
    return (s.rates ?? []).map((r: any) => ({ carrier_code: 'EASYPOST' as const, service_level: String(r.service ?? '').toUpperCase(), service_name: `${r.carrier} ${r.service}`, rate_amount: Number(r.rate ?? 0), currency: String(r.currency ?? 'USD'), est_delivery_days: r.delivery_days ?? r.est_delivery_days ?? undefined, est_delivery_date: r.delivery_date ?? undefined, carrier_rate_id: `${s.id}:${r.id}`, raw: { ep_shipment_id: s.id, rate: r, carrier: r.carrier } }));
  },
  async purchaseLabel(req, creds) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const [sid, rid] = String(req.rate.carrier_rate_id).split(':');
    if (!sid || !rid) throw new Error('invalid_rate_id');
    const b = await ep(`/shipments/${sid}/buy`, creds.api_key, { method: 'POST', body: JSON.stringify({ rate: { id: rid } }) });
    return { carrier_code: 'EASYPOST', tracking_code: String(b.tracking_code ?? ''), label_url: String(b.postage_label?.label_url ?? ''), label_format: 'PDF', rate_amount: Number(b.selected_rate?.rate ?? 0), currency: String(b.selected_rate?.currency ?? 'USD'), carrier_shipment_id: String(b.id ?? ''), raw: b };
  },
  async voidLabel(req, creds) { if (!creds.api_key) throw new Error('easypost_api_key_missing'); const r = await ep(`/shipments/${req.carrier_shipment_id}/refund`, creds.api_key, { method: 'POST' }); return { ok: true, raw: r }; },
  async track(code, creds) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const r = await ep(`/trackers?tracking_code=${encodeURIComponent(code)}`, creds.api_key);
    const events = (r.trackers ?? []).flatMap((t: any) => t.tracking_details ?? []);
    return events.map((e: any) => ({ status: mapEpStatus(String(e.status ?? '')), event_code: String(e.status ?? ''), description: String(e.message ?? ''), occurred_at: String(e.datetime ?? new Date().toISOString()), city: e.tracking_location?.city, region: e.tracking_location?.state, country: e.tracking_location?.country, raw: e }));
  },
};

// --- Shippo ---
const SP_BASE = 'https://api.goshippo.com';
async function sp(path: string, key: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SP_BASE}${path}`, { ...init, headers: { Authorization: `ShippoToken ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.detail ?? j?.error ?? `shippo_${r.status}`);
  return j;
}
function addrShippo(a: any) { return { name: a.name ?? '', company: a.company ?? '', street1: a.street1 ?? '', street2: a.street2 ?? '', city: a.city ?? '', state: a.state ?? '', zip: a.zip ?? '', country: a.country ?? '', phone: a.phone ?? '', email: a.email ?? '' }; }
function parcelShippo(p: ParcelDimensions) { return { length: String(p.length_cm || 10), width: String(p.width_cm || 10), height: String(p.height_cm || 10), distance_unit: 'cm', weight: String(p.weight_kg || 0.5), mass_unit: 'kg' }; }
const shippo: CarrierAdapter = {
  code: 'SHIPPO', displayName: 'Shippo', implemented: true,
  async rateShop(req, creds) {
    if (!creds.api_key) throw new Error('shippo_api_key_missing');
    const s = await sp('/shipments/', creds.api_key, { method: 'POST', body: JSON.stringify({ address_from: addrShippo(req.fromAddress), address_to: addrShippo(req.toAddress), parcels: [parcelShippo(req.parcel)], async: false }) });
    return (s.rates ?? []).map((r: any) => ({ carrier_code: 'SHIPPO' as const, service_level: String(r.servicelevel?.token ?? '').toUpperCase(), service_name: `${r.provider} ${r.servicelevel?.name ?? ''}`.trim(), rate_amount: Number(r.amount ?? 0), currency: String(r.currency ?? 'USD'), est_delivery_days: r.estimated_days ?? undefined, carrier_rate_id: String(r.object_id ?? ''), raw: { shippo_shipment_id: s.object_id, rate: r, provider: r.provider } }));
  },
  async purchaseLabel(req, creds) {
    if (!creds.api_key) throw new Error('shippo_api_key_missing');
    const tx = await sp('/transactions/', creds.api_key, { method: 'POST', body: JSON.stringify({ rate: req.rate.carrier_rate_id, label_file_type: 'PDF', async: false }) });
    if (tx.status !== 'SUCCESS') throw new Error(tx.messages?.[0]?.text ?? 'shippo_purchase_failed');
    return { carrier_code: 'SHIPPO', tracking_code: String(tx.tracking_number ?? ''), label_url: String(tx.label_url ?? ''), label_format: 'PDF', rate_amount: Number(req.rate.rate_amount), currency: req.rate.currency, carrier_shipment_id: String(tx.object_id ?? ''), raw: tx };
  },
  async voidLabel(req, creds) { if (!creds.api_key) throw new Error('shippo_api_key_missing'); const r = await sp('/refunds/', creds.api_key, { method: 'POST', body: JSON.stringify({ transaction: req.carrier_shipment_id, async: false }) }); return { ok: r.status === 'PENDING' || r.status === 'SUCCESS', raw: r }; },
};

// --- Canada Post ---
const CP_BASE_LIVE = 'https://soa-gw.canadapost.ca'; const CP_BASE_TEST = 'https://ct.soa-gw.canadapost.ca';
function cpAuth(c: CarrierCredentials): string { if (!c.username || !c.password) throw new Error('canada_post_credentials_missing'); return 'Basic ' + btoa(`${c.username}:${c.password}`); }
function cpBase(c: CarrierCredentials): string { return c.mode === 'live' ? CP_BASE_LIVE : CP_BASE_TEST; }
async function cpXml(path: string, body: string, accept: string, contentType: string, c: CarrierCredentials): Promise<string> {
  const r = await fetch(`${cpBase(c)}${path}`, { method: 'POST', headers: { Authorization: cpAuth(c), 'Accept-Language': 'en-CA', Accept: accept, 'Content-Type': contentType }, body });
  const t = await r.text(); if (!r.ok) throw new Error(`canada_post_${r.status}: ${t.slice(0, 240)}`); return t;
}
function cpTag(xml: string, name: string): string | null { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`)); return m ? m[1] : null; }
function cpTagAll(xml: string, name: string): string[] { const re = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'g'); const out: string[] = []; let m: RegExpExecArray | null; while ((m = re.exec(xml)) !== null) out.push(m[1]); return out; }
const canadaPost: CarrierAdapter = {
  code: 'CANADA_POST', displayName: 'Canada Post', implemented: true,
  async rateShop(req, creds) {
    if (!creds.customer_number) throw new Error('canada_post_customer_number_missing');
    const fromZip = (req.fromAddress.zip ?? '').replace(/\s+/g, ''); const toZip = (req.toAddress.zip ?? '').replace(/\s+/g, '');
    const country = (req.toAddress.country ?? 'CA').toUpperCase();
    const weightKg = Math.max(0.1, req.parcel.weight_kg || 0.5);
    const dest = country === 'CA' ? `<domestic><postal-code>${toZip}</postal-code></domestic>` : country === 'US' ? `<united-states><zip-code>${toZip}</zip-code></united-states>` : `<international><country-code>${country}</country-code></international>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<mailing-scenario xmlns="http://www.canadapost.ca/ws/ship/rate-v4">\n  <customer-number>${creds.customer_number}</customer-number>\n  <parcel-characteristics>\n    <weight>${weightKg}</weight>\n    <dimensions>\n      <length>${req.parcel.length_cm || 10}</length>\n      <width>${req.parcel.width_cm || 10}</width>\n      <height>${req.parcel.height_cm || 10}</height>\n    </dimensions>\n  </parcel-characteristics>\n  <origin-postal-code>${fromZip}</origin-postal-code>\n  <destination>${dest}</destination>\n</mailing-scenario>`;
    const res = await cpXml('/rs/ship/price', xml, 'application/vnd.cpc.ship.rate-v4+xml', 'application/vnd.cpc.ship.rate-v4+xml', creds);
    return cpTagAll(res, 'price-quote').map((q) => { const service = cpTag(q, 'service-code') ?? ''; const name = cpTag(q, 'service-name') ?? service; const total = Number(cpTag(q, 'due') ?? '0'); const days = Number(cpTag(q, 'expected-transit-time') ?? '0'); return { carrier_code: 'CANADA_POST' as const, service_level: service.toUpperCase(), service_name: `Canada Post ${name}`, rate_amount: total, currency: 'CAD', est_delivery_days: days || undefined, est_delivery_date: cpTag(q, 'expected-delivery-date') ?? undefined, carrier_rate_id: service, raw: { quote: q } }; });
  },
  async purchaseLabel() { throw new Error('canada_post_purchase_label_requires_contract_setup'); },
  async voidLabel() { throw new Error('canada_post_void_requires_contract_setup'); },
  async createManifest() { throw new Error('canada_post_manifest_requires_contract_setup'); },
};

// --- UPS ---
const UPS_BASE_LIVE = 'https://onlinetools.ups.com'; const UPS_BASE_TEST = 'https://wwwcie.ups.com';
function upsBase(c: CarrierCredentials): string { return c.mode === 'live' ? UPS_BASE_LIVE : UPS_BASE_TEST; }
async function upsToken(c: CarrierCredentials): Promise<string> {
  if (!c.client_id || !c.client_secret) throw new Error('ups_oauth_credentials_missing');
  const r = await fetch(`${upsBase(c)}/security/v1/oauth/token`, { method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${c.client_id}:${c.client_secret}`), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error(`ups_oauth_${r.status}`); return j.access_token;
}
function addrUPS(a: any) { return { AddressLine: [a.street1 ?? '', a.street2 ?? ''].filter(Boolean), City: a.city ?? '', StateProvinceCode: a.state ?? '', PostalCode: (a.zip ?? '').replace(/\s+/g, ''), CountryCode: (a.country ?? 'US').toUpperCase() }; }
const ups: CarrierAdapter = {
  code: 'UPS', displayName: 'UPS', implemented: true,
  async rateShop(req, creds) {
    if (!creds.account_number) throw new Error('ups_account_number_missing');
    const t = await upsToken(creds);
    const body = { RateRequest: { Request: { TransactionReference: { CustomerContext: 'rate shop' } }, Shipment: { Shipper: { ShipperNumber: creds.account_number, Address: addrUPS(req.fromAddress) }, ShipTo: { Address: addrUPS(req.toAddress) }, ShipFrom: { Address: addrUPS(req.fromAddress) }, Service: req.serviceLevel ? { Code: req.serviceLevel } : undefined, Package: [{ PackagingType: { Code: '02' }, Dimensions: { UnitOfMeasurement: { Code: 'CM' }, Length: String(req.parcel.length_cm || 10), Width: String(req.parcel.width_cm || 10), Height: String(req.parcel.height_cm || 10) }, PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: String(req.parcel.weight_kg || 0.5) } }] } } };
    const r = await fetch(`${upsBase(creds)}/api/rating/v2403/Shop`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`ups_rating_${r.status}`);
    const rated: any[] = Array.isArray(j?.RateResponse?.RatedShipment) ? j.RateResponse.RatedShipment : j?.RateResponse?.RatedShipment ? [j.RateResponse.RatedShipment] : [];
    return rated.map((rs: any) => { const code = String(rs?.Service?.Code ?? ''); const m = rs?.NegotiatedRateCharges?.TotalCharge ?? rs?.TotalCharges ?? {}; return { carrier_code: 'UPS' as const, service_level: code, service_name: `UPS ${code}`, rate_amount: Number(m?.MonetaryValue ?? 0), currency: String(m?.CurrencyCode ?? 'USD'), est_delivery_days: Number(rs?.GuaranteedDelivery?.BusinessDaysInTransit ?? 0) || undefined, carrier_rate_id: code, raw: rs }; });
  },
  async purchaseLabel() { throw new Error('ups_purchase_label_requires_negotiated_rate_contract'); },
  async voidLabel() { throw new Error('ups_void_label_requires_negotiated_rate_contract'); },
};

// --- DHL ---
const DHL_BASE_LIVE = 'https://express.api.dhl.com/mydhlapi'; const DHL_BASE_TEST = 'https://express.api.dhl.com/mydhlapi/test';
function dhlBase(c: CarrierCredentials): string { return c.mode === 'live' ? DHL_BASE_LIVE : DHL_BASE_TEST; }
const dhl: CarrierAdapter = {
  code: 'DHL', displayName: 'DHL Express', implemented: true,
  async rateShop(req, creds) {
    if (!creds.username || !creds.password || !creds.account_number) throw new Error('dhl_credentials_missing');
    const planned = new Date(); planned.setDate(planned.getDate() + 1);
    const body = { customerDetails: { shipperDetails: { postalCode: (req.fromAddress.zip ?? '').replace(/\s+/g, ''), cityName: req.fromAddress.city ?? '', countryCode: (req.fromAddress.country ?? 'US').toUpperCase() }, receiverDetails: { postalCode: (req.toAddress.zip ?? '').replace(/\s+/g, ''), cityName: req.toAddress.city ?? '', countryCode: (req.toAddress.country ?? 'US').toUpperCase() } }, accounts: [{ typeCode: 'shipper', number: creds.account_number }], productsAndServices: [{ productCode: 'P' }], plannedShippingDateAndTime: `${planned.toISOString().slice(0, 10)}T10:00:00GMT+00:00`, unitOfMeasurement: 'metric', isCustomsDeclarable: (req.toAddress.country ?? '') !== (req.fromAddress.country ?? ''), packages: [{ weight: req.parcel.weight_kg || 0.5, dimensions: { length: req.parcel.length_cm || 10, width: req.parcel.width_cm || 10, height: req.parcel.height_cm || 10 } }] };
    const r = await fetch(`${dhlBase(creds)}/rates`, { method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${creds.username}:${creds.password}`), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`dhl_rates_${r.status}`);
    return (j?.products ?? []).map((p: any) => { const total = (p.totalPrice ?? []).find((x: any) => x.currencyType === 'BILLC') ?? p.totalPrice?.[0] ?? {}; return { carrier_code: 'DHL' as const, service_level: String(p.productCode ?? ''), service_name: `DHL ${p.productName ?? p.productCode ?? ''}`, rate_amount: Number(total.price ?? 0), currency: String(total.priceCurrency ?? 'USD'), est_delivery_date: p?.deliveryCapabilities?.estimatedDeliveryDateAndTime?.slice(0, 10), carrier_rate_id: String(p.productCode ?? ''), raw: p }; });
  },
  async purchaseLabel() { throw new Error('dhl_purchase_label_requires_account_contract'); },
  async voidLabel() { throw new Error('dhl_void_label_not_supported_via_api'); },
};

// --- FedEx ---
const FX_BASE_LIVE = 'https://apis.fedex.com'; const FX_BASE_TEST = 'https://apis-sandbox.fedex.com';
function fxBase(c: CarrierCredentials): string { return c.mode === 'live' ? FX_BASE_LIVE : FX_BASE_TEST; }
async function fxToken(c: CarrierCredentials): Promise<string> {
  if (!c.client_id || !c.client_secret) throw new Error('fedex_oauth_credentials_missing');
  const r = await fetch(`${fxBase(c)}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=client_credentials&client_id=${encodeURIComponent(c.client_id)}&client_secret=${encodeURIComponent(c.client_secret)}` });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.access_token) throw new Error(`fedex_oauth_${r.status}`); return j.access_token;
}
function addrFX(a: any) { return { streetLines: [a.street1 ?? '', a.street2 ?? ''].filter(Boolean), city: a.city ?? '', stateOrProvinceCode: a.state ?? '', postalCode: (a.zip ?? '').replace(/\s+/g, ''), countryCode: (a.country ?? 'US').toUpperCase() }; }
const fedex: CarrierAdapter = {
  code: 'FEDEX', displayName: 'FedEx', implemented: true,
  async rateShop(req, creds) {
    if (!creds.account_number) throw new Error('fedex_account_number_missing');
    const t = await fxToken(creds);
    const body = { accountNumber: { value: creds.account_number }, rateRequestControlParameters: { returnTransitTimes: true }, requestedShipment: { shipper: { address: addrFX(req.fromAddress) }, recipient: { address: addrFX(req.toAddress) }, pickupType: 'DROPOFF_AT_FEDEX_LOCATION', rateRequestType: ['LIST', 'ACCOUNT'], requestedPackageLineItems: [{ weight: { units: 'KG', value: req.parcel.weight_kg || 0.5 }, dimensions: { length: req.parcel.length_cm || 10, width: req.parcel.width_cm || 10, height: req.parcel.height_cm || 10, units: 'CM' } }] } };
    const r = await fetch(`${fxBase(creds)}/rate/v1/rates/quotes`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`fedex_rate_${r.status}`);
    return (j?.output?.rateReplyDetails ?? []).map((d: any) => ({ carrier_code: 'FEDEX' as const, service_level: String(d?.serviceType ?? ''), service_name: `FedEx ${d?.serviceName ?? d?.serviceType ?? ''}`, rate_amount: Number(d?.ratedShipmentDetails?.[0]?.totalNetCharge ?? 0), currency: String(d?.ratedShipmentDetails?.[0]?.currency ?? 'USD'), est_delivery_days: Number(d?.commit?.transitDays?.minimumTransitTime ?? 0) || undefined, carrier_rate_id: String(d?.serviceType ?? ''), raw: d }));
  },
  async purchaseLabel() { throw new Error('fedex_purchase_label_requires_ship_api_contract'); },
  async voidLabel() { throw new Error('fedex_void_label_requires_ship_api_contract'); },
};

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
