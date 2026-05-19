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

// Hard-coded fallback — safe because the anon key is intentionally public
// (already in app.json extra and Rork env vars; identical value).
const HARDCODED_URL = 'https://hyargzciywuqhlcaorwy.supabase.co';
const HARDCODED_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5YXJnemNpeXd1cWhsY2Fvcnd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDkzOTUsImV4cCI6MjA5MjMyNTM5NX0.' +
  'UkDNFFDL9dmNj_C4RrFaQU0YcMRoag9EAr1QSIZuvsk';

const SUPABASE_URL =
  fromEnv.supabaseUrl ||
  fromExpoConfig.supabaseUrl ||
  fromManifest2.supabaseUrl ||
  fromManifest.supabaseUrl ||
  HARDCODED_URL;

const SUPABASE_ANON_KEY =
  fromEnv.supabaseAnonKey ||
  fromExpoConfig.supabaseAnonKey ||
  fromManifest2.supabaseAnonKey ||
  fromManifest.supabaseAnonKey ||
  HARDCODED_KEY;

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

// These will never be empty now — hardcoded fallback guarantees a value.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[supabase] CRITICAL: config unexpectedly empty even after hardcoded fallback.');
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

const safeUrl = SUPABASE_URL;
const safeKey = SUPABASE_ANON_KEY;

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
// Early TOKEN_REFRESH_FAILED guard
// Registered immediately on client creation so it fires even before any
// screen mounts or the auth store's own listener is set up.
// Uses scope:'local' to clear AsyncStorage without a server round-trip
// (the refresh token is already invalid, so a server call would fail anyway).
// ---------------------------------------------------------------------------
supabase.auth.onAuthStateChange(async (event) => {
  if ((event as string) === 'TOKEN_REFRESH_FAILED') {
    console.log('[supabase] TOKEN_REFRESH_FAILED — clearing stale local session');
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // If signOut itself fails (e.g. no network) remove the token key directly.
      try {
        const storage = Platform.OS === 'web' ? webStorage : AsyncStorage;
        const keys = [
          `sb-${SUPABASE_URL.replace(/https?:\/\//, '').split('.')[0]}-auth-token`,
          'supabase.auth.token',
        ];
        await Promise.allSettled(keys.map((k) => storage.removeItem(k)));
      } catch {}
    }
  }
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
