// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
// Shippo adapter (live). Requires SHIPPO_API_KEY at the credential level.

import type {
  CarrierAdapter, CarrierCredentials, NormalizedRate,
  PurchaseLabelRequest, PurchasedLabel, RateRequest, TrackingUpdate, VoidLabelRequest,
} from './types.ts';

const SP_BASE = 'https://api.goshippo.com';

async function sp(path: string, key: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `ShippoToken ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.detail ?? json?.error ?? `shippo_${r.status}`);
  return json;
}

function addrToShippo(a: any) {
  return {
    name: a.name ?? '', company: a.company ?? '',
    street1: a.street1 ?? '', street2: a.street2 ?? '',
    city: a.city ?? '', state: a.state ?? '',
    zip: a.zip ?? '', country: a.country ?? '',
    phone: a.phone ?? '', email: a.email ?? '',
  };
}

function parcelToShippo(p: RateRequest['parcel']) {
  return {
    length: String(p.length_cm || 10),
    width: String(p.width_cm || 10),
    height: String(p.height_cm || 10),
    distance_unit: 'cm',
    weight: String(p.weight_kg || 0.5),
    mass_unit: 'kg',
  };
}

export const shippo: CarrierAdapter = {
  code: 'SHIPPO',
  displayName: 'Shippo',
  implemented: true,

  async rateShop(req, creds): Promise<NormalizedRate[]> {
    if (!creds.api_key) throw new Error('shippo_api_key_missing');
    const ship = await sp('/shipments/', creds.api_key, {
      method: 'POST',
      body: JSON.stringify({
        address_from: addrToShippo(req.fromAddress),
        address_to: addrToShippo(req.toAddress),
        parcels: [parcelToShippo(req.parcel)],
        async: false,
      }),
    });
    const rates: any[] = Array.isArray(ship.rates) ? ship.rates : [];
    return rates.map((r) => ({
      carrier_code: 'SHIPPO',
      service_level: String(r.servicelevel?.token ?? '').toUpperCase(),
      service_name: `${r.provider} ${r.servicelevel?.name ?? ''}`.trim(),
      rate_amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'USD'),
      est_delivery_days: r.estimated_days ?? undefined,
      carrier_rate_id: String(r.object_id ?? ''),
      raw: { shippo_shipment_id: ship.object_id, rate: r, provider: r.provider },
    }));
  },

  async purchaseLabel(req, creds): Promise<PurchasedLabel> {
    if (!creds.api_key) throw new Error('shippo_api_key_missing');
    const tx = await sp('/transactions/', creds.api_key, {
      method: 'POST',
      body: JSON.stringify({ rate: req.rate.carrier_rate_id, label_file_type: 'PDF', async: false }),
    });
    if (tx.status !== 'SUCCESS') throw new Error(tx.messages?.[0]?.text ?? 'shippo_purchase_failed');
    return {
      carrier_code: 'SHIPPO',
      tracking_code: String(tx.tracking_number ?? ''),
      label_url: String(tx.label_url ?? ''),
      label_format: 'PDF',
      rate_amount: Number(req.rate.rate_amount),
      currency: req.rate.currency,
      carrier_shipment_id: String(tx.object_id ?? ''),
      raw: tx,
    };
  },

  async voidLabel(req, creds) {
    if (!creds.api_key) throw new Error('shippo_api_key_missing');
    const r = await sp('/refunds/', creds.api_key, {
      method: 'POST',
      body: JSON.stringify({ transaction: req.carrier_shipment_id, async: false }),
    });
    return { ok: r.status === 'PENDING' || r.status === 'SUCCESS', raw: r };
  },
};
