// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
// EasyPost adapter (live).
// EasyPost itself wraps Canada Post / UPS / FedEx / USPS / DHL etc., so this
// adapter alone gets you live multi-carrier rate-shopping in many cases.

import type {
  CarrierAdapter, CarrierCredentials, NormalizedRate,
  PurchaseLabelRequest, PurchasedLabel, RateRequest, TrackingUpdate, VoidLabelRequest,
} from './types.ts';

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

function parcelToEP(p: RateRequest['parcel']) {
  return {
    length: p.length_cm || 10,
    width: p.width_cm || 10,
    height: p.height_cm || 10,
    weight: (p.weight_kg || 0.5) * 35.274, // kg → oz
  };
}

export const easypost: CarrierAdapter = {
  code: 'EASYPOST',
  displayName: 'EasyPost',
  implemented: true,

  async rateShop(req: RateRequest, creds: CarrierCredentials): Promise<NormalizedRate[]> {
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

  async purchaseLabel(req: PurchaseLabelRequest, creds: CarrierCredentials): Promise<PurchasedLabel> {
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

  async voidLabel(req: VoidLabelRequest, creds: CarrierCredentials) {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const r = await ep(`/shipments/${req.carrier_shipment_id}/refund`, creds.api_key, { method: 'POST' });
    return { ok: true, raw: r };
  },

  async track(trackingCode: string, creds: CarrierCredentials): Promise<TrackingUpdate[]> {
    if (!creds.api_key) throw new Error('easypost_api_key_missing');
    const r = await ep(`/trackers?tracking_code=${encodeURIComponent(trackingCode)}`, creds.api_key);
    const trackers = Array.isArray(r.trackers) ? r.trackers : [];
    const events = trackers.flatMap((t: any) => Array.isArray(t.tracking_details) ? t.tracking_details : []);
    return events.map((e: any) => ({
      status: mapStatus(String(e.status ?? '')),
      event_code: String(e.status ?? ''),
      description: String(e.message ?? ''),
      occurred_at: String(e.datetime ?? new Date().toISOString()),
      city: e.tracking_location?.city,
      region: e.tracking_location?.state,
      country: e.tracking_location?.country,
      raw: e,
    }));
  },
};

function mapStatus(s: string): TrackingUpdate['status'] {
  const u = s.toLowerCase();
  if (u.includes('deliver')) return 'Delivered';
  if (u.includes('out_for_delivery') || u.includes('out for delivery')) return 'OutForDelivery';
  if (u.includes('return')) return 'Returned';
  if (u.includes('exception') || u.includes('failure')) return 'Exception';
  return 'InTransit';
}
