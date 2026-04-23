// Supabase Edge Function — tracking-webhook
// Ingests carrier tracking events (e.g. EasyPost, Shippo, UPS, Canada Post)
// and forwards them to the `public.record_tracking_event` SECURITY DEFINER RPC.
//
// Required env:
//   TRACKING_WEBHOOK_SECRET   — shared secret, sent as `x-webhook-secret` header
//   SUPABASE_URL              — project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role
//
// Deploy:
//   supabase functions deploy tracking-webhook --no-verify-jwt
//
// Expected payload (normalized, carrier-agnostic):
// {
//   "tracking_code": "1Z...",
//   "event_code": "DELIVERED",
//   "status": "Delivered",            // one of: InTransit, OutForDelivery, Delivered, Exception, Returned
//   "description": "Left at front door",
//   "occurred_at": "2026-04-22T18:30:00Z",
//   "payload": { ...raw }
// }
//
// Carrier-native payloads (EasyPost `Tracker`, Shippo, etc.) should be mapped at the
// carrier's webhook relay OR expressed as a thin adapter before forwarding here.
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const WEBHOOK_SECRET = Deno.env.get('TRACKING_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const NORMALIZED_STATUS = new Set([
  'InTransit', 'OutForDelivery', 'Delivered', 'Exception', 'Returned',
]);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

  if (WEBHOOK_SECRET) {
    const provided = req.headers.get('x-webhook-secret') ?? '';
    if (provided !== WEBHOOK_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response('invalid_json', { status: 400 });
  }

  const tracking = String(body.tracking_code ?? body.trackingCode ?? '').trim();
  const status = String(body.status ?? '').trim();
  if (!tracking) return new Response('missing_tracking_code', { status: 400 });
  if (status && !NORMALIZED_STATUS.has(status)) {
    console.log('[tracking-webhook] unknown status', status, 'for', tracking);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc('record_tracking_event', {
    p_tracking: tracking,
    p_event_code: String(body.event_code ?? body.eventCode ?? ''),
    p_description: String(body.description ?? ''),
    p_status: status,
    p_occurred: body.occurred_at ?? body.occurredAt ?? new Date().toISOString(),
    p_payload: body.payload ?? body,
  });

  if (error) {
    console.log('[tracking-webhook] rpc error', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, event_id: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
