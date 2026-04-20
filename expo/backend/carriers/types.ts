export type CarrierCode = 'CanadaPost' | 'Purolator' | 'FedEx' | 'UPS' | 'Internal';

export interface Address {
  name: string;
  company?: string | null;
  street1: string;
  street2?: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phone?: string | null;
  email?: string | null;
}

export interface Parcel {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  reference?: string | null;
}

export interface RateRequest {
  from: Address;
  to: Address;
  parcels: Parcel[];
  serviceCode?: string | null;
}

export interface RateQuote {
  carrier: CarrierCode;
  serviceCode: string;
  serviceName: string;
  amount: number;
  currency: string;
  estimatedDeliveryDays: number | null;
  raw: Record<string, unknown>;
}

export interface LabelRequest extends RateRequest {
  serviceCode: string;
  reference?: string | null;
}

export interface LabelResponse {
  carrier: CarrierCode;
  trackingNumber: string;
  labelUrl: string | null;
  labelFormat: 'PDF' | 'PNG' | 'ZPL';
  rateAmount: number;
  currency: string;
  raw: Record<string, unknown>;
}

export interface TrackingEvent {
  status: string;
  description: string | null;
  location: string | null;
  occurredAt: string;
}

export interface TrackingResponse {
  carrier: CarrierCode;
  trackingNumber: string;
  status: string;
  events: TrackingEvent[];
  raw: Record<string, unknown>;
}

export interface CarrierAdapter {
  code: CarrierCode;
  isConfigured(): boolean;
  getRates(request: RateRequest): Promise<RateQuote[]>;
  createLabel(request: LabelRequest): Promise<LabelResponse>;
  getTracking(trackingNumber: string): Promise<TrackingResponse>;
}
