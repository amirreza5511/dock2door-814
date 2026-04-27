// Supabase Edge Function — shipping-track-pull
// Polling fallback for carriers without webhook coverage.
// Auth: service-role header (cron) OR Bearer JWT.
// Body: { shipment_id?: string, max?: number }
//   - shipment_id provided: poll that one shipment
//   - otherwise: poll up to `max` (default 25) in-flight shipments older than 30m
// Each fetched event is forwarded to `record_tracking_event` RPC.
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

  let body: any = {}; try { body = await req.json(); } catch {}
  const shipmentId = body.shipment_id ? String(body.shipment_id) : null;
  const max = Math.max(1, Math.min(200, Number(body.max ?? 25)));

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const q = admin.from('shipments').select('id, carrier_code, carrier_account_id, tracking_code, status').not('tracking_code', 'eq', '').not('status', 'in', '(Delivered,Voided,Cancelled,Returned)');
  const { data: ships } = shipmentId
    ? await admin.from('shipments').select('id, carrier_code, carrier_account_id, tracking_code, status').eq('id', shipmentId)
    : await q.limit(max);

  let polled = 0; let recorded = 0; const errors: string[] = [];
  for (const s of ships ?? []) {
    try {
      const adapter = getAdapter(s.carrier_code);
      if (!adapter.track) continue;
      const { data: account } = s.carrier_account_id
        ? await admin.from('carrier_accounts').select('*').eq('id', s.carrier_account_id).maybeSingle()
        : await admin.from('carrier_accounts').select('*').eq('carrier_code', s.carrier_code).limit(1).maybeSingle();
      if (!account) continue;
      const creds = resolveCredentials(s.carrier_code, account);
      const events = await adapter.track(s.tracking_code, creds);
      polled++;
      for (const ev of events) {
        const { error } = await admin.rpc('record_tracking_event', {
          p_tracking: s.tracking_code,
          p_event_code: ev.event_code,
          p_description: ev.description,
          p_status: ev.status,
          p_occurred: ev.occurred_at,
          p_payload: ev.raw ?? {},
        });
        if (error) errors.push(`${s.id}: ${error.message}`); else recorded++;
      }
    } catch (e) {
      errors.push(`${s.id}: ${(e as Error).message}`);
    }
  }

  return jsonResp({ polled, recorded, errors }, 200);
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
