// channel-fulfillment-worker — drains pending outbound fulfillment pushes and
// dispatches each to the appropriate channel-specific edge function. Run on a
// 1–5 minute cron schedule. Cron-secret header required:
//   x-cron-secret: <CHANNEL_FULFILLMENT_SECRET or CHANNEL_SYNC_SECRET>
// Optional body: { limit?: number, channelOrderId?: string } (single-run mode).
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

const FN_BASE = (() => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  return url.replace('.supabase.co', '.functions.supabase.co');
})();

async function invokeChild(name: string, body: unknown) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const r = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: any = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { ok: r.ok, status: r.status, body: parsed };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const expected = Deno.env.get('CHANNEL_FULFILLMENT_SECRET') ?? Deno.env.get('CHANNEL_SYNC_SECRET') ?? '';
    const got = req.headers.get('x-cron-secret') ?? '';
    if (!expected || got !== expected) return json({ error: 'forbidden' }, 401);

    const body = await req.json().catch(() => ({} as any));
    const limit = Math.min(Math.max(Number(body?.limit ?? 25), 1), 100);
    const sb = svc();

    let rows: Array<{ channel_order_id: string; kind: 'shopify' | 'amazon'; push_attempts: number }>; 

    if (body?.channelOrderId) {
      const { data: one } = await sb
        .from('channel_orders')
        .select('id, kind, push_attempts')
        .eq('id', body.channelOrderId)
        .maybeSingle();
      rows = one ? [{ channel_order_id: one.id, kind: one.kind as any, push_attempts: one.push_attempts ?? 0 }] : [];
    } else {
      const { data, error } = await sb.rpc('channel_list_pending_fulfillment', { p_limit: limit });
      if (error) return json({ error: 'list_failed', detail: error.message }, 500);
      rows = (data ?? []).map((r: any) => ({ channel_order_id: r.channel_order_id, kind: r.kind, push_attempts: r.push_attempts ?? 0 }));
    }

    const results: any[] = [];
    for (const r of rows) {
      const fn = r.kind === 'shopify' ? 'shopify-push-fulfillment' : 'amazon-push-fulfillment';
      try {
        const child = await invokeChild(fn, { channelOrderId: r.channel_order_id });
        results.push({ channelOrderId: r.channel_order_id, kind: r.kind, ok: child.ok, status: child.status, body: child.body });
      } catch (e) {
        results.push({ channelOrderId: r.channel_order_id, kind: r.kind, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
