// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
// UPS adapter — live OAuth2 + Rating API.
// Live mode requires:
//   client_id      = UPS Developer client_id
//   client_secret  = UPS Developer client_secret
//   account_number = UPS shipper account
// Endpoints used:
//   POST /security/v1/oauth/token    (token)
//   POST /api/rating/v2403/Shop      (rate shop)
//   POST /api/shipments/v2403/ship   (label) — purchase label requires negotiated rates contract.

import type {
  CarrierAdapter, CarrierCredentials, NormalizedRate,
  PurchaseLabelRequest, PurchasedLabel, RateRequest, VoidLabelRequest,
} from './types.ts';

const UPS_BASE_LIVE = 'https://onlinetools.ups.com';
const UPS_BASE_TEST = 'https://wwwcie.ups.com';

function base(creds: CarrierCredentials): string {
  return creds.mode === 'live' ? UPS_BASE_LIVE : UPS_BASE_TEST;
}

async function getToken(creds: CarrierCredentials): Promise<string> {
  if (!creds.client_id || !creds.client_secret) throw new Error('ups_oauth_credentials_missing');
  const r = await fetch(`${base(creds)}/security/v1/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${creds.client_id}:${creds.client_secret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`ups_oauth_${r.status}: ${j.error ?? ''}`);
  return j.access_token;
}

export const ups: CarrierAdapter = {
  code: 'UPS',
  displayName: 'UPS',
  implemented: true,

  async rateShop(req: RateRequest, creds: CarrierCredentials): Promise<NormalizedRate[]> {
    if (!creds.account_number) throw new Error('ups_account_number_missing');
    const token = await getToken(creds);
    const body = {
      RateRequest: {
        Request: { TransactionReference: { CustomerContext: 'Dock2Door rate shop' } },
        Shipment: {
          Shipper: {
            ShipperNumber: creds.account_number,
            Address: addrUPS(req.fromAddress),
          },
          ShipTo: { Address: addrUPS(req.toAddress) },
          ShipFrom: { Address: addrUPS(req.fromAddress) },
          Service: req.serviceLevel ? { Code: req.serviceLevel } : undefined,
          Package: [{
            PackagingType: { Code: '02' },
            Dimensions: {
              UnitOfMeasurement: { Code: 'CM' },
              Length: String(req.parcel.length_cm || 10),
              Width: String(req.parcel.width_cm || 10),
              Height: String(req.parcel.height_cm || 10),
            },
            PackageWeight: {
              UnitOfMeasurement: { Code: 'KGS' },
              Weight: String(req.parcel.weight_kg || 0.5),
            },
          }],
        },
      },
    };
    const r = await fetch(`${base(creds)}/api/rating/v2403/Shop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`ups_rating_${r.status}: ${JSON.stringify(j).slice(0, 240)}`);

    const rated: any[] = Array.isArray(j?.RateResponse?.RatedShipment)
      ? j.RateResponse.RatedShipment
      : j?.RateResponse?.RatedShipment ? [j.RateResponse.RatedShipment] : [];

    return rated.map((rs) => {
      const code = String(rs?.Service?.Code ?? '');
      const monetary = rs?.NegotiatedRateCharges?.TotalCharge ?? rs?.TotalCharges ?? {};
      return {
        carrier_code: 'UPS' as const,
        service_level: code,
        service_name: `UPS ${code}`,
        rate_amount: Number(monetary?.MonetaryValue ?? 0),
        currency: String(monetary?.CurrencyCode ?? 'USD'),
        est_delivery_days: Number(rs?.GuaranteedDelivery?.BusinessDaysInTransit ?? 0) || undefined,
        carrier_rate_id: code,
        raw: rs,
      };
    });
  },

  async purchaseLabel(_req: PurchaseLabelRequest, _creds: CarrierCredentials): Promise<PurchasedLabel> {
    throw new Error('ups_purchase_label_requires_negotiated_rate_contract');
  },

  async voidLabel(_req: VoidLabelRequest, _creds: CarrierCredentials) {
    throw new Error('ups_void_label_requires_negotiated_rate_contract');
  },
};

function addrUPS(a: any) {
  return {
    AddressLine: [a.street1 ?? '', a.street2 ?? ''].filter(Boolean),
    City: a.city ?? '',
    StateProvinceCode: a.state ?? '',
    PostalCode: (a.zip ?? '').replace(/\s+/g, ''),
    CountryCode: (a.country ?? 'US').toUpperCase(),
  };
}
