// Supabase Edge Function — push-notifications
// Reads pending rows from `public.notifications` and sends them via the Expo Push API.
// Updates `delivered_at` in the row `payload` once sent.
//
// Required env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   EXPO_ACCESS_TOKEN  (optional — required only if your Expo project enforces tokens)
//
// Deploy:
//   supabase functions deploy push-notifications --no-verify-jwt
//
// Invocation modes:
//   - POST with { notification_id: "uuid" }  — dispatch a specific notification
//   - POST with { batch: true, limit: 100 }  — dispatch a batch of undelivered notifications
//   - (scheduled) cron → `{ batch: true }`
//
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EXPO_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

interface NotifRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, any>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  let rows: NotifRow[] = [];

  if (body.notification_id) {
    const { data, error } = await admin
      .from('notifications')
      .select('id, user_id, kind, title, body, entity_type, entity_id, payload')
      .eq('id', body.notification_id)
      .limit(1);
    if (error) return json({ error: error.message }, 500);
    rows = (data ?? []) as NotifRow[];
  } else {
    const limit = Math.min(Math.max(Number(body.limit ?? BATCH_SIZE), 1), 500);
    const { data, error } = await admin
      .from('notifications')
      .select('id, user_id, kind, title, body, entity_type, entity_id, payload')
      .is('read_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) return json({ error: error.message }, 500);
    rows = ((data ?? []) as NotifRow[]).filter((r) => !r.payload?.delivered_at);
  }

  if (rows.length === 0) return json({ ok: true, dispatched: 0 }, 200);

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: tokens, error: tokenErr } = await admin
    .from('push_tokens')
    .select('user_id, token, is_active')
    .in('user_id', userIds)
    .eq('is_active', true);
  if (tokenErr) return json({ error: tokenErr.message }, 500);

  const tokensByUser = new Map<string, string[]>();
  for (const t of tokens ?? []) {
    const arr = tokensByUser.get(t.user_id) ?? [];
    arr.push(t.token);
    tokensByUser.set(t.user_id, arr);
  }

  const messages: any[] = [];
  const dispatched: { id: string; tokens: string[] }[] = [];

  for (const row of rows) {
    const userTokens = tokensByUser.get(row.user_id) ?? [];
    if (userTokens.length === 0) continue;
    for (const token of userTokens) {
      if (!token.startsWith('ExponentPushToken') && !token.startsWith('ExpoPushToken')) continue;
      messages.push({
        to: token,
        sound: 'default',
        title: row.title || 'Dock2Door',
        body: row.body || '',
        data: {
          notificationId: row.id,
          kind: row.kind,
          entityType: row.entity_type,
          entityId: row.entity_id,
          ...row.payload,
        },
      });
    }
    dispatched.push({ id: row.id, tokens: userTokens });
  }

  if (messages.length === 0) return json({ ok: true, dispatched: 0, reason: 'no_tokens' }, 200);

  // Expo accepts up to 100 per batch
  const sendBatches: any[][] = [];
  for (let i = 0; i < messages.length; i += 100) sendBatches.push(messages.slice(i, i + 100));

  const results: any[] = [];
  for (const batch of sendBatches) {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        ...(EXPO_TOKEN ? { Authorization: `Bearer ${EXPO_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch),
    });
    const text = await resp.text();
    try { results.push(JSON.parse(text)); } catch { results.push({ raw: text }); }
  }

  const now = new Date().toISOString();
  for (const row of rows) {
    const newPayload = { ...(row.payload ?? {}), delivered_at: now };
    await admin.from('notifications').update({ payload: newPayload }).eq('id', row.id);
  }

  return json({ ok: true, dispatched: dispatched.length, results }, 200);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
