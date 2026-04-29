// Shopify OAuth — start.
// Caller posts { companyId, shop } where shop is the *.myshopify.com domain.
// Returns an `installUrl` to redirect the merchant to.
//
// Required env: SHOPIFY_API_KEY, SHOPIFY_SCOPES, SHOPIFY_REDIRECT_URL,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Deploy: supabase functions deploy shopify-oauth-start
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
async function userFromAuth(req: Request) {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ') || !url || !anon) return null;
  const c = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await c.auth.getUser();
  return data.user ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await userFromAuth(req);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => null);
    const companyId = String(body?.companyId ?? '');
    const shopRaw = String(body?.shop ?? '').trim().toLowerCase();
    if (!companyId || !shopRaw) return json({ error: 'missing_params' }, 400);

    const shop = shopRaw.endsWith('.myshopify.com') ? shopRaw : `${shopRaw}.myshopify.com`;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      return json({ error: 'invalid_shop_domain' }, 400);
    }

    const apiKey = Deno.env.get('SHOPIFY_API_KEY');
    const scopes = Deno.env.get('SHOPIFY_SCOPES') ?? 'read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_fulfillments,write_fulfillments';
    const redirect = Deno.env.get('SHOPIFY_REDIRECT_URL');
    if (!apiKey || !redirect) return json({ error: 'shopify_env_not_configured', detail: 'Set SHOPIFY_API_KEY and SHOPIFY_REDIRECT_URL.' }, 500);

    const sb = svc();
    const { data: connId, error } = await sb.rpc('channel_connection_upsert', {
      p_company_id: companyId,
      p_kind: 'shopify',
      p_external_account_id: shop,
      p_display_label: shop,
      p_status: 'pending',
    });
    if (error) return json({ error: 'upsert_failed', detail: error.message }, 400);

    const state = btoa(JSON.stringify({ companyId, shop, connId, uid: user.id, t: Date.now() }));
    const installUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(apiKey)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&state=${encodeURIComponent(state)}`;

    return json({ installUrl, state });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
