import type { CarrierAdapter, LabelRequest, LabelResponse, RateRequest, RateQuote, TrackingResponse } from '@/backend/carriers/types';

interface FedExConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  accountNumber: string | undefined;
  baseUrl: string;
}

function getConfig(): FedExConfig {
  return {
    clientId: process.env.FEDEX_CLIENT_ID,
    clientSecret: process.env.FEDEX_CLIENT_SECRET,
    accountNumber: process.env.FEDEX_ACCOUNT_NUMBER,
    baseUrl: process.env.FEDEX_BASE_URL ?? 'https://apis-sandbox.fedex.com',
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: FedExConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const response = await fetch(`${config.baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId ?? '',
      client_secret: config.clientSecret ?? '',
    }).toString(),
  });
  if (!response.ok) throw new Error(`FedEx auth failed (${response.status})`);
  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export const fedexAdapter: CarrierAdapter = {
  code: 'FedEx',
  isConfigured() {
    const c = getConfig();
    return Boolean(c.clientId && c.clientSecret && c.accountNumber);
  },
  async getRates(request: RateRequest): Promise<RateQuote[]> {
    const config = getConfig();
    if (!this.isConfigured()) throw new Error('FedEx is not configured');
    const token = await getAccessToken(config);
    const parcel = request.parcels[0];
    if (!parcel) throw new Error('At least one parcel is required');
    const response = await fetch(`${config.baseUrl}/rate/v1/rates/quotes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-locale': 'en_CA' },
      body: JSON.stringify({
        accountNumber: { value: config.accountNumber },
        requestedShipment: {
          shipper: { address: { postalCode: request.from.postalCode, countryCode: request.from.country } },
          recipient: { address: { postalCode: request.to.postalCode, countryCode: request.to.country } },
          pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
          rateRequestType: ['LIST'],
          requestedPackageLineItems: [{
            weight: { units: 'KG', value: parcel.weightGrams / 1000 },
            dimensions: { length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm, units: 'CM' },
          }],
        },
      }),
    });
    if (!response.ok) throw new Error(`FedEx rate request failed (${response.status})`);
    const data = await response.json() as { output: { rateReplyDetails: Array<{ serviceType: string; serviceName: string; ratedShipmentDetails: Array<{ totalNetCharge: number; currency: string }>; operationalDetail?: { transitTime?: string } }> } };
    return (data.output?.rateReplyDetails ?? []).map((r): RateQuote => {
      const rate = r.ratedShipmentDetails[0];
      return {
        carrier: 'FedEx',
        serviceCode: r.serviceType,
        serviceName: r.serviceName,
        amount: rate?.totalNetCharge ?? 0,
        currency: (rate?.currency ?? 'CAD').toLowerCase(),
        estimatedDeliveryDays: null,
        raw: { serviceType: r.serviceType, transit: r.operationalDetail?.transitTime ?? null },
      };
    });
  },
  async createLabel(request: LabelRequest): Promise<LabelResponse> {
    const config = getConfig();
    if (!this.isConfigured()) throw new Error('FedEx is not configured');
    const token = await getAccessToken(config);
    const parcel = request.parcels[0];
    if (!parcel) throw new Error('At least one parcel is required');
    const response = await fetch(`${config.baseUrl}/ship/v1/shipments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-locale': 'en_CA' },
      body: JSON.stringify({
        labelResponseOptions: 'URL_ONLY',
        accountNumber: { value: config.accountNumber },
        requestedShipment: {
          shipper: { contact: { personName: request.from.name, phoneNumber: request.from.phone ?? '0000000000' }, address: { streetLines: [request.from.street1], city: request.from.city, stateOrProvinceCode: request.from.province, postalCode: request.from.postalCode, countryCode: request.from.country } },
          recipients: [{ contact: { personName: request.to.name, phoneNumber: request.to.phone ?? '0000000000' }, address: { streetLines: [request.to.street1], city: request.to.city, stateOrProvinceCode: request.to.province, postalCode: request.to.postalCode, countryCode: request.to.country } }],
          pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
          serviceType: request.serviceCode,
          packagingType: 'YOUR_PACKAGING',
          shippingChargesPayment: { paymentType: 'SENDER', payor: { responsibleParty: { accountNumber: { value: config.accountNumber } } } },
          labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'PDF', labelStockType: 'PAPER_4X6' },
          requestedPackageLineItems: [{
            weight: { units: 'KG', value: parcel.weightGrams / 1000 },
            dimensions: { length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm, units: 'CM' },
          }],
        },
      }),
    });
    if (!response.ok) throw new Error(`FedEx label request failed (${response.status})`);
    const data = await response.json() as { output: { transactionShipments: Array<{ masterTrackingNumber: string; pieceResponses: Array<{ packageDocuments: Array<{ url: string }> }>; shipmentRating?: { shipmentRateDetails: Array<{ totalNetCharge: number; currency: string }> } }> } };
    const ship = data.output.transactionShipments[0];
    const trackingNumber = ship?.masterTrackingNumber ?? '';
    const labelUrl = ship?.pieceResponses[0]?.packageDocuments[0]?.url ?? null;
    const rate = ship?.shipmentRating?.shipmentRateDetails[0];
    return {
      carrier: 'FedEx',
      trackingNumber,
      labelUrl,
      labelFormat: 'PDF',
      rateAmount: rate?.totalNetCharge ?? 0,
      currency: (rate?.currency ?? 'CAD').toLowerCase(),
      raw: data as unknown as Record<string, unknown>,
    };
  },
  async getTracking(trackingNumber: string): Promise<TrackingResponse> {
    const config = getConfig();
    if (!this.isConfigured()) throw new Error('FedEx is not configured');
    const token = await getAccessToken(config);
    const response = await fetch(`${config.baseUrl}/track/v1/trackingnumbers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-locale': 'en_CA' },
      body: JSON.stringify({
        includeDetailedScans: true,
        trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
      }),
    });
    if (!response.ok) throw new Error(`FedEx tracking failed (${response.status})`);
    const data = await response.json() as { output: { completeTrackResults: Array<{ trackResults: Array<{ latestStatusDetail?: { statusByLocale?: string }; scanEvents?: Array<{ eventType: string; eventDescription: string; scanLocation?: { city?: string }; date: string }> }> }> } };
    const result = data.output?.completeTrackResults?.[0]?.trackResults?.[0];
    const events = (result?.scanEvents ?? []).map((e) => ({
      status: e.eventType,
      description: e.eventDescription,
      location: e.scanLocation?.city ?? null,
      occurredAt: e.date,
    }));
    return {
      carrier: 'FedEx',
      trackingNumber,
      status: result?.latestStatusDetail?.statusByLocale ?? 'Unknown',
      events,
      raw: data as unknown as Record<string, unknown>,
    };
  },
};
