// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
// FedEx adapter — live OAuth2 + Rate API v1.
// Live mode requires:
//   client_id        = FedEx Developer API key
//   client_secret    = FedEx Developer secret
//   account_number   = FedEx shipper account

import type {
  CarrierAdapter, CarrierCredentials, NormalizedRate,
  PurchaseLabelRequest, PurchasedLabel, RateRequest, VoidLabelRequest,
} from './types.ts';

const FX_BASE_LIVE = 'https://apis.fedex.com';
const FX_BASE_TEST = 'https://apis-sandbox.fedex.com';

function base(creds: CarrierCredentials): string {
  return creds.mode === 'live' ? FX_BASE_LIVE : FX_BASE_TEST;
}

async function token(creds: CarrierCredentials): Promise<string> {
  if (!creds.client_id || !creds.client_secret) throw new Error('fedex_oauth_credentials_missing');
  const r = await fetch(`${base(creds)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(creds.client_id)}&client_secret=${encodeURIComponent(creds.client_secret)}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`fedex_oauth_${r.status}`);
  return j.access_token;
}

export const fedex: CarrierAdapter = {
  code: 'FEDEX',
  displayName: 'FedEx',
  implemented: true,

  async rateShop(req: RateRequest, creds: CarrierCredentials): Promise<NormalizedRate[]> {
    if (!creds.account_number) throw new Error('fedex_account_number_missing');
    const t = await token(creds);
    const body = {
      accountNumber: { value: creds.account_number },
      rateRequestControlParameters: { returnTransitTimes: true },
      requestedShipment: {
        shipper: { address: addrFX(req.fromAddress) },
        recipient: { address: addrFX(req.toAddress) },
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        rateRequestType: ['LIST', 'ACCOUNT'],
        requestedPackageLineItems: [{
          weight: { units: 'KG', value: req.parcel.weight_kg || 0.5 },
          dimensions: {
            length: req.parcel.length_cm || 10,
            width: req.parcel.width_cm || 10,
            height: req.parcel.height_cm || 10,
            units: 'CM',
          },
        }],
      },
    };
    const r = await fetch(`${base(creds)}/rate/v1/rates/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
      },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`fedex_rate_${r.status}: ${JSON.stringify(j).slice(0, 240)}`);

    const details: any[] = j?.output?.rateReplyDetails ?? [];
    return details.map((d) => {
      const total = d?.ratedShipmentDetails?.[0]?.totalNetCharge ?? 0;
      const currency = d?.ratedShipmentDetails?.[0]?.currency ?? 'USD';
      return {
        carrier_code: 'FEDEX' as const,
        service_level: String(d?.serviceType ?? ''),
        service_name: `FedEx ${d?.serviceName ?? d?.serviceType ?? ''}`,
        rate_amount: Number(total ?? 0),
        currency: String(currency),
        est_delivery_days: Number(d?.commit?.transitDays?.minimumTransitTime ?? 0) || undefined,
        carrier_rate_id: String(d?.serviceType ?? ''),
        raw: d,
      };
    });
  },

  async purchaseLabel(_req: PurchaseLabelRequest, _creds: CarrierCredentials): Promise<PurchasedLabel> {
    throw new Error('fedex_purchase_label_requires_ship_api_contract');
  },

  async voidLabel(_req: VoidLabelRequest, _creds: CarrierCredentials) {
    throw new Error('fedex_void_label_requires_ship_api_contract');
  },
};

function addrFX(a: any) {
  return {
    streetLines: [a.street1 ?? '', a.street2 ?? ''].filter(Boolean),
    city: a.city ?? '',
    stateOrProvinceCode: a.state ?? '',
    postalCode: (a.zip ?? '').replace(/\s+/g, ''),
    countryCode: (a.country ?? 'US').toUpperCase(),
  };
}
