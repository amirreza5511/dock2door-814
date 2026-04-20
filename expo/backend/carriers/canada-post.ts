import type { CarrierAdapter, LabelRequest, LabelResponse, RateRequest, RateQuote, TrackingResponse } from '@/backend/carriers/types';

interface CanadaPostConfig {
  apiKey: string | undefined;
  apiSecret: string | undefined;
  customerNumber: string | undefined;
  baseUrl: string;
}

function getConfig(): CanadaPostConfig {
  return {
    apiKey: process.env.CANADA_POST_API_KEY,
    apiSecret: process.env.CANADA_POST_API_SECRET,
    customerNumber: process.env.CANADA_POST_CUSTOMER_NUMBER,
    baseUrl: process.env.CANADA_POST_BASE_URL ?? 'https://ct.soa-gw.canadapost.ca',
  };
}

function authHeader(config: CanadaPostConfig): string {
  const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
  return `Basic ${token}`;
}

async function parseXml(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  return { raw: text };
}

export const canadaPostAdapter: CarrierAdapter = {
  code: 'CanadaPost',
  isConfigured() {
    const c = getConfig();
    return Boolean(c.apiKey && c.apiSecret && c.customerNumber);
  },
  async getRates(request: RateRequest): Promise<RateQuote[]> {
    const config = getConfig();
    if (!this.isConfigured()) {
      throw new Error('Canada Post is not configured');
    }
    const parcel = request.parcels[0];
    if (!parcel) {
      throw new Error('At least one parcel is required');
    }
    const weightKg = (parcel.weightGrams / 1000).toFixed(3);
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<mailing-scenario xmlns="http://www.canadapost.ca/ws/ship/rate-v4">
  <customer-number>${config.customerNumber}</customer-number>
  <parcel-characteristics>
    <weight>${weightKg}</weight>
    <dimensions>
      <length>${parcel.lengthCm}</length>
      <width>${parcel.widthCm}</width>
      <height>${parcel.heightCm}</height>
    </dimensions>
  </parcel-characteristics>
  <origin-postal-code>${request.from.postalCode.replace(/\s+/g, '')}</origin-postal-code>
  <destination>
    <domestic>
      <postal-code>${request.to.postalCode.replace(/\s+/g, '')}</postal-code>
    </domestic>
  </destination>
</mailing-scenario>`;
    const response = await fetch(`${config.baseUrl}/rs/ship/price`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(config),
        Accept: 'application/vnd.cpc.ship.rate-v4+xml',
        'Content-Type': 'application/vnd.cpc.ship.rate-v4+xml',
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Canada Post rate request failed (${response.status})`);
    }
    const raw = await parseXml(response);
    const priceMatches = Array.from(String(raw.raw ?? '').matchAll(/<price-quote>[\s\S]*?<service-code>(.*?)<\/service-code>[\s\S]*?<service-name>(.*?)<\/service-name>[\s\S]*?<due>(.*?)<\/due>[\s\S]*?(?:<expected-transit-time>(.*?)<\/expected-transit-time>)?[\s\S]*?<\/price-quote>/g));
    if (priceMatches.length === 0) {
      return [];
    }
    return priceMatches.map((match): RateQuote => ({
      carrier: 'CanadaPost',
      serviceCode: match[1] ?? '',
      serviceName: match[2] ?? '',
      amount: Number(match[3] ?? '0'),
      currency: 'cad',
      estimatedDeliveryDays: match[4] ? Number(match[4]) : null,
      raw: { serviceCode: match[1], serviceName: match[2] },
    }));
  },
  async createLabel(request: LabelRequest): Promise<LabelResponse> {
    const config = getConfig();
    if (!this.isConfigured()) {
      throw new Error('Canada Post is not configured');
    }
    const parcel = request.parcels[0];
    if (!parcel) {
      throw new Error('At least one parcel is required');
    }
    const weightKg = (parcel.weightGrams / 1000).toFixed(3);
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<non-contract-shipment xmlns="http://www.canadapost.ca/ws/ncshipment-v4">
  <requested-shipping-point>${request.from.postalCode.replace(/\s+/g, '')}</requested-shipping-point>
  <delivery-spec>
    <service-code>${request.serviceCode}</service-code>
    <sender>
      <name>${request.from.name}</name>
      <company>${request.from.company ?? request.from.name}</company>
      <contact-phone>${request.from.phone ?? ''}</contact-phone>
      <address-details>
        <address-line-1>${request.from.street1}</address-line-1>
        <city>${request.from.city}</city>
        <prov-state>${request.from.province}</prov-state>
        <postal-zip-code>${request.from.postalCode.replace(/\s+/g, '')}</postal-zip-code>
      </address-details>
    </sender>
    <destination>
      <name>${request.to.name}</name>
      <address-details>
        <address-line-1>${request.to.street1}</address-line-1>
        <city>${request.to.city}</city>
        <prov-state>${request.to.province}</prov-state>
        <country-code>${request.to.country}</country-code>
        <postal-zip-code>${request.to.postalCode.replace(/\s+/g, '')}</postal-zip-code>
      </address-details>
    </destination>
    <parcel-characteristics>
      <weight>${weightKg}</weight>
      <dimensions>
        <length>${parcel.lengthCm}</length>
        <width>${parcel.widthCm}</width>
        <height>${parcel.heightCm}</height>
      </dimensions>
    </parcel-characteristics>
    <preferences>
      <show-packing-instructions>true</show-packing-instructions>
    </preferences>
  </delivery-spec>
</non-contract-shipment>`;
    const response = await fetch(`${config.baseUrl}/rs/ncshipment`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(config),
        Accept: 'application/vnd.cpc.ncshipment-v4+xml',
        'Content-Type': 'application/vnd.cpc.ncshipment-v4+xml',
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Canada Post label request failed (${response.status})`);
    }
    const raw = await parseXml(response);
    const trackingMatch = /<tracking-pin>(.*?)<\/tracking-pin>/.exec(String(raw.raw ?? ''));
    const priceMatch = /<due>(.*?)<\/due>/.exec(String(raw.raw ?? ''));
    const labelMatch = /<link rel="label".*?href="(.*?)"/.exec(String(raw.raw ?? ''));
    return {
      carrier: 'CanadaPost',
      trackingNumber: trackingMatch?.[1] ?? '',
      labelUrl: labelMatch?.[1] ?? null,
      labelFormat: 'PDF',
      rateAmount: Number(priceMatch?.[1] ?? '0'),
      currency: 'cad',
      raw,
    };
  },
  async getTracking(trackingNumber: string): Promise<TrackingResponse> {
    const config = getConfig();
    if (!this.isConfigured()) {
      throw new Error('Canada Post is not configured');
    }
    const response = await fetch(`${config.baseUrl}/vis/track/pin/${trackingNumber}/detail`, {
      method: 'GET',
      headers: {
        Authorization: authHeader(config),
        Accept: 'application/vnd.cpc.track-v2+xml',
      },
    });
    if (!response.ok) {
      throw new Error(`Canada Post tracking request failed (${response.status})`);
    }
    const raw = await parseXml(response);
    const events = Array.from(String(raw.raw ?? '').matchAll(/<occurrence>[\s\S]*?<event-identifier>(.*?)<\/event-identifier>[\s\S]*?<event-date>(.*?)<\/event-date>[\s\S]*?<event-time>(.*?)<\/event-time>[\s\S]*?<event-description>(.*?)<\/event-description>[\s\S]*?<event-site>(.*?)<\/event-site>[\s\S]*?<\/occurrence>/g)).map((match) => ({
      status: match[1] ?? '',
      description: match[4] ?? null,
      location: match[5] ?? null,
      occurredAt: `${match[2]}T${match[3]}Z`,
    }));
    const statusMatch = /<status>(.*?)<\/status>/.exec(String(raw.raw ?? ''));
    return {
      carrier: 'CanadaPost',
      trackingNumber,
      status: statusMatch?.[1] ?? 'Unknown',
      events,
      raw,
    };
  },
};
