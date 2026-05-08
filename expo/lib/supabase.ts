import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string };

const SUPABASE_URL = (
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  extra.supabaseUrl ||
  ''
).trim();
const SUPABASE_ANON_KEY = (
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  extra.supabaseAnonKey ||
  ''
).trim();

console.log('[supabase env check]', {
  hasUrl: !!SUPABASE_URL,
  hasAnonKey: !!SUPABASE_ANON_KEY,
  urlPrefix: SUPABASE_URL?.slice(0, 30),
  source: process.env.EXPO_PUBLIC_SUPABASE_URL ? 'process.env' : extra.supabaseUrl ? 'app.json extra' : 'none',
});

if (!SUPABASE_URL) {
  console.error('[supabase] EXPO_PUBLIC_SUPABASE_URL is not set — all Supabase requests will fail. Set this env var and restart the app.');
}
if (!SUPABASE_ANON_KEY) {
  console.error('[supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY is not set — all Supabase requests will fail. Set this env var and restart the app.');
}

// Export so callers can detect misconfiguration without making a request.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const CONFIGURED_SUPABASE_URL = SUPABASE_URL;

const webStorage = {
  getItem: (key: string) => {
    try {
      return Promise.resolve(typeof window !== 'undefined' ? window.localStorage.getItem(key) : null);
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

// Provide safe placeholder values so createClient doesn't throw on missing env vars.
// All requests will still fail at network level, but the app won't hard-crash on init.
const safeUrl = SUPABASE_URL || 'https://placeholder.supabase.co';
const safeKey = SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

console.log('[supabase] initialized', { url: SUPABASE_URL || '(not set)', hasKey: Boolean(SUPABASE_ANON_KEY), configured: isSupabaseConfigured });

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
