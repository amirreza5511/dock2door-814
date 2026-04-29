// Shopify outbound fulfillment push.
// POST { channelOrderId } — creates a Shopify Fulfillment for the linked
// fulfillment_orders associated with the imported channel order, attaching
// tracking_number + carrier. Updates push status via channel_mark_fulfillment_pushed.
// Deploy with default JWT verification on (called from worker / authenticated user).
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

const SHOPIFY_API_VERSION = '2024-07';

async function shopifyFetch(shop: string, token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { ok: r.ok, status: r.status, body: parsed };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => null);
    const channelOrderId: string = String(body?.channelOrderId ?? '');
    if (!channelOrderId) return json({ error: 'missing_channelOrderId' }, 400);

    const sb = svc();
    const { data: co, error: coErr } = await sb
      .from('channel_orders')
      .select('id, company_id, connection_id, kind, external_order_id, tracking_number, tracking_carrier, push_status')
      .eq('id', channelOrderId)
      .maybeSingle();
    if (coErr || !co) return json({ error: 'channel_order_not_found' }, 404);
    if (co.kind !== 'shopify') return json({ error: 'wrong_kind' }, 400);
    if (!co.tracking_number) {
      await sb.rpc('channel_mark_fulfillment_pushed', {
        p_channel_order_id: co.id,
        p_success: false,
        p_external_fulfillment_id: null,
        p_error: 'missing_tracking_number',
      });
      return json({ error: 'missing_tracking_number' }, 400);
    }

    const { data: conn } = await sb
      .from('channel_connections')
      .select('id, external_account_id, access_token_enc, status')
      .eq('id', co.connection_id)
      .maybeSingle();
    if (!conn || !conn.access_token_enc) return json({ error: 'connection_inactive' }, 400);
    const shop = String(conn.external_account_id).toLowerCase();
    const token = conn.access_token_enc as string;

    // 1. Look up fulfillment_orders attached to the Shopify order.
    const fo = await shopifyFetch(shop, token, `/orders/${encodeURIComponent(co.external_order_id)}/fulfillment_orders.json`);
    if (!fo.ok) {
      const msg = `shopify_get_fulfillment_orders_${fo.status}`;
      await sb.rpc('channel_mark_fulfillment_pushed', { p_channel_order_id: co.id, p_success: false, p_external_fulfillment_id: null, p_error: msg });
      await sb.rpc('channel_log_sync', { p_connection_id: conn.id, p_company_id: co.company_id, p_kind: 'fulfillment_push', p_result: 'error', p_message: msg, p_payload: fo.body });
      return json({ error: msg, detail: fo.body }, 502);
    }

    const fulfillmentOrders = (fo.body?.fulfillment_orders ?? []) as Array<{ id: number; status: string; line_items: Array<{ id: number; quantity: number }> }>;
    const open = fulfillmentOrders.filter((f) => f.status === 'open' || f.status === 'in_progress');
    if (open.length === 0) {
      const msg = 'no_open_fulfillment_orders';
      await sb.rpc('channel_mark_fulfillment_pushed', { p_channel_order_id: co.id, p_success: true, p_external_fulfillment_id: null, p_error: null });
      await sb.rpc('channel_log_sync', { p_connection_id: conn.id, p_company_id: co.company_id, p_kind: 'fulfillment_push', p_result: 'partial', p_message: msg, p_payload: fo.body });
      return json({ ok: true, note: msg });
    }

    // 2. Create a single Fulfillment covering all open fulfillment_orders.
    const trackingUrls = co.tracking_number
      ? [trackingUrlFor(co.tracking_carrier ?? '', String(co.tracking_number))]
      : [];

    const payload = {
      fulfillment: {
        notify_customer: true,
        tracking_info: {
          number: co.tracking_number,
          company: normalizeShopifyCarrier(co.tracking_carrier ?? ''),
          ...(trackingUrls[0] ? { url: trackingUrls[0] } : {}),
        },
        line_items_by_fulfillment_order: open.map((f) => ({
          fulfillment_order_id: f.id,
          fulfillment_order_line_items: f.line_items.map((li) => ({ id: li.id, quantity: li.quantity })),
        })),
      },
    };

    const created = await shopifyFetch(shop, token, `/fulfillments.json`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!created.ok) {
      const msg = `shopify_create_fulfillment_${created.status}`;
      await sb.rpc('channel_mark_fulfillment_pushed', { p_channel_order_id: co.id, p_success: false, p_external_fulfillment_id: null, p_error: msg });
      await sb.rpc('channel_log_sync', { p_connection_id: conn.id, p_company_id: co.company_id, p_kind: 'fulfillment_push', p_result: 'error', p_message: msg, p_payload: created.body });
      return json({ error: msg, detail: created.body }, 502);
    }

    const fulfillmentId = String(created.body?.fulfillment?.id ?? '');
    await sb.rpc('channel_mark_fulfillment_pushed', {
      p_channel_order_id: co.id,
      p_success: true,
      p_external_fulfillment_id: fulfillmentId,
      p_error: null,
    });
    await sb.rpc('channel_log_sync', {
      p_connection_id: conn.id, p_company_id: co.company_id, p_kind: 'fulfillment_push',
      p_result: 'ok', p_message: `fulfillment_${fulfillmentId}`,
      p_payload: { fulfillment_id: fulfillmentId, tracking: co.tracking_number },
    });

    return json({ ok: true, fulfillment_id: fulfillmentId });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function normalizeShopifyCarrier(c: string): string {
  const m = c.toUpperCase();
  if (m.includes('UPS')) return 'UPS';
  if (m.includes('USPS')) return 'USPS';
  if (m.includes('FEDEX')) return 'FedEx';
  if (m.includes('DHL')) return 'DHL';
  if (m.includes('CANADA') || m === 'CANADAPOST' || m === 'CANADA_POST') return 'Canada Post';
  if (m.includes('PUROLATOR')) return 'Purolator';
  if (m.includes('EASYPOST')) return 'Other';
  return c || 'Other';
}

function trackingUrlFor(carrier: string, tracking: string): string {
  const c = carrier.toUpperCase();
  if (c.includes('UPS')) return `https://www.ups.com/track?tracknum=${encodeURIComponent(tracking)}`;
  if (c.includes('USPS')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking)}`;
  if (c.includes('FEDEX')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`;
  if (c.includes('DHL')) return `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(tracking)}`;
  if (c.includes('CANADA')) return `https://www.canadapost-postescanada.ca/track-reperage/en#/details/${encodeURIComponent(tracking)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(tracking)}+tracking`;
}
