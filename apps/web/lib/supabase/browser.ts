"use client";

import { createBrowserClient } from "@supabase/ssr";

const FALLBACK_SUPABASE_URL = "https://hyargzciywuqhlcaorwy.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_qHc_d78l_CCiTI-KBrlo_w_bz2eh8wz";

let _client: ReturnType<typeof createBrowserClient> | null = null;

function isUsableSupabaseKey(value: string | undefined): value is string {
  return Boolean(value && (value.startsWith("sb_publishable_") || value.startsWith("eyJ")));
}

function readPublicSupabaseConfig(): { url: string; key: string } {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const envKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (envUrl && isUsableSupabaseKey(envKey)) {
    return { url: envUrl, key: envKey };
  }

  return { url: FALLBACK_SUPABASE_URL, key: FALLBACK_SUPABASE_ANON_KEY };
}

export function getBrowserSupabase() {
  if (_client) return _client;
  const { url, key } = readPublicSupabaseConfig();
  _client = createBrowserClient(url, key);
  return _client;
}
