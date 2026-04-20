import type { ChannelAdapter, ChannelConnectionContext, ExternalOrder } from '@/backend/channels/types';

function getCreds(ctx: ChannelConnectionContext): { siteUrl?: string; consumerKey?: string; consumerSecret?: string } {
  const c = ctx.credentials ?? {};
  return {
    siteUrl: typeof c.siteUrl === 'string' ? c.siteUrl : undefined,
    consumerKey: typeof c.consumerKey === 'string' ? c.consumerKey : undefined,
    consumerSecret: typeof c.consumerSecret === 'string' ? c.consumerSecret : undefined,
  };
}

function basicAuth(key: string, secret: string): string {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

interface WooOrder {
  id: number;
  number: string;
  customer_note: string | null;
  shipping: { first_name?: string; last_name?: string; address_1?: string; city?: string; state?: string; postcode?: string; country?: string };
  line_items: Array<{ sku: string; name: string; quantity: number; price: string }>;
}

export const woocommerceAdapter: ChannelAdapter = {
  kind: 'WooCommerce',
  isConfigured(ctx) {
    const c = getCreds(ctx);
    return Boolean(c.siteUrl && c.consumerKey && c.consumerSecret);
  },
  async importOrders(ctx, options) {
    const { siteUrl, consumerKey, consumerSecret } = getCreds(ctx);
    if (!siteUrl || !consumerKey || !consumerSecret) {
      throw new Error('WooCommerce connection missing siteUrl/consumerKey/consumerSecret');
    }
    const since = options.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const base = siteUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/wp-json/wc/v3/orders?status=processing&modified_after=${encodeURIComponent(since)}&per_page=50`, {
      headers: { Authorization: basicAuth(consumerKey, consumerSecret), Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`WooCommerce orders fetch failed (${response.status})`);
    const orders = await response.json() as WooOrder[];
    return orders.map((order): ExternalOrder => ({
      externalOrderId: String(order.id),
      externalStoreId: base,
      reference: order.number,
      shipTo: [
        [order.shipping.first_name, order.shipping.last_name].filter(Boolean).join(' '),
        order.shipping.address_1,
        order.shipping.city,
        order.shipping.state,
        order.shipping.postcode,
        order.shipping.country,
      ].filter(Boolean).join(', '),
      notes: order.customer_note ?? '',
      items: order.line_items.map((li) => ({ sku: li.sku || `WOO-${li.name}`, name: li.name, quantity: li.quantity, price: Number(li.price) || 0 })),
      raw: order as unknown as Record<string, unknown>,
    }));
  },
  async pushFulfillment(ctx, params) {
    const { siteUrl, consumerKey, consumerSecret } = getCreds(ctx);
    if (!siteUrl || !consumerKey || !consumerSecret) {
      throw new Error('WooCommerce connection missing siteUrl/consumerKey/consumerSecret');
    }
    const base = siteUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/wp-json/wc/v3/orders/${params.externalOrderId}`, {
      method: 'PUT',
      headers: { Authorization: basicAuth(consumerKey, consumerSecret), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'completed',
        meta_data: [
          { key: '_tracking_number', value: params.trackingNumber },
          { key: '_tracking_provider', value: params.carrier },
        ],
      }),
    });
    if (!response.ok) throw new Error(`WooCommerce fulfillment push failed (${response.status})`);
  },
};
