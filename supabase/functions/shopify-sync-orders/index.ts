// Shopify — pull recent orders for a connection (manual sync / backfill).
// POST { connectionId, sinceDays? }
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { corsHeaders, json, svc, userFromAuth, logSync } from '../_shared/channels.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await userFromAuth(req);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => null);
    const connectionId = String(body?.connectionId ?? '');
    const sinceDays = Math.min(Math.max(Number(body?.sinceDays ?? 7), 1), 60);
    if (!connectionId) return json({ error: 'missing_connection' }, 400);

    const sb = svc();
    const { data: conn, error } = await sb
      .from('channel_connections')
      .select('id, company_id, kind, external_account_id, access_token_enc, status')
      .eq('id', connectionId)
      .maybeSingle();
    if (error || !conn) return json({ error: 'not_found' }, 404);
    if (conn.kind !== 'shopify' || conn.status !== 'active' || !conn.access_token_enc) {
      return json({ error: 'not_active' }, 400);
    }

    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const url = `https://${conn.external_account_id}/admin/api/2024-07/orders.json?status=any&updated_at_min=${encodeURIComponent(since)}&limit=250`;
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': conn.access_token_enc } });
    if (!res.ok) {
      await logSync(conn.id, conn.company_id, 'orders_pull', 'error', `http_${res.status}`, { url });
      return json({ error: 'shopify_api_error', status: res.status }, 502);
    }
    const j = await res.json();
    const orders = (j.orders ?? []) as any[];

    let imported = 0;
    for (const o of orders) {
      const items = (o.line_items ?? []).map((li: any) => ({
        external_item_id: String(li.id ?? ''),
        sku: li.sku ?? null,
        title: li.title ?? null,
        quantity: li.quantity ?? 1,
        unit_price: li.price ?? null,
        raw: li,
      }));
      const { error: insErr } = await sb.rpc('channel_ingest_order', {
        p_connection_id: conn.id,
        p_company_id: conn.company_id,
        p_kind: 'shopify',
        p_external_order_id: String(o.id),
        p_external_order_number: String(o.name ?? o.order_number ?? ''),
        p_customer_name: o.customer ? `${o.customer.first_name ?? ''} ${o.customer.last_name ?? ''}`.trim() : null,
        p_customer_email: o.email ?? null,
        p_ship_to: o.shipping_address ?? null,
        p_total: o.total_price ?? null,
        p_currency: o.currency ?? null,
        p_ordered_at: o.created_at ?? new Date().toISOString(),
        p_items: items,
        p_raw: o,
      });
      if (!insErr) imported++;
    }

    await logSync(conn.id, conn.company_id, 'orders_pull', 'ok', `imported_${imported}`, { since, count: orders.length });
    return json({ ok: true, imported, fetched: orders.length });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
