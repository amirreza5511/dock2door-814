// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
// Normalized multi-carrier shipping types.
// Every carrier adapter implements `CarrierAdapter` so the rest of the system
// (rate-shop, purchase-label, void-label, track, manifest) is carrier-agnostic.

export type CarrierCode =
  | 'EASYPOST'
  | 'SHIPPO'
  | 'CANADA_POST'
  | 'UPS'
  | 'DHL'
  | 'FEDEX';

export interface NormalizedAddress {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  email?: string;
}

export interface ParcelDimensions {
  length_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
}

export interface RateRequest {
  fromAddress: NormalizedAddress;
  toAddress: NormalizedAddress;
  parcel: ParcelDimensions;
  serviceLevel?: string;
  customsItems?: any[];
}

export interface NormalizedRate {
  carrier_code: CarrierCode;
  service_level: string;
  service_name: string;
  rate_amount: number;
  currency: string;
  est_delivery_days?: number;
  est_delivery_date?: string;
  carrier_rate_id: string;
  raw: any;
}

export interface PurchaseLabelRequest {
  rate: NormalizedRate;
  fromAddress: NormalizedAddress;
  toAddress: NormalizedAddress;
  parcel: ParcelDimensions;
  reference?: string;
}

export interface PurchasedLabel {
  carrier_code: CarrierCode;
  tracking_code: string;
  label_url: string;
  label_format: string;
  rate_amount: number;
  currency: string;
  carrier_shipment_id: string;
  raw: any;
}

export interface VoidLabelRequest {
  carrier_shipment_id: string;
  tracking_code: string;
}

export interface TrackingUpdate {
  status: 'InTransit' | 'OutForDelivery' | 'Delivered' | 'Exception' | 'Returned';
  event_code: string;
  description: string;
  occurred_at: string;
  city?: string;
  region?: string;
  country?: string;
  raw: any;
}

export interface ManifestRequest {
  shipmentTrackingCodes: string[];
  shipDate?: string;
}

export interface NormalizedManifest {
  manifest_number: string;
  manifest_url: string;
  raw: any;
}

export interface CarrierCredentials {
  // resolved from Supabase secret (never exposed to client)
  api_key?: string;
  account_number?: string;
  username?: string;
  password?: string;
  client_id?: string;
  client_secret?: string;
  meter_number?: string;
  customer_number?: string;
  contract_id?: string;
  mode: 'test' | 'live';
  data?: Record<string, unknown>;
}

export interface CarrierAdapter {
  code: CarrierCode;
  displayName: string;
  /** True if this adapter has a live, working implementation in code. */
  implemented: boolean;
  rateShop(req: RateRequest, creds: CarrierCredentials): Promise<NormalizedRate[]>;
  purchaseLabel(req: PurchaseLabelRequest, creds: CarrierCredentials): Promise<PurchasedLabel>;
  voidLabel(req: VoidLabelRequest, creds: CarrierCredentials): Promise<{ ok: boolean; raw: any }>;
  track?(trackingCode: string, creds: CarrierCredentials): Promise<TrackingUpdate[]>;
  createManifest?(req: ManifestRequest, creds: CarrierCredentials): Promise<NormalizedManifest>;
}

export class CarrierNotImplementedError extends Error {
  constructor(public code: CarrierCode, op: string) {
    super(`carrier_${code.toLowerCase()}_${op}_not_implemented`);
  }
}
