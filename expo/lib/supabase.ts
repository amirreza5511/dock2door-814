import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Config resolution — in priority order:
//   1. process.env  (injected by Rork / Expo build at bundle time)
//   2. app.json extra  (hardcoded fallback via Constants.expoConfig)
//   3. manifest2 / manifest  (older Expo runtime variants)
// ---------------------------------------------------------------------------

type Extra = { supabaseUrl?: string; supabaseAnonKey?: string };

const fromEnv: Partial<Extra> = {
  supabaseUrl:     process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || undefined,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || undefined,
};

const fromExpoConfig = (Constants.expoConfig?.extra as Extra | undefined) ?? {};

const fromManifest2 = (
  (Constants as unknown as {
    manifest2?: { extra?: { expoClient?: { extra?: Extra } } };
  }).manifest2?.extra?.expoClient?.extra as Extra | undefined
) ?? {};

const fromManifest = (
  (Constants as unknown as { manifest?: { extra?: Extra } }).manifest?.extra as Extra | undefined
) ?? {};

const SUPABASE_URL =
  fromEnv.supabaseUrl ||
  fromExpoConfig.supabaseUrl ||
  fromManifest2.supabaseUrl ||
  fromManifest.supabaseUrl ||
  '';

const SUPABASE_ANON_KEY =
  fromEnv.supabaseAnonKey ||
  fromExpoConfig.supabaseAnonKey ||
  fromManifest2.supabaseAnonKey ||
  fromManifest.supabaseAnonKey ||
  '';

const urlSource = fromEnv.supabaseUrl
  ? 'process.env'
  : fromExpoConfig.supabaseUrl
  ? 'app.json extra (expoConfig)'
  : fromManifest2.supabaseUrl
  ? 'manifest2'
  : fromManifest.supabaseUrl
  ? 'manifest'
  : 'none';

const keySource = fromEnv.supabaseAnonKey
  ? 'process.env'
  : fromExpoConfig.supabaseAnonKey
  ? 'app.json extra (expoConfig)'
  : fromManifest2.supabaseAnonKey
  ? 'manifest2'
  : fromManifest.supabaseAnonKey
  ? 'manifest'
  : 'none';

// ---------------------------------------------------------------------------
// Diagnostics — visible in Metro / Rork console
// ---------------------------------------------------------------------------
console.log('[supabase] config resolution', {
  urlSource,
  keySource,
  hasUrl: Boolean(SUPABASE_URL),
  urlPrefix: SUPABASE_URL ? SUPABASE_URL.slice(0, 35) : '(empty)',
  hasKey: Boolean(SUPABASE_ANON_KEY),
  keyPrefix: SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.slice(0, 20) + '...' : '(empty)',
});

if (!SUPABASE_URL) {
  console.error(
    '[supabase] CRITICAL: URL resolved to empty string. ' +
    'Set EXPO_PUBLIC_SUPABASE_URL in Rork Environment Variables and rebuild.',
  );
}
if (!SUPABASE_ANON_KEY) {
  console.error(
    '[supabase] CRITICAL: ANON KEY resolved to empty string. ' +
    'Set EXPO_PUBLIC_SUPABASE_ANON_KEY in Rork Environment Variables and rebuild.',
  );
}

// Export so callers can detect misconfiguration without making a request.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const CONFIGURED_SUPABASE_URL = SUPABASE_URL;

// ---------------------------------------------------------------------------
// Storage adapter
// ---------------------------------------------------------------------------
const webStorage = {
  getItem: (key: string) => {
    try {
      return Promise.resolve(
        typeof window !== 'undefined' ? window.localStorage.getItem(key) : null,
      );
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key: string, value: string) => {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    } catch {}
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    try {
      if (typeof window !== 'undefined') window.localStorage.removeItem(key);
    } catch {}
    return Promise.resolve();
  },
};

// Provide safe placeholder values so createClient doesn't throw on missing
// env vars. All requests will still fail at network level if truly empty.
const safeUrl = SUPABASE_URL || 'https://placeholder.supabase.co';
const safeKey =
  SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

console.log('[supabase] client initialized', {
  configured: isSupabaseConfigured,
  url: SUPABASE_URL || '(using placeholder)',
});

// ---------------------------------------------------------------------------
// Optional connectivity check — fires once on import, non-blocking
// ---------------------------------------------------------------------------
if (isSupabaseConfigured) {
  fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })
    .then((r) => {
      console.log('[supabase] connectivity check →', r.status, r.ok ? 'OK' : 'FAILED');
    })
    .catch((err: unknown) => {
      console.error('[supabase] connectivity check FAILED (network):', err);
    });
} else {
  console.warn('[supabase] skipping connectivity check — client not configured.');
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type DbProfile = {
  id: string;
  email: string;
  name: string;
  role: string;
  company_id: string | null;
  status: 'Active' | 'Suspended' | 'Inactive';
  email_verified: boolean | null;
  two_factor_enabled: boolean | null;
  profile_image: string | null;
  last_login_at: string | null;
  created_at: string;
};
