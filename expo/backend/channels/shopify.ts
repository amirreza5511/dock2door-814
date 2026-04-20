import type { ChannelAdapter, ChannelConnectionContext, ExternalOrder } from '@/backend/channels/types';

function getCreds(ctx: ChannelConnectionContext): { shopDomain?: string; accessToken?: string } {
  const c = ctx.credentials ?? {};
  return {
    shopDomain: typeof c.shopDomain === 'string' ? c.shopDomain : undefined,
    accessToken: typeof c.accessToken === 'string' ? c.accessToken : undefined,
  };
}

interface ShopifyOrder {
  id: number;
  name: string;
  note: string | null;
  shipping_address: { address1?: string; city?: string; province?: string; country?: string; zip?: string; name?: string } | null;
  line_items: Array<{ sku: string; title: string; quantity: number; price: string }>;
}

export const shopifyAdapter: ChannelAdapter = {
  kind: 'Shopify',
  isConfigured(ctx) {
    const c = getCreds(ctx);
    return Boolean(c.shopDomain && c.accessToken);
  },
  async importOrders(ctx, options) {
    const { shopDomain, accessToken } = getCreds(ctx);
    if (!shopDomain || !accessToken) {
      throw new Error('Shopify connection is missing shopDomain/accessToken');
    }
    const since = options.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://${shopDomain}/admin/api/2024-10/orders.json?status=open&fulfillment_status=unfulfilled&updated_at_min=${encodeURIComponent(since)}&limit=50`;
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Shopify orders fetch failed (${response.status})`);
    }
    const payload = await response.json() as { orders: ShopifyOrder[] };
    return payload.orders.map((order): ExternalOrder => ({
      externalOrderId: String(order.id),
      externalStoreId: shopDomain,
      reference: order.name,
      shipTo: [order.shipping_address?.name, order.shipping_address?.address1, order.shipping_address?.city, order.shipping_address?.province, order.shipping_address?.zip, order.shipping_address?.country].filter(Boolean).join(', '),
      notes: order.note ?? '',
      items: order.line_items.map((li) => ({ sku: li.sku || `LINE-${li.title}`, name: li.title, quantity: li.quantity, price: Number(li.price) || 0 })),
      raw: order as unknown as Record<string, unknown>,
    }));
  },
  async pushFulfillment(ctx, params) {
    const { shopDomain, accessToken } = getCreds(ctx);
    if (!shopDomain || !accessToken) {
      throw new Error('Shopify connection is missing shopDomain/accessToken');
    }
    const response = await fetch(`https://${shopDomain}/admin/api/2024-10/orders/${params.externalOrderId}/fulfillments.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        fulfillment: {
          tracking_number: params.trackingNumber,
          tracking_company: params.carrier,
          notify_customer: true,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Shopify fulfillment push failed (${response.status})`);
    }
  },
};
