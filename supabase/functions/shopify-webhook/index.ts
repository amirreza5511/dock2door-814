// Shopify webhook receiver. Verifies HMAC, normalizes payload, ingests order.
// Required env: SHOPIFY_API_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with --no-verify-jwt (Shopify won't send a Supabase JWT).
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { corsHeaders, json, svc, logSync } from '../_shared/channels.ts';

async function verifyHmac(rawBody: string, hmacHeader: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === hmacHeader;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const rawBody = await req.text();
    const hmac = req.headers.get('x-shopify-hmac-sha256') ?? '';
    const topic = req.headers.get('x-shopify-topic') ?? '';
    const shop = (req.headers.get('x-shopify-shop-domain') ?? '').toLowerCase();
    const secret = Deno.env.get('SHOPIFY_API_SECRET');
    if (!secret) return json({ error: 'shopify_env_not_configured' }, 500);
    if (!hmac || !shop) return json({ error: 'missing_headers' }, 400);

    const ok = await verifyHmac(rawBody, hmac, secret);
    if (!ok) return json({ error: 'hmac_mismatch' }, 401);

    const payload = JSON.parse(rawBody);
    const sb = svc();
    const { data: conn } = await sb
      .from('channel_connections')
      .select('id, company_id')
      .eq('kind', 'shopify')
      .eq('external_account_id', shop)
      .maybeSingle();
    if (!conn) return json({ error: 'unknown_shop' }, 404);

    if (topic === 'app/uninstalled') {
      await sb.rpc('channel_connection_disconnect', { p_id: conn.id, p_reason: 'uninstalled_by_merchant' });
      await logSync(conn.id, conn.company_id, 'webhook', 'ok', 'uninstalled');
      return json({ ok: true });
    }

    if (topic.startsWith('orders/')) {
      const items = (payload.line_items ?? []).map((li: any) => ({
        external_item_id: String(li.id ?? ''),
        sku: li.sku ?? null,
        title: li.title ?? null,
        quantity: li.quantity ?? 1,
        unit_price: li.price ?? null,
        raw: li,
      }));
      await sb.rpc('channel_ingest_order', {
        p_connection_id: conn.id,
        p_company_id: conn.company_id,
        p_kind: 'shopify',
        p_external_order_id: String(payload.id ?? ''),
        p_external_order_number: String(payload.name ?? payload.order_number ?? ''),
        p_customer_name: payload.customer ? `${payload.customer.first_name ?? ''} ${payload.customer.last_name ?? ''}`.trim() : null,
        p_customer_email: payload.email ?? null,
        p_ship_to: payload.shipping_address ?? null,
        p_total: payload.total_price ?? null,
        p_currency: payload.currency ?? null,
        p_ordered_at: payload.created_at ?? new Date().toISOString(),
        p_items: items,
        p_raw: payload,
      });
      await logSync(conn.id, conn.company_id, 'webhook', 'ok', topic, { order_id: payload.id });
      return json({ ok: true });
    }

    await logSync(conn.id, conn.company_id, 'webhook', 'partial', `unhandled_topic:${topic}`);
    return json({ ok: true, ignored: topic });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
