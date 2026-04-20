export type ChannelKind = 'Shopify' | 'WooCommerce' | 'AmazonSPAPI' | 'Manual';

export interface ChannelConnectionContext {
  connectionId: string;
  companyId: string;
  credentials: Record<string, unknown>;
}

export interface ExternalOrderLineItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
}

export interface ExternalOrder {
  externalOrderId: string;
  externalStoreId: string;
  reference: string;
  shipTo: string;
  notes: string;
  items: ExternalOrderLineItem[];
  raw: Record<string, unknown>;
}

export interface ChannelAdapter {
  kind: ChannelKind;
  isConfigured(context: ChannelConnectionContext): boolean;
  importOrders(context: ChannelConnectionContext, options: { since?: string | null }): Promise<ExternalOrder[]>;
  pushFulfillment(context: ChannelConnectionContext, params: { externalOrderId: string; trackingNumber: string; carrier: string }): Promise<void>;
}
