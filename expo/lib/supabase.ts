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

// ---------------------------------------------------------------------------
// Auth lock — pass-through (no Web Locks, no serialization).
//
// Supabase's default lock uses the Web Locks API (navigator.locks). Under
// concurrency — e.g. admin.dashboard / bootstrap fire many parallel queries,
// each of which touches the auth session — the navigator lock can be *stolen*
// by a newer acquirer, which aborts the in-flight call and surfaces as:
//   "Lock broken by another request with the 'steal' option".
//
// A previous attempt serialized every auth op through a single promise chain.
// That removed the steal error but introduced a worse failure: it has NO
// timeout, so if any one token fetch stalls (network is blocked in the preview
// sandbox) the entire chain deadlocks and every subsequent query / RPC hangs
// forever — making approvals, reviews and data loads appear completely dead.
//
// React Native has no navigator.locks anyway, so the correct, safe choice is a
// pass-through lock: just run the operation. No Web Locks (so no "steal"
// error) and no serialization (so it can never deadlock).
// ---------------------------------------------------------------------------
const passthroughLock = async <R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => fn();

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: passthroughLock,
  },
});

console.log('[supabase] client initialized', {
  configured: isSupabaseConfigured,
  url: SUPABASE_URL || '(using placeholder)',
});

// ---------------------------------------------------------------------------
// Benign auth-error swallow guard
//
// On web, the client's background auto-refresh tick can fire BEFORE our auth
// store has a chance to validate the session. When localStorage holds a stale /
// revoked refresh token, that tick throws an AuthApiError
// ("Invalid Refresh Token: Refresh Token Not Found") from deep inside the
// supabase internals. Nothing awaits that promise, so it escapes as an
// unhandled rejection and surfaces as a fatal red-screen runtime overlay —
// even though it's harmless (we already clear the session and route to login).
//
// This listener catches that one specific class of benign auth error, clears
// the stale local session, and prevents it from bubbling up as fatal.
// ---------------------------------------------------------------------------
const isBenignRefreshTokenError = (reason: unknown): boolean => {
  const msg = (
    reason instanceof Error ? reason.message : String(reason ?? '')
  ).toLowerCase();
  return (
    msg.includes('refresh token not found') ||
    msg.includes('invalid refresh token') ||
    msg.includes('refresh_token_not_found') ||
    msg.includes('token has expired') ||
    msg.includes('jwt expired')
  );
};

// A transient network failure reaching Supabase ("TypeError: Failed to fetch",
// "Network request failed", "Load failed"). These are EXPECTED in the preview
// sandbox and on flaky connections, and every call site that matters already
// catches the error and shows the user a friendly message + retry. Left
// unhandled they escape supabase-js internals (auth auto-refresh tick, the
// signInWithPassword fetch, background queries) as an unhandled rejection and
// trip the fatal red-screen overlay. Swallow them at the global level so a
// network hiccup never crashes the app.
const isBenignNetworkError = (reason: unknown): boolean => {
  if (reason instanceof Error && reason.name === 'AbortError') return true;
  const msg = (
    reason instanceof Error ? reason.message : String(reason ?? '')
  ).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('fetch failed')
  );
};

const clearStaleLocalSession = async (): Promise<void> => {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    try {
      const storage = Platform.OS === 'web' ? webStorage : AsyncStorage;
      const keys = [
        `sb-${SUPABASE_URL.replace(/https?:\/\//, '').split('.')[0]}-auth-token`,
        'supabase.auth.token',
      ];
      await Promise.allSettled(keys.map((k) => storage.removeItem(k)));
    } catch {}
  }
};

if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // Register in the CAPTURE phase and call stopImmediatePropagation so this
  // benign rejection never reaches Rork's runtime-error overlay listener
  // (which would otherwise show a fatal red screen). preventDefault alone is
  // not enough — other listeners still fire and report the error.
  window.addEventListener(
    'unhandledrejection',
    (e: PromiseRejectionEvent) => {
      if (isBenignRefreshTokenError(e?.reason)) {
        console.log('[supabase] swallowing benign stale-refresh-token rejection');
        e.preventDefault();
        e.stopImmediatePropagation();
        void clearStaleLocalSession();
      } else if (isBenignNetworkError(e?.reason)) {
        console.log('[supabase] swallowing transient network rejection (handled by UI)');
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  // Some auth failures surface as a generic error event rather than a rejection.
  window.addEventListener(
    'error',
    (e: ErrorEvent) => {
      if (isBenignRefreshTokenError(e?.error ?? e?.message)) {
        console.log('[supabase] swallowing benign stale-refresh-token error event');
        e.preventDefault();
        e.stopImmediatePropagation();
        void clearStaleLocalSession();
      } else if (isBenignNetworkError(e?.error ?? e?.message)) {
        console.log('[supabase] swallowing transient network error event (handled by UI)');
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}

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
// Optional connectivity check — fires once on import, non-blocking.
// Runs silently; network failures are expected in sandboxed/preview envs.
// ---------------------------------------------------------------------------
if (isSupabaseConfigured) {
  fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })
    .then((r) => {
      if (__DEV__) {
        console.log('[supabase] connectivity check →', r.status, r.ok ? 'OK' : 'HTTP error');
      }
    })
    .catch(() => {
      // Silently ignored — network fetch is blocked in preview/simulator
      // environments. The Supabase client itself works fine on real devices.
    });
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
