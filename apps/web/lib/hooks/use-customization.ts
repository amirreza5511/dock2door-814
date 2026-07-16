"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

/** A custom field a company captures on its orders. Mirrors expo CustomizationProvider. */
export interface CustomField {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "select";
  required: boolean;
  options: string[];
}

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
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label.trim() : "";
  if (!label) return null;
  const key = typeof r.key === "string" && r.key.trim() ? r.key.trim() : label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const t = typeof r.type === "string" ? r.type : "text";
  const type: CustomField["type"] = (["text", "number", "date", "boolean", "select"] as const).includes(t as CustomField["type"])
    ? (t as CustomField["type"])
    : "text";
  const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string") : [];
  return { key, label, type, required: r.required === true, options };
}

function normalizeSettings(raw: unknown): CustomizationSettings {
  if (typeof raw !== "object" || raw === null) return EMPTY;
  const r = raw as Record<string, unknown>;
  const settings = (typeof r.settings === "object" && r.settings !== null ? r.settings : r) as Record<string, unknown>;
  return {
    hiddenModules: Array.isArray(settings.hiddenModules) ? settings.hiddenModules.filter((m): m is string => typeof m === "string") : [],
    customFields: Array.isArray(settings.customFields) ? settings.customFields.map(normalizeField).filter((f): f is CustomField => f !== null) : [],
    defaults: (typeof settings.defaults === "object" && settings.defaults !== null ? settings.defaults : {}) as Record<string, unknown>,
    terminology: (typeof settings.terminology === "object" && settings.terminology !== null
      ? Object.fromEntries(Object.entries(settings.terminology).filter(([, v]) => typeof v === "string"))
      : {}) as Record<string, string>,
  };
}

/** Reads the current company's approved customization settings. Degrades to EMPTY (no changes). */
export function useCustomization() {
  const supabase = getBrowserSupabase();
  const q = useQuery({
    queryKey: ["customization", "mySettings"],
    staleTime: 60_000,
    queryFn: async (): Promise<CustomizationSettings> => {
      const { data, error } = await supabase.rpc("get_company_customizations");
      if (error) {
        if (error.message.includes("function") || error.code === "PGRST202") return EMPTY;
        throw error;
      }
      return normalizeSettings(data);
    },
  });

  const settings = q.data ?? EMPTY;

  return useMemo(() => {
    const isHidden = (moduleKey: string): boolean => settings.hiddenModules.includes(moduleKey);
    const term = (key: string, fallback: string): string => settings.terminology[key] ?? fallback;
    const getDefault = <T,>(key: string, fallback: T): T => (settings.defaults[key] as T | undefined) ?? fallback;
    return {
      settings,
      hiddenModules: settings.hiddenModules,
      customFields: settings.customFields,
      isHidden,
      term,
      getDefault,
      isLoading: q.isLoading,
    };
  }, [settings, q.isLoading]);
}

export interface CustomizationRequestRow {
  id: string;
  company_id: string | null;
  company_name: string | null;
  title: string;
  details: string | null;
  status: string;
  payload: {
    hiddenModules?: string[];
    customFields?: { label?: string; type?: string }[];
    terminology?: Record<string, string>;
  } | null;
  admin_note: string | null;
  requester_name: string | null;
  created_at: string | null;
}

export function useMyCustomizationRequests() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["customization", "myRequests"],
    queryFn: async (): Promise<CustomizationRequestRow[]> => {
      const { data, error } = await supabase.rpc("list_customization_requests", { p_scope: "mine" });
      if (error) {
        if (error.message.includes("function") || error.code === "PGRST202") return [];
        throw error;
      }
      return (data as CustomizationRequestRow[] | null) ?? [];
    },
  });
}

export function useAllCustomizationRequests(scope: "pending" | "all") {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["customization", "allRequests", scope],
    queryFn: async (): Promise<CustomizationRequestRow[]> => {
      const { data, error } = await supabase.rpc("list_customization_requests", { p_scope: scope });
      if (error) {
        if (error.message.includes("function") || error.code === "PGRST202") return [];
        throw error;
      }
      return (data as CustomizationRequestRow[] | null) ?? [];
    },
  });
}

export function useSubmitCustomizationRequest() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; details?: string; payload?: Record<string, unknown> }) => {
      const { error } = await supabase.rpc("submit_customization_request", {
        p_title: input.title,
        p_details: input.details ?? "",
        p_payload: input.payload ?? {},
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["customization"] }),
  });
}

export function useDecideCustomizationRequest() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; approve: boolean; note?: string }) => {
      const { error } = await supabase.rpc("decide_customization_request", {
        p_request_id: input.requestId,
        p_approve: input.approve,
        p_note: input.note ?? "",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["customization"] }),
  });
}
