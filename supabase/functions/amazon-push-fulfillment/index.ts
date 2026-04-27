// Amazon SP-API outbound fulfillment push.
// POST { channelOrderId } — calls confirmShipment on the merchant's Amazon
// order with carrier + tracking. Refreshes the LWA access token if expired.
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { corsHeaders, json, svc } from '../_shared/channels.ts';

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

function normalizeAmazonCarrier(c: string): string {
  // Amazon expects either a recognized `carrierCode` (e.g. UPS, FEDEX, USPS,
  // DHL_EXPRESS, CANADA_POST) or a free-form carrierName. Map common values.
  const m = c.toUpperCase();
  if (m.includes('UPS')) return 'UPS';
  if (m.includes('USPS')) return 'USPS';
  if (m.includes('FEDEX')) return 'FEDEX';
  if (m.includes('DHL')) return 'DHL_EXPRESS';
  if (m.includes('CANADA')) return 'CANADA_POST';
  return c || 'OTHER';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => null);
    const channelOrderId = String(body?.channelOrderId ?? '');
    if (!channelOrderId) return json({ error: 'missing_channelOrderId' }, 400);

    const sb = svc();
    const { data: co } = await sb
      .from('channel_orders')
      .select('id, company_id, connection_id, kind, external_order_id, tracking_number, tracking_carrier')
      .eq('id', channelOrderId)
      .maybeSingle();
    if (!co) return json({ error: 'channel_order_not_found' }, 404);
    if (co.kind !== 'amazon') return json({ error: 'wrong_kind' }, 400);
    if (!co.tracking_number) {
      await sb.rpc('channel_mark_fulfillment_pushed', {
        p_channel_order_id: co.id, p_success: false, p_external_fulfillment_id: null, p_error: 'missing_tracking_number',
      });
      return json({ error: 'missing_tracking_number' }, 400);
    }

    const { data: conn } = await sb
      .from('channel_connections')
      .select('id, access_token_enc, refresh_token_enc, token_expires_at, metadata, status')
      .eq('id', co.connection_id)
      .maybeSingle();
    if (!conn || !conn.refresh_token_enc) return json({ error: 'connection_inactive' }, 400);

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
    if (!marketplaceId) return json({ error: 'missing_marketplaceId' }, 400);
    const region = Deno.env.get('AMAZON_SPAPI_REGION') ?? 'https://sellingpartnerapi-na.amazon.com';

    // Fetch order items so we can mirror them in the shipment confirmation payload.
    const itemsRes = await fetch(`${region}/orders/v0/orders/${encodeURIComponent(co.external_order_id)}/orderItems`, {
      headers: { 'x-amz-access-token': access },
    });
    const itemsJ = itemsRes.ok ? await itemsRes.json() : { payload: { OrderItems: [] } };
    const orderItems = (itemsJ.payload?.OrderItems ?? []).map((li: any) => ({
      orderItemId: li.OrderItemId,
      quantity: li.QuantityOrdered ?? 1,
    }));

    if (orderItems.length === 0) {
      const msg = 'no_order_items';
      await sb.rpc('channel_mark_fulfillment_pushed', { p_channel_order_id: co.id, p_success: false, p_external_fulfillment_id: null, p_error: msg });
      return json({ error: msg }, 400);
    }

    const carrierCode = normalizeAmazonCarrier(co.tracking_carrier ?? '');
    const payload = {
      marketplaceId,
      packageDetail: {
        packageReferenceId: co.id.slice(0, 16),
        carrierCode,
        trackingNumber: co.tracking_number,
        shipDate: new Date().toISOString(),
        orderItems,
      },
    };

    const url = `${region}/orders/v0/orders/${encodeURIComponent(co.external_order_id)}/shipmentConfirmation`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-amz-access-token': access,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: any = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }

    if (!res.ok) {
      const msg = `spapi_confirm_${res.status}`;
      await sb.rpc('channel_mark_fulfillment_pushed', { p_channel_order_id: co.id, p_success: false, p_external_fulfillment_id: null, p_error: msg });
      await sb.rpc('channel_log_sync', { p_connection_id: conn.id, p_company_id: co.company_id, p_kind: 'fulfillment_push', p_result: 'error', p_message: msg, p_payload: parsed ?? {} });
      return json({ error: msg, detail: parsed }, 502);
    }

    await sb.rpc('channel_mark_fulfillment_pushed', {
      p_channel_order_id: co.id,
      p_success: true,
      p_external_fulfillment_id: co.external_order_id,
      p_error: null,
    });
    await sb.rpc('channel_log_sync', {
      p_connection_id: conn.id, p_company_id: co.company_id, p_kind: 'fulfillment_push',
      p_result: 'ok', p_message: `confirmShipment ok`,
      p_payload: { tracking: co.tracking_number, carrier: carrierCode },
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: 'unexpected', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
