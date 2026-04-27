// deno-lint-ignore-file no-explicit-any
// @ts-nocheck - Deno runtime
import type { CarrierAdapter, CarrierCode, CarrierCredentials } from './types.ts';
import { easypost } from './easypost.ts';
import { shippo } from './shippo.ts';
import { canadaPost } from './canadapost.ts';
import { ups } from './ups.ts';
import { dhl } from './dhl.ts';
import { fedex } from './fedex.ts';

export const ADAPTERS: Record<CarrierCode, CarrierAdapter> = {
  EASYPOST: easypost,
  SHIPPO: shippo,
  CANADA_POST: canadaPost,
  UPS: ups,
  DHL: dhl,
  FEDEX: fedex,
};

export function getAdapter(code: string): CarrierAdapter {
  const u = String(code ?? '').toUpperCase() as CarrierCode;
  const a = ADAPTERS[u];
  if (!a) throw new Error(`carrier_${u}_unsupported`);
  return a;
}

/**
 * Resolve carrier credentials from a Supabase secret reference (or env).
 * `credentials_secret_ref` points to an env var name on the Supabase project
 * containing JSON like {"api_key":"...","mode":"live"} OR a single token in
 * which case it's treated as `api_key`. Falls back to common envs.
 */
export function resolveCredentials(
  carrierCode: string,
  account: { credentials_secret_ref?: string; mode?: string; data?: any; account_number?: string },
): CarrierCredentials {
  const ref = account.credentials_secret_ref ?? '';
  const mode: 'test' | 'live' = (account.mode === 'live' ? 'live' : 'test');
  const fallbackEnv = (() => {
    switch (carrierCode.toUpperCase()) {
      case 'EASYPOST': return 'EASYPOST_API_KEY';
      case 'SHIPPO': return 'SHIPPO_API_KEY';
      case 'CANADA_POST': return 'CANADA_POST_CREDENTIALS';
      case 'UPS': return 'UPS_CREDENTIALS';
      case 'DHL': return 'DHL_CREDENTIALS';
      case 'FEDEX': return 'FEDEX_CREDENTIALS';
      default: return '';
    }
  })();
  const raw = (ref && Deno.env.get(ref)) || (fallbackEnv && Deno.env.get(fallbackEnv)) || '';
  if (!raw) {
    return { mode, account_number: account.account_number, data: account.data ?? {} };
  }
  try {
    const obj = JSON.parse(raw);
    return { mode, account_number: account.account_number, ...obj };
  } catch {
    // raw is a plain token — most often api_key
    return { api_key: raw, mode, account_number: account.account_number, data: account.data ?? {} };
  }
}
