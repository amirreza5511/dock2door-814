import type { CarrierAdapter, LabelRequest, LabelResponse, RateRequest, RateQuote, TrackingResponse } from '@/backend/carriers/types';

interface PurolatorConfig {
  apiKey: string | undefined;
  apiPassword: string | undefined;
  accountNumber: string | undefined;
  baseUrl: string;
}

function getConfig(): PurolatorConfig {
  return {
    apiKey: process.env.PUROLATOR_API_KEY,
    apiPassword: process.env.PUROLATOR_API_PASSWORD,
    accountNumber: process.env.PUROLATOR_ACCOUNT_NUMBER,
    baseUrl: process.env.PUROLATOR_BASE_URL ?? 'https://devwebservices.purolator.com',
  };
}

function authHeader(config: PurolatorConfig): string {
  const token = Buffer.from(`${config.apiKey}:${config.apiPassword}`).toString('base64');
  return `Basic ${token}`;
}

export const purolatorAdapter: CarrierAdapter = {
  code: 'Purolator',
  isConfigured() {
    const c = getConfig();
    return Boolean(c.apiKey && c.apiPassword && c.accountNumber);
  },
  async getRates(request: RateRequest): Promise<RateQuote[]> {
    const config = getConfig();
    if (!this.isConfigured()) throw new Error('Purolator is not configured');
    const parcel = request.parcels[0];
    if (!parcel) throw new Error('At least one parcel is required');
    const response = await fetch(`${config.baseUrl}/EWS/V2/Estimating/EstimatingService.asmx`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(config),
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://purolator.com/pws/service/v2/GetFullEstimate',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <RequestContext xmlns="http://purolator.com/pws/datatypes/v2">
      <Version>2.1</Version>
      <Language>en</Language>
      <GroupID>dock2door</GroupID>
      <RequestReference>rate</RequestReference>
    </RequestContext>
  </soap:Header>
  <soap:Body>
    <GetFullEstimateRequest xmlns="http://purolator.com/pws/datatypes/v2">
      <Shipment>
        <SenderInformation>
          <Address>
            <PostalCode>${request.from.postalCode.replace(/\s+/g, '')}</PostalCode>
            <CountryCode>${request.from.country}</CountryCode>
          </Address>
        </SenderInformation>
        <ReceiverInformation>
          <Address>
            <PostalCode>${request.to.postalCode.replace(/\s+/g, '')}</PostalCode>
            <CountryCode>${request.to.country}</CountryCode>
          </Address>
        </ReceiverInformation>
        <PackageInformation>
          <TotalWeight>
            <Value>${(parcel.weightGrams / 453.592).toFixed(2)}</Value>
            <WeightUnit>lb</WeightUnit>
          </TotalWeight>
        </PackageInformation>
        <PaymentInformation>
          <PaymentType>Sender</PaymentType>
          <BillingAccountNumber>${config.accountNumber}</BillingAccountNumber>
        </PaymentInformation>
      </Shipment>
    </GetFullEstimateRequest>
  </soap:Body>
</soap:Envelope>`,
    });
    if (!response.ok) throw new Error(`Purolator rate request failed (${response.status})`);
    const text = await response.text();
    const matches = Array.from(text.matchAll(/<ShipmentEstimate>[\s\S]*?<ServiceID>(.*?)<\/ServiceID>[\s\S]*?<TotalPrice>(.*?)<\/TotalPrice>[\s\S]*?<\/ShipmentEstimate>/g));
    return matches.map((m): RateQuote => ({
      carrier: 'Purolator',
      serviceCode: m[1] ?? '',
      serviceName: m[1] ?? '',
      amount: Number(m[2] ?? '0'),
      currency: 'cad',
      estimatedDeliveryDays: null,
      raw: { serviceCode: m[1] },
    }));
  },
  async createLabel(_request: LabelRequest): Promise<LabelResponse> {
    throw new Error('Purolator label creation requires production credentials and certification');
  },
  async getTracking(trackingNumber: string): Promise<TrackingResponse> {
    const config = getConfig();
    if (!this.isConfigured()) throw new Error('Purolator is not configured');
    const response = await fetch(`${config.baseUrl}/PWS/V2/Tracking/TrackingService.asmx`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(config),
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://purolator.com/pws/service/v2/TrackPackagesByPin',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TrackPackagesByPinRequest xmlns="http://purolator.com/pws/datatypes/v2">
      <PINs><PIN><Value>${trackingNumber}</Value></PIN></PINs>
    </TrackPackagesByPinRequest>
  </soap:Body>
</soap:Envelope>`,
    });
    const text = await response.text();
    return {
      carrier: 'Purolator',
      trackingNumber,
      status: /<Status>(.*?)<\/Status>/.exec(text)?.[1] ?? 'Unknown',
      events: [],
      raw: { text },
    };
  },
};
