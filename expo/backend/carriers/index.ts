import type { CarrierAdapter, CarrierCode } from '@/backend/carriers/types';
import { canadaPostAdapter } from '@/backend/carriers/canada-post';
import { internalAdapter } from '@/backend/carriers/internal';
import { purolatorAdapter } from '@/backend/carriers/purolator';
import { fedexAdapter } from '@/backend/carriers/fedex';
import { upsAdapter } from '@/backend/carriers/ups';

const registry: Record<CarrierCode, CarrierAdapter | null> = {
  CanadaPost: canadaPostAdapter,
  Purolator: purolatorAdapter,
  FedEx: fedexAdapter,
  UPS: upsAdapter,
  Internal: internalAdapter,
};

export function getCarrier(code: CarrierCode): CarrierAdapter {
  const adapter = registry[code];
  if (!adapter) {
    throw new Error(`Carrier ${code} is not implemented yet`);
  }
  return adapter;
}

export function listConfiguredCarriers(): CarrierCode[] {
  return (Object.keys(registry) as CarrierCode[])
    .filter((code) => registry[code] && registry[code]!.isConfigured());
}

export * from '@/backend/carriers/types';
