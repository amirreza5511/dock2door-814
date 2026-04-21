// Supabase Edge Function — get-signed-url
// Defense-in-depth signed URL issuance.
//
// Flow:
//  1. Verify caller JWT (Supabase verifies automatically when invoked).
//  2. Re-run the access predicate via `public.can_read_storage_object(bucket, path)`
//     — this runs as SECURITY DEFINER and considers admin + company membership.
//  3. If authorized, ask storage for a short-lived signed URL.
//  4. Write an audit entry via `public.record_signed_url_issued`.
//
// Deploy:
//   supabase functions deploy get-signed-url --no-verify-jwt=false

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_BUCKETS = new Set([
  'certifications',
  'warehouse-docs',
  'booking-docs',
  'invoices',
  'attachments',
]);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'missing_authorization' }, 401);
    }

    const body = await req.json().catch(() => null);
    const bucket = String(body?.bucket ?? '');
    const path = String(body?.path ?? '');
    const expiresIn = Math.min(
      Math.max(Number(body?.expiresIn ?? 60), 10),
      600,
    );

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return json({ error: 'invalid_bucket' }, 400);
    }
    if (!path || path.includes('..')) {
      return json({ error: 'invalid_path' }, 400);
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Caller-scoped client — RLS + helpers evaluate as the caller.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: 'unauthenticated' }, 401);
    }

    const { data: canRead, error: predErr } = await userClient.rpc(
      'can_read_storage_object',
      { p_bucket: bucket, p_path: path },
    );
    if (predErr) {
      console.log('[get-signed-url] predicate error', predErr.message);
      return json({ error: 'predicate_failed' }, 500);
    }
    if (!canRead) {
      return json({ error: 'forbidden' }, 403);
    }

    // Use service role to create the signed URL (we've already authorized).
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signed, error: signErr } = await adminClient.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);
    if (signErr || !signed?.signedUrl) {
      return json(
        { error: 'sign_failed', details: signErr?.message ?? 'unknown' },
        500,
      );
    }

    // Best-effort audit
    void userClient.rpc('record_signed_url_issued', {
      p_bucket: bucket,
      p_path: path,
      p_expires_in: expiresIn,
    });

    return json({ signedUrl: signed.signedUrl, expiresIn }, 200);
  } catch (err) {
    console.log('[get-signed-url] fatal', err);
    return json({ error: 'internal' }, 500);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
