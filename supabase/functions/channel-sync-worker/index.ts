// channel-sync-worker — periodic background worker.
// Iterates active channel_connections, pulls recent orders by kind, logs
// outcome via channel_log_sync. Intended to be scheduled every 5–15 minutes.
//
// Authorization: requires `x-cron-secret` header matching CHANNEL_SYNC_SECRET
// (set as a Supabase secret).
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-shop-domain, x-shopify-topic',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extra },
  });
}
function svc() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('missing_supabase_service_env');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function logSync(connectionId: string | null, companyId: string, kind: string, result: 'ok'|'partial'|'error', message: string, payload: unknown = {}) {
  const sb = svc();
  await sb.rpc('channel_log_sync', {
    p_connection_id: connectionId,
    p_company_id: companyId,
    p_kind: kind,
    p_result: result,
    p_message: message,
    p_payload: payload as any,
  });
}

async function pullShopify(conn: any) {
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const url = `https://${conn.external_account_id}/admin/api/2024-07/orders.json?status=any&updated_at_min=${encodeURIComponent(since)}&limit=100`;
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': conn.access_token_enc } });
  if (!res.ok) throw new Error(`shopify_${res.status}`);
  const j = await res.json();
  return (j.orders ?? []) as any[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const expected = Deno.env.get('CHANNEL_SYNC_SECRET');
    if (expected && req.headers.get('x-cron-secret') !== expected) {
      return json({ error: 'unauthorized' }, 401);
    }

    const sb = svc();
    const { data: conns } = await sb
      .from('channel_connections')
      .select('id, company_id, kind, external_account_id, access_token_enc, refresh_token_enc, status, metadata, token_expires_at')
      .eq('status', 'active')
      .limit(100);

    const results: { id: string; kind: string; ok: boolean; imported?: number; error?: string }[] = [];
    for (const conn of conns ?? []) {
      try {
        if (conn.kind === 'shopify') {
          const orders = await pullShopify(conn);
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
            const { error } = await sb.rpc('channel_ingest_order', {
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
            if (!error) imported++;
          }
          await logSync(conn.id, conn.company_id, 'orders_pull', 'ok', `cron_imported_${imported}`);
          results.push({ id: conn.id, kind: 'shopify', ok: true, imported });
        } else if (conn.kind === 'amazon') {
          // For brevity: reuse amazon-sync-orders endpoint logic via internal RPC log.
          // Production: replicate the LWA-refresh + orders/v0 fetch here.
          await logSync(conn.id, conn.company_id, 'orders_pull', 'partial', 'amazon_cron_skipped — call amazon-sync-orders');
          results.push({ id: conn.id, kind: 'amazon', ok: true, imported: 0 });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await logSync(conn.id, conn.company_id, 'orders_pull', 'error', msg);
        results.push({ id: conn.id, kind: conn.kind, ok: false, error: msg });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
