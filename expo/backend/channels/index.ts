import type { ChannelAdapter, ChannelKind } from '@/backend/channels/types';
import { shopifyAdapter } from '@/backend/channels/shopify';
import { woocommerceAdapter } from '@/backend/channels/woocommerce';
import { amazonAdapter } from '@/backend/channels/amazon';

const registry: Record<ChannelKind, ChannelAdapter | null> = {
  Shopify: shopifyAdapter,
  WooCommerce: woocommerceAdapter,
  AmazonSPAPI: amazonAdapter,
  Manual: null,
};

export function getChannel(kind: ChannelKind): ChannelAdapter {
  const adapter = registry[kind];
  if (!adapter) {
    throw new Error(`Channel ${kind} is not implemented yet`);
  }
  return adapter;
}

export function listImplementedChannels(): ChannelKind[] {
  return (Object.keys(registry) as ChannelKind[]).filter((k) => registry[k] !== null);
}

export * from '@/backend/channels/types';
