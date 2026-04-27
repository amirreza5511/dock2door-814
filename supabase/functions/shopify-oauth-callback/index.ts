// Shopify OAuth — callback. Exchanges `code` for an access token, stores it on
// the connection, and registers the required webhooks.
//
// Required env: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_WEBHOOK_URL,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { corsHeaders, json, svc, logSync } from '../_shared/channels.ts';

async function registerWebhook(shop: string, token: string, topic: string, address: string) {
  const r = await fetch(`https://${shop}/admin/api/2024-07/webhooks.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
  });
  return { ok: r.ok, status: r.status, body: await r.text().catch(() => '') };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') ?? '';
    const stateRaw = url.searchParams.get('state') ?? '';
    const shopParam = url.searchParams.get('shop') ?? '';
    if (!code || !stateRaw) return json({ error: 'missing_code_or_state' }, 400);

    let state: { companyId: string; shop: string; connId: string };
    try { state = JSON.parse(atob(stateRaw)); }
    catch { return json({ error: 'invalid_state' }, 400); }

    const shop = (shopParam || state.shop).toLowerCase();
    if (!shop || shop !== state.shop) return json({ error: 'shop_mismatch' }, 400);

    const apiKey = Deno.env.get('SHOPIFY_API_KEY');
    const apiSecret = Deno.env.get('SHOPIFY_API_SECRET');
    const webhookUrl = Deno.env.get('SHOPIFY_WEBHOOK_URL');
    if (!apiKey || !apiSecret) return json({ error: 'shopify_env_not_configured' }, 500);

    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
    });
    if (!tokenRes.ok) {
      await logSync(state.connId, state.companyId, 'webhook', 'error', `oauth_exchange_failed:${tokenRes.status}`);
      return json({ error: 'oauth_exchange_failed', status: tokenRes.status }, 400);
    }
    const tok = await tokenRes.json();
    const accessToken = tok.access_token as string;
    const scope = tok.scope as string;

    const sb = svc();
    const { error: upErr } = await sb.from('channel_connections').update({
      access_token_enc: accessToken,
      scope,
      status: 'active',
      last_error: null,
      metadata: { shop, granted_at: new Date().toISOString() },
    }).eq('id', state.connId);
    if (upErr) return json({ error: 'persist_failed', detail: upErr.message }, 500);

    if (webhookUrl) {
      const topics = ['orders/create', 'orders/updated', 'orders/cancelled', 'fulfillments/create', 'app/uninstalled'];
      for (const t of topics) {
        const r = await registerWebhook(shop, accessToken, t, webhookUrl);
        if (!r.ok) await logSync(state.connId, state.companyId, 'webhook', 'partial', `webhook_register_${t}:${r.status}`, { body: r.body });
      }
    }

    await logSync(state.connId, state.companyId, 'webhook', 'ok', 'connected', { shop });

    const successPage = `<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:48px;background:#0b0f1c;color:#fff"><h2>Shopify connected</h2><p>You can return to Dock2Door.</p></body></html>`;
    return new Response(successPage, { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
