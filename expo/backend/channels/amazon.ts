import type { ChannelAdapter, ChannelConnectionContext, ExternalOrder } from '@/backend/channels/types';

interface AmazonCreds {
  sellerId?: string;
  marketplaceId?: string;
  refreshToken?: string;
  lwaClientId?: string;
  lwaClientSecret?: string;
  region?: string;
  endpoint?: string;
}

function getCreds(ctx: ChannelConnectionContext): AmazonCreds {
  const c = ctx.credentials ?? {};
  return {
    sellerId: typeof c.sellerId === 'string' ? c.sellerId : undefined,
    marketplaceId: typeof c.marketplaceId === 'string' ? c.marketplaceId : undefined,
    refreshToken: typeof c.refreshToken === 'string' ? c.refreshToken : undefined,
    lwaClientId: typeof c.lwaClientId === 'string' ? c.lwaClientId : undefined,
    lwaClientSecret: typeof c.lwaClientSecret === 'string' ? c.lwaClientSecret : undefined,
    region: typeof c.region === 'string' ? c.region : 'na',
    endpoint: typeof c.endpoint === 'string' ? c.endpoint : 'https://sellingpartnerapi-na.amazon.com',
  };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(creds: AmazonCreds): Promise<string> {
  if (!creds.refreshToken || !creds.lwaClientId || !creds.lwaClientSecret) {
    throw new Error('Amazon SP-API connection missing LWA credentials');
  }
  const key = `${creds.lwaClientId}:${creds.refreshToken}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const response = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.lwaClientId,
      client_secret: creds.lwaClientSecret,
    }).toString(),
  });
  if (!response.ok) throw new Error(`Amazon LWA token exchange failed (${response.status})`);
  const data = await response.json() as { access_token: string; expires_in: number };
  tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

interface AmazonOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  OrderStatus: string;
  ShippingAddress?: {
    Name?: string;
    AddressLine1?: string;
    City?: string;
    StateOrRegion?: string;
    PostalCode?: string;
    CountryCode?: string;
  };
  BuyerInfo?: { BuyerEmail?: string };
}

interface AmazonOrderItem {
  ASIN: string;
  SellerSKU?: string;
  Title: string;
  QuantityOrdered: number;
  ItemPrice?: { Amount: string };
}

export const amazonAdapter: ChannelAdapter = {
  kind: 'AmazonSPAPI',
  isConfigured(ctx) {
    const c = getCreds(ctx);
    return Boolean(c.sellerId && c.marketplaceId && c.refreshToken && c.lwaClientId && c.lwaClientSecret);
  },
  async importOrders(ctx, options) {
    const creds = getCreds(ctx);
    if (!this.isConfigured(ctx)) throw new Error('Amazon SP-API is not configured');
    const token = await getAccessToken(creds);
    const since = options.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endpoint = (creds.endpoint ?? '').replace(/\/$/, '');
    const ordersResp = await fetch(`${endpoint}/orders/v0/orders?MarketplaceIds=${encodeURIComponent(creds.marketplaceId ?? '')}&LastUpdatedAfter=${encodeURIComponent(since)}&OrderStatuses=Unshipped,PartiallyShipped`, {
      headers: { 'x-amz-access-token': token, Accept: 'application/json' },
    });
    if (!ordersResp.ok) throw new Error(`Amazon orders fetch failed (${ordersResp.status})`);
    const ordersData = await ordersResp.json() as { payload?: { Orders?: AmazonOrder[] } };
    const orders = ordersData.payload?.Orders ?? [];
    const results: ExternalOrder[] = [];
    for (const order of orders) {
      const itemsResp = await fetch(`${endpoint}/orders/v0/orders/${order.AmazonOrderId}/orderItems`, {
        headers: { 'x-amz-access-token': token, Accept: 'application/json' },
      });
      const itemsData = itemsResp.ok ? (await itemsResp.json()) as { payload?: { OrderItems?: AmazonOrderItem[] } } : { payload: { OrderItems: [] as AmazonOrderItem[] } };
      const lineItems = itemsData.payload?.OrderItems ?? [];
      results.push({
        externalOrderId: order.AmazonOrderId,
        externalStoreId: creds.marketplaceId ?? 'amazon',
        reference: order.AmazonOrderId,
        shipTo: [
          order.ShippingAddress?.Name,
          order.ShippingAddress?.AddressLine1,
          order.ShippingAddress?.City,
          order.ShippingAddress?.StateOrRegion,
          order.ShippingAddress?.PostalCode,
          order.ShippingAddress?.CountryCode,
        ].filter(Boolean).join(', '),
        notes: '',
        items: lineItems.map((li) => ({
          sku: li.SellerSKU || li.ASIN,
          name: li.Title,
          quantity: li.QuantityOrdered,
          price: Number(li.ItemPrice?.Amount ?? '0'),
        })),
        raw: { order, items: lineItems } as unknown as Record<string, unknown>,
      });
    }
    return results;
  },
  async pushFulfillment(ctx, params) {
    const creds = getCreds(ctx);
    if (!this.isConfigured(ctx)) throw new Error('Amazon SP-API is not configured');
    const token = await getAccessToken(creds);
    const endpoint = (creds.endpoint ?? '').replace(/\/$/, '');
    const feed = `<?xml version="1.0" encoding="UTF-8"?>
<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header><DocumentVersion>1.01</DocumentVersion><MerchantIdentifier>${creds.sellerId}</MerchantIdentifier></Header>
  <MessageType>OrderFulfillment</MessageType>
  <Message>
    <MessageID>1</MessageID>
    <OrderFulfillment>
      <AmazonOrderID>${params.externalOrderId}</AmazonOrderID>
      <FulfillmentDate>${new Date().toISOString()}</FulfillmentDate>
      <FulfillmentData>
        <CarrierName>${params.carrier}</CarrierName>
        <ShippingMethod>Standard</ShippingMethod>
        <ShipperTrackingNumber>${params.trackingNumber}</ShipperTrackingNumber>
      </FulfillmentData>
    </OrderFulfillment>
  </Message>
</AmazonEnvelope>`;
    const docResp = await fetch(`${endpoint}/feeds/2021-06-30/documents`, {
      method: 'POST',
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'text/xml; charset=UTF-8' }),
    });
    if (!docResp.ok) throw new Error(`Amazon feed document create failed (${docResp.status})`);
    const doc = await docResp.json() as { feedDocumentId: string; url: string };
    const upload = await fetch(doc.url, { method: 'PUT', headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: feed });
    if (!upload.ok) throw new Error(`Amazon feed upload failed (${upload.status})`);
    const feedResp = await fetch(`${endpoint}/feeds/2021-06-30/feeds`, {
      method: 'POST',
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedType: 'POST_ORDER_FULFILLMENT_DATA',
        marketplaceIds: [creds.marketplaceId],
        inputFeedDocumentId: doc.feedDocumentId,
      }),
    });
    if (!feedResp.ok) throw new Error(`Amazon feed submission failed (${feedResp.status})`);
  },
};
