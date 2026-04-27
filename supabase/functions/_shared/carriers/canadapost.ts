// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
// Canada Post adapter — direct integration scaffold.
// Live mode requires Canada Post Developer Program credentials:
//   - username (API key)
//   - password (API secret)
//   - customer_number (mailed-by / contract)
//   - contract_id (optional — commercial contract)
// Endpoints:
//   POST https://soa-gw.canadapost.ca/rs/ship/price            (rate shop)
//   POST https://soa-gw.canadapost.ca/rs/{customer}/{customer}/shipment   (label)
//   POST https://soa-gw.canadapost.ca/rs/{customer}/{customer}/manifest   (manifest)
// Format: XML over HTTPS w/ Basic auth.
// We expose the same normalized interface; if creds aren't provided, all ops
// throw a clear error so the UI can show a "needs setup" badge.

import type {
  CarrierAdapter, CarrierCredentials, NormalizedRate,
  PurchaseLabelRequest, PurchasedLabel, RateRequest, VoidLabelRequest, ManifestRequest, NormalizedManifest,
} from './types.ts';

const CP_BASE_LIVE = 'https://soa-gw.canadapost.ca';
const CP_BASE_TEST = 'https://ct.soa-gw.canadapost.ca';

function authHeader(creds: CarrierCredentials): string {
  if (!creds.username || !creds.password) throw new Error('canada_post_credentials_missing');
  return 'Basic ' + btoa(`${creds.username}:${creds.password}`);
}

function base(creds: CarrierCredentials): string {
  return creds.mode === 'live' ? CP_BASE_LIVE : CP_BASE_TEST;
}

async function cpXml(path: string, body: string, accept: string, contentType: string, creds: CarrierCredentials): Promise<string> {
  const r = await fetch(`${base(creds)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(creds),
      'Accept-Language': 'en-CA',
      Accept: accept,
      'Content-Type': contentType,
    },
    body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`canada_post_${r.status}: ${text.slice(0, 240)}`);
  return text;
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
  return m ? m[1] : null;
}

function tagAll(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

export const canadaPost: CarrierAdapter = {
  code: 'CANADA_POST',
  displayName: 'Canada Post',
  implemented: true,

  async rateShop(req: RateRequest, creds: CarrierCredentials): Promise<NormalizedRate[]> {
    if (!creds.customer_number) throw new Error('canada_post_customer_number_missing');
    const fromZip = (req.fromAddress.zip ?? '').replace(/\s+/g, '');
    const toZip = (req.toAddress.zip ?? '').replace(/\s+/g, '');
    const country = (req.toAddress.country ?? 'CA').toUpperCase();
    const weightKg = Math.max(0.1, req.parcel.weight_kg || 0.5);

    const dest = country === 'CA'
      ? `<domestic><postal-code>${toZip}</postal-code></domestic>`
      : country === 'US'
        ? `<united-states><zip-code>${toZip}</zip-code></united-states>`
        : `<international><country-code>${country}</country-code></international>`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mailing-scenario xmlns="http://www.canadapost.ca/ws/ship/rate-v4">
  <customer-number>${creds.customer_number}</customer-number>
  <parcel-characteristics>
    <weight>${weightKg}</weight>
    <dimensions>
      <length>${req.parcel.length_cm || 10}</length>
      <width>${req.parcel.width_cm || 10}</width>
      <height>${req.parcel.height_cm || 10}</height>
    </dimensions>
  </parcel-characteristics>
  <origin-postal-code>${fromZip}</origin-postal-code>
  <destination>${dest}</destination>
</mailing-scenario>`;

    const res = await cpXml(
      '/rs/ship/price', xml,
      'application/vnd.cpc.ship.rate-v4+xml',
      'application/vnd.cpc.ship.rate-v4+xml',
      creds,
    );

    return tagAll(res, 'price-quote').map((q) => {
      const service = tag(q, 'service-code') ?? '';
      const name = tag(q, 'service-name') ?? service;
      const total = Number(tag(q, 'due') ?? tag(q, 'price-details>base') ?? '0');
      const days = Number(tag(q, 'expected-transit-time') ?? '0');
      return {
        carrier_code: 'CANADA_POST' as const,
        service_level: service.toUpperCase(),
        service_name: `Canada Post ${name}`,
        rate_amount: total,
        currency: 'CAD',
        est_delivery_days: days || undefined,
        est_delivery_date: tag(q, 'expected-delivery-date') ?? undefined,
        carrier_rate_id: service,
        raw: { quote: q },
      };
    });
  },

  async purchaseLabel(_req: PurchaseLabelRequest, _creds: CarrierCredentials): Promise<PurchasedLabel> {
    // Canada Post label purchase requires a contract or non-contract shipment XML
    // with full sender/recipient blocks plus delivery-spec; the shape varies by
    // contract. Implement against your contract once available, then return:
    //   { carrier_code:'CANADA_POST', tracking_code, label_url, ... }
    // The rest of the platform is already wired to call this.
    throw new Error('canada_post_purchase_label_requires_contract_setup');
  },

  async voidLabel(_req: VoidLabelRequest, _creds: CarrierCredentials) {
    throw new Error('canada_post_void_requires_contract_setup');
  },

  async createManifest(_req: ManifestRequest, _creds: CarrierCredentials): Promise<NormalizedManifest> {
    throw new Error('canada_post_manifest_requires_contract_setup');
  },
};
