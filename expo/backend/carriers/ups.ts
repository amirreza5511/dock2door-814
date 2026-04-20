import type { CarrierAdapter, LabelRequest, LabelResponse, RateRequest, RateQuote, TrackingResponse } from '@/backend/carriers/types';

interface UPSConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  accountNumber: string | undefined;
  baseUrl: string;
}

function getConfig(): UPSConfig {
  return {
    clientId: process.env.UPS_CLIENT_ID,
    clientSecret: process.env.UPS_CLIENT_SECRET,
    accountNumber: process.env.UPS_ACCOUNT_NUMBER,
    baseUrl: process.env.UPS_BASE_URL ?? 'https://wwwcie.ups.com',
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: UPSConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(`${config.baseUrl}/security/v1/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });
  if (!response.ok) throw new Error(`UPS auth failed (${response.status})`);
  const data = await response.json() as { access_token: string; expires_in: string };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
  return data.access_token;
}

export const upsAdapter: CarrierAdapter = {
  code: 'UPS',
  isConfigured() {
    const c = getConfig();
    return Boolean(c.clientId && c.clientSecret && c.accountNumber);
  },
  async getRates(request: RateRequest): Promise<RateQuote[]> {
    const config = getConfig();
    if (!this.isConfigured()) throw new Error('UPS is not configured');
    const token = await getAccessToken(config);
    const parcel = request.parcels[0];
    if (!parcel) throw new Error('At least one parcel is required');
    const response = await fetch(`${config.baseUrl}/api/rating/v2403/Shop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RateRequest: {
          Request: { RequestOption: 'Shop', TransactionReference: { CustomerContext: 'dock2door' } },
          Shipment: {
            Shipper: { ShipperNumber: config.accountNumber, Address: { PostalCode: request.from.postalCode, CountryCode: request.from.country } },
            ShipTo: { Address: { PostalCode: request.to.postalCode, CountryCode: request.to.country } },
            ShipFrom: { Address: { PostalCode: request.from.postalCode, CountryCode: request.from.country } },
            Package: {
              PackagingType: { Code: '02' },
              Dimensions: { UnitOfMeasurement: { Code: 'CM' }, Length: String(parcel.lengthCm), Width: String(parcel.widthCm), Height: String(parcel.heightCm) },
              PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: String((parcel.weightGrams / 1000).toFixed(2)) },
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`UPS rate request failed (${response.status})`);
    const data = await response.json() as { RateResponse?: { RatedShipment?: Array<{ Service: { Code: string }; TotalCharges: { MonetaryValue: string; CurrencyCode: string }; GuaranteedDelivery?: { BusinessDaysInTransit?: string } }> | { Service: { Code: string }; TotalCharges: { MonetaryValue: string; CurrencyCode: string } } } };
    const rated = data.RateResponse?.RatedShipment;
    const shipments = Array.isArray(rated) ? rated : rated ? [rated] : [];
    return shipments.map((r): RateQuote => ({
      carrier: 'UPS',
      serviceCode: r.Service.Code,
      serviceName: r.Service.Code,
      amount: Number(r.TotalCharges.MonetaryValue),
      currency: r.TotalCharges.CurrencyCode.toLowerCase(),
      estimatedDeliveryDays: 'GuaranteedDelivery' in r && r.GuaranteedDelivery?.BusinessDaysInTransit ? Number(r.GuaranteedDelivery.BusinessDaysInTransit) : null,
      raw: { serviceCode: r.Service.Code },
    }));
  },
  async createLabel(request: LabelRequest): Promise<LabelResponse> {
    const config = getConfig();
    if (!this.isConfigured()) throw new Error('UPS is not configured');
    const token = await getAccessToken(config);
    const parcel = request.parcels[0];
    if (!parcel) throw new Error('At least one parcel is required');
    const response = await fetch(`${config.baseUrl}/api/shipments/v2403/ship`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ShipmentRequest: {
          Request: { RequestOption: 'nonvalidate' },
          Shipment: {
            Description: request.reference ?? 'Dock2Door shipment',
            Shipper: { Name: request.from.name, ShipperNumber: config.accountNumber, Address: { AddressLine: [request.from.street1], City: request.from.city, StateProvinceCode: request.from.province, PostalCode: request.from.postalCode, CountryCode: request.from.country } },
            ShipTo: { Name: request.to.name, Address: { AddressLine: [request.to.street1], City: request.to.city, StateProvinceCode: request.to.province, PostalCode: request.to.postalCode, CountryCode: request.to.country } },
            ShipFrom: { Name: request.from.name, Address: { AddressLine: [request.from.street1], City: request.from.city, StateProvinceCode: request.from.province, PostalCode: request.from.postalCode, CountryCode: request.from.country } },
            PaymentInformation: { ShipmentCharge: { Type: '01', BillShipper: { AccountNumber: config.accountNumber } } },
            Service: { Code: request.serviceCode },
            Package: {
              Packaging: { Code: '02' },
              Dimensions: { UnitOfMeasurement: { Code: 'CM' }, Length: String(parcel.lengthCm), Width: String(parcel.widthCm), Height: String(parcel.heightCm) },
              PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: String((parcel.weightGrams / 1000).toFixed(2)) },
            },
          },
          LabelSpecification: { LabelImageFormat: { Code: 'GIF' } },
        },
      }),
    });
    if (!response.ok) throw new Error(`UPS label request failed (${response.status})`);
    const data = await response.json() as { ShipmentResponse?: { ShipmentResults: { ShipmentIdentificationNumber: string; PackageResults: { TrackingNumber: string; ShippingLabel: { GraphicImage: string } } | { TrackingNumber: string; ShippingLabel: { GraphicImage: string } }[]; ShipmentCharges: { TotalCharges: { MonetaryValue: string; CurrencyCode: string } } } } };
    const results = data.ShipmentResponse?.ShipmentResults;
    const pkg = Array.isArray(results?.PackageResults) ? results?.PackageResults[0] : results?.PackageResults;
    const charges = results?.ShipmentCharges.TotalCharges;
    return {
      carrier: 'UPS',
      trackingNumber: pkg?.TrackingNumber ?? '',
      labelUrl: null,
      labelFormat: 'PNG',
      rateAmount: Number(charges?.MonetaryValue ?? '0'),
      currency: (charges?.CurrencyCode ?? 'CAD').toLowerCase(),
      raw: data as unknown as Record<string, unknown>,
    };
  },
  async getTracking(trackingNumber: string): Promise<TrackingResponse> {
    const config = getConfig();
    if (!this.isConfigured()) throw new Error('UPS is not configured');
    const token = await getAccessToken(config);
    const response = await fetch(`${config.baseUrl}/api/track/v1/details/${trackingNumber}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', transId: crypto.randomUUID(), transactionSrc: 'dock2door' },
    });
    if (!response.ok) throw new Error(`UPS tracking failed (${response.status})`);
    const data = await response.json() as { trackResponse?: { shipment?: Array<{ package?: Array<{ activity?: Array<{ status?: { description?: string; type?: string }; date: string; time: string; location?: { address?: { city?: string } } }>; currentStatus?: { description?: string } }> }> } };
    const pkg = data.trackResponse?.shipment?.[0]?.package?.[0];
    const events = (pkg?.activity ?? []).map((a) => ({
      status: a.status?.type ?? '',
      description: a.status?.description ?? null,
      location: a.location?.address?.city ?? null,
      occurredAt: `${a.date}T${a.time}Z`,
    }));
    return {
      carrier: 'UPS',
      trackingNumber,
      status: pkg?.currentStatus?.description ?? 'Unknown',
      events,
      raw: data as unknown as Record<string, unknown>,
    };
  },
};
