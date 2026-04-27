// Supabase Edge Function — shipping-create-manifest
// End-of-day closeout for a carrier. Creates a `shipping_manifests` row,
// attaches a set of LabelPurchased shipments, and (where the carrier supports
// it) submits the manifest via the adapter, persisting manifest_number/url.
//
// Auth: Supabase JWT (provider company member or admin).
// Body: { company_id: string, carrier_code: string, carrier_account_id?: string, shipment_ids: string[] }
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getAdapter, resolveCredentials } from '../_shared/carriers/registry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'method_not_allowed' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResp({ error: 'unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, auth.replace('Bearer ', ''), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResp({ error: 'unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return jsonResp({ error: 'invalid_json' }, 400); }
  const companyId = String(body.company_id ?? '').trim();
  const carrierCode = String(body.carrier_code ?? '').trim();
  const carrierAccountId = body.carrier_account_id ? String(body.carrier_account_id) : null;
  const shipmentIds: string[] = Array.isArray(body.shipment_ids) ? body.shipment_ids : [];
  if (!companyId || !carrierCode || shipmentIds.length === 0) {
    return jsonResp({ error: 'company_id, carrier_code, shipment_ids required' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: manifestId, error: openErr } = await userClient.rpc('open_manifest', {
    p_company_id: companyId,
    p_carrier_code: carrierCode,
    p_carrier_account_id: carrierAccountId,
  });
  if (openErr) return jsonResp({ error: 'open_failed', detail: openErr.message }, 500);

  const attachErrors: string[] = [];
  for (const sid of shipmentIds) {
    const { error } = await userClient.rpc('attach_shipment_to_manifest', {
      p_manifest_id: manifestId,
      p_shipment_id: sid,
    });
    if (error) attachErrors.push(`${sid}: ${error.message}`);
  }

  let manifestNumber = ''; let manifestUrl = ''; let failedReason = '';
  try {
    const adapter = getAdapter(carrierCode);
    if (adapter.createManifest) {
      const accountId = carrierAccountId;
      const { data: account } = accountId
        ? await admin.from('carrier_accounts').select('*').eq('id', accountId).maybeSingle()
        : await admin.from('carrier_accounts').select('*').eq('company_id', companyId).eq('carrier_code', carrierCode).maybeSingle();
      if (!account) throw new Error('carrier_account_missing');

      const { data: ships } = await admin
        .from('shipments').select('tracking_code')
        .in('id', shipmentIds)
        .not('tracking_code', 'eq', '');

      const creds = resolveCredentials(carrierCode, account);
      const m = await adapter.createManifest({
        shipmentTrackingCodes: (ships ?? []).map((s) => s.tracking_code).filter(Boolean),
      }, creds);
      manifestNumber = m.manifest_number;
      manifestUrl = m.manifest_url;
    }
  } catch (e) {
    failedReason = (e as Error).message;
  }

  const { error: closeErr } = await userClient.rpc('close_manifest', {
    p_manifest_id: manifestId,
    p_manifest_number: manifestNumber,
    p_manifest_url: manifestUrl,
    p_failed_reason: failedReason,
  });
  if (closeErr) return jsonResp({ error: 'close_failed', detail: closeErr.message }, 500);

  return jsonResp({
    manifest_id: manifestId,
    manifest_number: manifestNumber,
    manifest_url: manifestUrl,
    attach_errors: attachErrors,
    failed_reason: failedReason,
  }, 200);
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
