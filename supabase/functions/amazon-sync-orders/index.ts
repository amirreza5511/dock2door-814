// Amazon SP-API — pull orders for a connection.
// POST { connectionId, sinceDays? }
// Refreshes the LWA access token if expired, then calls /orders/v0/orders.
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { corsHeaders, json, svc, userFromAuth, logSync } from '../_shared/channels.ts';

async function refreshLwa(refreshToken: string) {
  const clientId = Deno.env.get('AMAZON_LWA_CLIENT_ID');
  const clientSecret = Deno.env.get('AMAZON_LWA_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('amazon_env_not_configured');
  const r = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!r.ok) throw new Error(`lwa_refresh_${r.status}`);
  const t = await r.json();
  return { token: t.access_token as string, expiresIn: Number(t.expires_in ?? 3600) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await userFromAuth(req);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => null);
    const connectionId = String(body?.connectionId ?? '');
    const sinceDays = Math.min(Math.max(Number(body?.sinceDays ?? 7), 1), 30);
    if (!connectionId) return json({ error: 'missing_connection' }, 400);

    const sb = svc();
    const { data: conn } = await sb
      .from('channel_connections')
      .select('id, company_id, kind, external_account_id, access_token_enc, refresh_token_enc, token_expires_at, metadata, status')
      .eq('id', connectionId)
      .maybeSingle();
    if (!conn || conn.kind !== 'amazon' || !conn.refresh_token_enc) {
      return json({ error: 'not_active' }, 400);
    }

    let access = conn.access_token_enc as string;
    const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    if (!access || exp < Date.now() + 60_000) {
      const fresh = await refreshLwa(conn.refresh_token_enc as string);
      access = fresh.token;
      await sb.from('channel_connections').update({
        access_token_enc: access,
        token_expires_at: new Date(Date.now() + (fresh.expiresIn - 60) * 1000).toISOString(),
      }).eq('id', conn.id);
    }

    const marketplaceId = (conn.metadata as any)?.marketplaceId ?? Deno.env.get('AMAZON_DEFAULT_MARKETPLACE') ?? '';
    if (!marketplaceId) {
      await logSync(conn.id, conn.company_id, 'orders_pull', 'error', 'missing_marketplaceId');
      return json({ error: 'missing_marketplaceId' }, 400);
    }
    const region = Deno.env.get('AMAZON_SPAPI_REGION') ?? 'https://sellingpartnerapi-na.amazon.com';
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const url = `${region}/orders/v0/orders?MarketplaceIds=${encodeURIComponent(marketplaceId)}&CreatedAfter=${encodeURIComponent(since)}`;
    const res = await fetch(url, {
      headers: { 'x-amz-access-token': access, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      await logSync(conn.id, conn.company_id, 'orders_pull', 'error', `spapi_${res.status}`, { detail: text });
      return json({ error: 'spapi_error', status: res.status, detail: text }, 502);
    }
    const j = await res.json();
    const orders = (j.payload?.Orders ?? []) as any[];

    let imported = 0;
    for (const o of orders) {
      const externalOrderId = String(o.AmazonOrderId ?? '');
      if (!externalOrderId) continue;
      const itemsRes = await fetch(`${region}/orders/v0/orders/${encodeURIComponent(externalOrderId)}/orderItems`, {
        headers: { 'x-amz-access-token': access },
      });
      const itemsJ = itemsRes.ok ? await itemsRes.json() : { payload: { OrderItems: [] } };
      const items = (itemsJ.payload?.OrderItems ?? []).map((li: any) => ({
        external_item_id: li.OrderItemId,
        sku: li.SellerSKU ?? null,
        title: li.Title ?? null,
        quantity: li.QuantityOrdered ?? 1,
        unit_price: li.ItemPrice?.Amount ?? null,
        raw: li,
      }));
      const { error: insErr } = await sb.rpc('channel_ingest_order', {
        p_connection_id: conn.id,
        p_company_id: conn.company_id,
        p_kind: 'amazon',
        p_external_order_id: externalOrderId,
        p_external_order_number: externalOrderId,
        p_customer_name: o.BuyerInfo?.BuyerName ?? null,
        p_customer_email: o.BuyerInfo?.BuyerEmail ?? null,
        p_ship_to: o.ShippingAddress ?? null,
        p_total: o.OrderTotal?.Amount ?? null,
        p_currency: o.OrderTotal?.CurrencyCode ?? null,
        p_ordered_at: o.PurchaseDate ?? new Date().toISOString(),
        p_items: items,
        p_raw: o,
      });
      if (!insErr) imported++;
    }

    await logSync(conn.id, conn.company_id, 'orders_pull', 'ok', `imported_${imported}`, { count: orders.length });
    return json({ ok: true, imported, fetched: orders.length });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
