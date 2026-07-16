import createContextHook from '@nkzw/create-context-hook';
import { useCallback, useMemo } from 'react';
import { trpc } from '@/lib/trpc';

/** A company-defined custom field shown on the order form. */
export interface CustomField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select';
  required: boolean;
  options?: string[];
}

/** Approved, active customization settings for the caller's company. */
export interface CustomizationSettings {
  hiddenModules: string[];
  customFields: CustomField[];
  defaults: Record<string, unknown>;
  terminology: Record<string, string>;
}

const EMPTY: CustomizationSettings = {
  hiddenModules: [],
  customFields: [],
  defaults: {},
  terminology: {},
};

function normalizeField(raw: unknown): CustomField | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label : '';
  const key = typeof r.key === 'string' && r.key ? r.key : label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!key || !label) return null;
  const type = r.type;
  const validType: CustomField['type'] =
    type === 'number' || type === 'date' || type === 'boolean' || type === 'select' ? type : 'text';
  const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string') : undefined;
  return {
    key,
    label,
    type: validType,
    required: r.required === true,
    ...(options && options.length > 0 ? { options } : {}),
  };
}

function normalize(raw: unknown): CustomizationSettings {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const r = raw as Record<string, unknown>;
  const hiddenModules = Array.isArray(r.hiddenModules)
    ? r.hiddenModules.filter((m): m is string => typeof m === 'string')
    : [];
  const customFields = Array.isArray(r.customFields)
    ? r.customFields.map(normalizeField).filter((f): f is CustomField => f !== null)
    : [];
  const defaults = r.defaults && typeof r.defaults === 'object' ? (r.defaults as Record<string, unknown>) : {};
  const terminology: Record<string, string> = {};
  if (r.terminology && typeof r.terminology === 'object') {
    for (const [k, v] of Object.entries(r.terminology as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) terminology[k] = v;
    }
  }
  return { hiddenModules, customFields, defaults, terminology };
}

/**
 * Single source of truth for a company's approved workspace customizations.
 * Every company screen reads this to hide modules, render custom fields,
 * and apply renamed terminology. Degrades to EMPTY (no changes) until the
 * backend migration is applied or when the company has no customizations.
 */
export const [CustomizationProvider, useCustomization] = createContextHook(() => {
  const settingsQuery = trpc.customization.mySettings.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });

  const settings = useMemo<CustomizationSettings>(() => normalize(settingsQuery.data), [settingsQuery.data]);

  /** True when the given module key should be hidden for this company. */
  const isHidden = useCallback(
    (moduleKey: string) => settings.hiddenModules.includes(moduleKey),
    [settings.hiddenModules],
  );

  /** Apply a company's terminology override to a label (falls back to the original). */
  const term = useCallback(
    (label: string) => settings.terminology[label] ?? label,
    [settings.terminology],
  );

  /** Read a per-company default with a fallback. */
  const getDefault = useCallback(
    <T,>(key: string, fallback: T): T => {
      const v = settings.defaults[key];
      return v === undefined || v === null ? fallback : (v as T);
    },
    [settings.defaults],
  );

  return {
    settings,
    hiddenModules: settings.hiddenModules,
    customFields: settings.customFields,
    isHidden,
    term,
    getDefault,
    isLoading: settingsQuery.isLoading,
    refresh: settingsQuery.refetch,
  };
});
