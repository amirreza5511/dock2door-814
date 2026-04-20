import type { CarrierAdapter, LabelRequest, LabelResponse, RateRequest, RateQuote, TrackingResponse } from '@/backend/carriers/types';

export const internalAdapter: CarrierAdapter = {
  code: 'Internal',
  isConfigured: () => true,
  async getRates(_request: RateRequest): Promise<RateQuote[]> {
    return [
      {
        carrier: 'Internal',
        serviceCode: 'INTERNAL_STD',
        serviceName: 'Internal Delivery',
        amount: 0,
        currency: 'cad',
        estimatedDeliveryDays: null,
        raw: {},
      },
    ];
  },
  async createLabel(request: LabelRequest): Promise<LabelResponse> {
    const trackingNumber = `INT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return {
      carrier: 'Internal',
      trackingNumber,
      labelUrl: null,
      labelFormat: 'PDF',
      rateAmount: 0,
      currency: 'cad',
      raw: { reference: request.reference ?? null },
    };
  },
  async getTracking(trackingNumber: string): Promise<TrackingResponse> {
    return {
      carrier: 'Internal',
      trackingNumber,
      status: 'InTransit',
      events: [],
      raw: {},
    };
  },
};
