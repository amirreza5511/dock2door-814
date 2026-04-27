// Amazon SP-API LWA token exchange.
// POST { companyId, sellingPartnerId, marketplaceId, refreshToken }
// Trades the merchant's LWA refresh_token for an access_token, persists both
// (refresh_token in access_token_enc field renamed conceptually) on the
// channel_connections row.
//
// Required env: AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Note: Amazon SP-API enrolment requires Amazon developer-program approval;
// this function is the code-path; production credentials must be obtained
// from Amazon Seller Central by the merchant.
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { corsHeaders, json, svc, userFromAuth, logSync } from '../_shared/channels.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await userFromAuth(req);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => null);
    const companyId = String(body?.companyId ?? '');
    const sellingPartnerId = String(body?.sellingPartnerId ?? '').trim();
    const marketplaceId = String(body?.marketplaceId ?? '').trim();
    const refreshToken = String(body?.refreshToken ?? '').trim();
    if (!companyId || !sellingPartnerId || !refreshToken) return json({ error: 'missing_params' }, 400);

    const clientId = Deno.env.get('AMAZON_LWA_CLIENT_ID');
    const clientSecret = Deno.env.get('AMAZON_LWA_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return json({ error: 'amazon_env_not_configured', detail: 'Set AMAZON_LWA_CLIENT_ID + AMAZON_LWA_CLIENT_SECRET.' }, 500);
    }

    const tokRes = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!tokRes.ok) {
      const text = await tokRes.text().catch(() => '');
      return json({ error: 'lwa_failed', status: tokRes.status, detail: text }, 400);
    }
    const tok = await tokRes.json();
    const accessToken = tok.access_token as string;
    const expiresIn = Number(tok.expires_in ?? 3600);

    const sb = svc();
    const { data: connId, error: rpcErr } = await sb.rpc('channel_connection_upsert', {
      p_company_id: companyId,
      p_kind: 'amazon',
      p_external_account_id: sellingPartnerId,
      p_display_label: `Amazon ${marketplaceId || sellingPartnerId}`,
      p_status: 'active',
    });
    if (rpcErr) return json({ error: 'upsert_failed', detail: rpcErr.message }, 400);

    const { error: updErr } = await sb.from('channel_connections').update({
      access_token_enc: accessToken,
      refresh_token_enc: refreshToken,
      token_expires_at: new Date(Date.now() + (expiresIn - 60) * 1000).toISOString(),
      scope: 'sellingpartnerapi::orders sellingpartnerapi::inventory',
      metadata: { marketplaceId, sellingPartnerId, granted_at: new Date().toISOString() },
      status: 'active',
      last_error: null,
    }).eq('id', connId);
    if (updErr) return json({ error: 'persist_failed', detail: updErr.message }, 500);

    await logSync(connId, companyId, 'webhook', 'ok', 'amazon_connected', { sellingPartnerId, marketplaceId });
    return json({ ok: true, connectionId: connId });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
