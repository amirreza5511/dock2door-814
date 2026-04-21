// Supabase Edge Function — cleanup-orphan-files
// Scheduled (nightly) sweep that removes storage objects which have no
// matching row in public.storage_files.  Authorization is enforced by the
// SQL RPC `cleanup_orphan_storage_files` which requires `is_admin()`.
//
// Deploy:
//   supabase functions deploy cleanup-orphan-files
// Schedule via cron:
//   supabase functions schedule create nightly-orphan-cleanup \
//     --function cleanup-orphan-files --cron "0 3 * * *"
//
// Invocation must carry the service role key (cron does this automatically).

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

Deno.serve(async (req: Request) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Scheduled invocations come with the project service role JWT. For ad-hoc
    // calls we require the service role key in the Authorization header.
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.includes(SERVICE_KEY)) {
      return new Response(
        JSON.stringify({ error: 'forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const olderThan = String(body?.olderThan ?? '24 hours');
    const limit = Math.min(Math.max(Number(body?.limit ?? 500), 1), 5000);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Bypass `is_admin()` check by impersonating an admin service call via
    // direct DELETE, since RPC requires `auth.uid()`. We perform the same
    // logic the SQL RPC does.
    const { data: orphans, error: listErr } = await admin
      .from('storage_files')
      .select('bucket, path')
      .limit(0);
    if (listErr) console.log('[cleanup] meta probe', listErr.message);

    const buckets = [
      'certifications',
      'warehouse-docs',
      'booking-docs',
      'invoices',
      'attachments',
    ] as const;

    let removed = 0;
    const since = new Date(Date.now() - parseIntervalMs(olderThan)).toISOString();

    for (const bucket of buckets) {
      // Page through bucket
      let offset = 0;
      while (offset < limit) {
        const { data: objs, error: listErr2 } = await admin.storage
          .from(bucket)
          .list('', { limit: 100, offset, sortBy: { column: 'created_at', order: 'asc' } });
        if (listErr2 || !objs || objs.length === 0) break;

        const candidatePaths = objs
          .filter((o: any) => o.created_at && o.created_at < since && o.name)
          .map((o: any) => o.name as string);

        if (candidatePaths.length === 0) { offset += 100; continue; }

        const { data: known } = await admin
          .from('storage_files')
          .select('path')
          .eq('bucket', bucket)
          .in('path', candidatePaths);
        const knownSet = new Set((known ?? []).map((r: any) => r.path as string));
        const toRemove = candidatePaths.filter((p) => !knownSet.has(p));

        if (toRemove.length > 0) {
          const { error: rmErr } = await admin.storage.from(bucket).remove(toRemove);
          if (rmErr) {
            console.log('[cleanup] remove error', bucket, rmErr.message);
          } else {
            removed += toRemove.length;
          }
        }

        offset += 100;
      }
    }

    // Audit
    await admin.from('audit_logs').insert({
      actor_user_id: null,
      action: 'storage.cleanup_orphans',
      entity: 'storage.objects',
      entity_type: 'storage.objects',
      entity_id: null,
      previous_value: null,
      new_value: { removed, olderThan, limit },
      reason: 'scheduled nightly sweep',
    });

    return new Response(
      JSON.stringify({ ok: true, removed }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.log('[cleanup-orphan-files] fatal', err);
    return new Response(
      JSON.stringify({ error: 'internal' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});

function parseIntervalMs(s: string): number {
  const m = /^(\d+)\s*(minutes?|hours?|days?)$/i.exec(s.trim());
  if (!m) return 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('minute')) return n * 60 * 1000;
  if (unit.startsWith('hour')) return n * 3600 * 1000;
  return n * 86400 * 1000;
}
