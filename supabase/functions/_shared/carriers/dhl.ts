// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
// DHL Express adapter — live MyDHL API rate quote.
// Live mode requires:
//   username        = MyDHL API username
//   password        = MyDHL API password
//   account_number  = DHL Express account number

import type {
  CarrierAdapter, CarrierCredentials, NormalizedRate,
  PurchaseLabelRequest, PurchasedLabel, RateRequest, VoidLabelRequest,
} from './types.ts';

const DHL_BASE_LIVE = 'https://express.api.dhl.com/mydhlapi';
const DHL_BASE_TEST = 'https://express.api.dhl.com/mydhlapi/test';

function base(creds: CarrierCredentials): string {
  return creds.mode === 'live' ? DHL_BASE_LIVE : DHL_BASE_TEST;
}

export const dhl: CarrierAdapter = {
  code: 'DHL',
  displayName: 'DHL Express',
  implemented: true,

  async rateShop(req: RateRequest, creds: CarrierCredentials): Promise<NormalizedRate[]> {
    if (!creds.username || !creds.password || !creds.account_number) {
      throw new Error('dhl_credentials_missing');
    }
    const planned = new Date(); planned.setDate(planned.getDate() + 1);
    const body = {
      customerDetails: {
        shipperDetails: {
          postalCode: (req.fromAddress.zip ?? '').replace(/\s+/g, ''),
          cityName: req.fromAddress.city ?? '',
          countryCode: (req.fromAddress.country ?? 'US').toUpperCase(),
        },
        receiverDetails: {
          postalCode: (req.toAddress.zip ?? '').replace(/\s+/g, ''),
          cityName: req.toAddress.city ?? '',
          countryCode: (req.toAddress.country ?? 'US').toUpperCase(),
        },
      },
      accounts: [{ typeCode: 'shipper', number: creds.account_number }],
      productsAndServices: [{ productCode: 'P' }],
      plannedShippingDateAndTime: `${planned.toISOString().slice(0, 10)}T10:00:00GMT+00:00`,
      unitOfMeasurement: 'metric',
      isCustomsDeclarable: (req.toAddress.country ?? '') !== (req.fromAddress.country ?? ''),
      packages: [{
        weight: req.parcel.weight_kg || 0.5,
        dimensions: {
          length: req.parcel.length_cm || 10,
          width: req.parcel.width_cm || 10,
          height: req.parcel.height_cm || 10,
        },
      }],
    };

    const r = await fetch(`${base(creds)}/rates`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${creds.username}:${creds.password}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`dhl_rates_${r.status}: ${JSON.stringify(j).slice(0, 240)}`);

    const products: any[] = Array.isArray(j?.products) ? j.products : [];
    return products.map((p) => {
      const total = (p.totalPrice ?? []).find((x: any) => x.currencyType === 'BILLC') ?? p.totalPrice?.[0] ?? {};
      return {
        carrier_code: 'DHL' as const,
        service_level: String(p.productCode ?? ''),
        service_name: `DHL ${p.productName ?? p.productCode ?? ''}`,
        rate_amount: Number(total.price ?? 0),
        currency: String(total.priceCurrency ?? 'USD'),
        est_delivery_date: p?.deliveryCapabilities?.estimatedDeliveryDateAndTime?.slice(0, 10),
        carrier_rate_id: String(p.productCode ?? ''),
        raw: p,
      };
    });
  },

  async purchaseLabel(_req: PurchaseLabelRequest, _creds: CarrierCredentials): Promise<PurchasedLabel> {
    throw new Error('dhl_purchase_label_requires_account_contract');
  },

  async voidLabel(_req: VoidLabelRequest, _creds: CarrierCredentials) {
    throw new Error('dhl_void_label_not_supported_via_api');
  },
};
