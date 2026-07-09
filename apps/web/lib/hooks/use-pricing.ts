"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export type AccessorialType = "flat" | "perUnit" | "perHour" | "pct";

export interface Accessorial {
  key: string;
  label: string;
  amount: number;
  type: AccessorialType;
}

export interface PricingZone {
  id: string;
  company_id: string;
  vertical: string;
  name: string;
  description: string | null;
  sort_order: number | null;
  is_active: boolean;
}

export interface ZoneRate {
  id: string;
  rate_card_id: string;
  zone_id: string;
  base_rate: number;
}

export interface RateCard {
  id: string;
  company_id: string;
  vertical: string;
  name: string;
  currency: string;
  base_unit: string | null;
  is_default: boolean;
  is_active: boolean;
  customer_company_id: string | null;
  accessorials: Accessorial[] | null;
  customer?: { id: string; name: string } | null;
  provider_zone_rates?: ZoneRate[];
}

export interface VerticalConfig {
  vertical: string;
  title: string;
  subtitle: string;
  zoneLabel: string;
  zoneLabelPlural: string;
  zonePlaceholder: string;
  zoneHint: string;
  baseUnit: string;
  defaultAccessorials: Accessorial[];
}

/** Web mirror of expo/constants/pricing.ts verticals used by the two roles ported here. */
export const PRICING_VERTICALS: Record<string, VerticalConfig> = {
  labor: {
    vertical: "labor",
    title: "Labor Rates",
    subtitle: "Publish labor pricing so clients see the charge",
    zoneLabel: "Worker category",
    zoneLabelPlural: "Worker categories",
    zonePlaceholder: "e.g. General labourer",
    zoneHint: "Add categories like 'General labourer', 'Forklift operator' or 'Lead' to price by skill.",
    baseUnit: "per hour",
    defaultAccessorials: [
      { key: "overtime", label: "Overtime (per hour)", amount: 0, type: "perHour" },
      { key: "doubletime", label: "Double-time (per hour)", amount: 0, type: "perHour" },
      { key: "callout", label: "Call-out fee", amount: 0, type: "flat" },
      { key: "min_hours", label: "Minimum hours top-up", amount: 0, type: "flat" },
    ],
  },
  forwarding: {
    vertical: "forwarding",
    title: "Forwarding Rates",
    subtitle: "Publish your all-in pricing so customers see the charge",
    zoneLabel: "Trade lane",
    zoneLabelPlural: "Trade lanes",
    zonePlaceholder: "e.g. Shanghai → Vancouver",
    zoneHint: "Add trade lanes to set a base handling rate per route.",
    baseUnit: "per shipment",
    defaultAccessorials: [
      { key: "markup", label: "Margin / markup", amount: 0, type: "pct" },
      { key: "documentation", label: "Documentation", amount: 0, type: "flat" },
      { key: "customs", label: "Customs clearance", amount: 0, type: "flat" },
      { key: "handling", label: "Handling", amount: 0, type: "flat" },
    ],
  },
  trucking: {
    vertical: "trucking",
    title: "Rates & Lanes",
    subtitle: "Publish lane pricing so shippers see the charge",
    zoneLabel: "Lane",
    zoneLabelPlural: "Lanes",
    zonePlaceholder: "e.g. Vancouver → Calgary",
    zoneHint: "Add lanes (origin → destination) to price hauls by route.",
    baseUnit: "per load",
    defaultAccessorials: [
      { key: "fuel", label: "Fuel surcharge", amount: 0, type: "pct" },
      { key: "per_mile", label: "Per mile", amount: 0, type: "perUnit" },
      { key: "detention", label: "Detention (per hour)", amount: 0, type: "perHour" },
      { key: "extra_stop", label: "Extra stop", amount: 0, type: "perUnit" },
      { key: "layover", label: "Layover", amount: 0, type: "flat" },
    ],
  },
  service: {
    vertical: "service",
    title: "Service Rates",
    subtitle: "Publish service pricing so customers see the charge",
    zoneLabel: "Service / area",
    zoneLabelPlural: "Services & areas",
    zonePlaceholder: "e.g. Container repair — Metro",
    zoneHint: "Add a row per service type or coverage area to set its base rate.",
    baseUnit: "per service",
    defaultAccessorials: [
      { key: "hourly", label: "Hourly rate", amount: 0, type: "perHour" },
      { key: "rush", label: "Rush fee", amount: 0, type: "flat" },
      { key: "after_hours", label: "After-hours", amount: 0, type: "flat" },
      { key: "materials", label: "Materials", amount: 0, type: "flat" },
    ],
  },
};

export function useZones(companyId: string | null, vertical: string) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["pricing", "zones", companyId, vertical],
    enabled: !!companyId,
    queryFn: async (): Promise<PricingZone[]> => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("provider_zones")
        .select("*")
        .eq("company_id", companyId)
        .eq("vertical", vertical)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as PricingZone[] | null) ?? [];
    },
  });
}

export function useRateCards(companyId: string | null, vertical: string) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["pricing", "cards", companyId, vertical],
    enabled: !!companyId,
    queryFn: async (): Promise<RateCard[]> => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("provider_rate_cards")
        .select("*, provider_zone_rates(*), customer:customer_company_id(id, name)")
        .eq("company_id", companyId)
        .eq("vertical", vertical)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as RateCard[] | null) ?? [];
    },
  });
}

export function useUpsertZone(companyId: string | null, vertical: string) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string | null; name: string; description?: string }) => {
      if (!companyId) throw new Error("No company selected");
      const row: Record<string, unknown> = {
        company_id: companyId,
        vertical,
        name: input.name.trim(),
        description: input.description ?? "",
        is_active: true,
        updated_at: new Date().toISOString(),
      };
      if (input.id) row.id = input.id;
      const { error } = await supabase.from("provider_zones").upsert(row);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "zones", companyId, vertical] }),
  });
}

export function useDeleteZone(companyId: string | null, vertical: string) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_zones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "zones", companyId, vertical] }),
  });
}

export function useUpsertRateCard(companyId: string | null, vertical: string) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string | null;
      name: string;
      customerCompanyId?: string | null;
      isDefault?: boolean;
      baseUnit?: string;
      accessorials?: Accessorial[];
    }) => {
      if (!companyId) throw new Error("No company selected");
      const row: Record<string, unknown> = {
        company_id: companyId,
        vertical,
        customer_company_id: input.customerCompanyId ?? null,
        name: input.name.trim(),
        currency: "CAD",
        base_unit: input.baseUnit ?? "",
        is_default: input.isDefault ?? false,
        is_active: true,
        updated_at: new Date().toISOString(),
      };
      if (input.accessorials !== undefined) row.accessorials = input.accessorials;
      if (input.id) row.id = input.id;
      const { error } = await supabase.from("provider_rate_cards").upsert(row);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "cards", companyId, vertical] }),
  });
}

export function useDeleteRateCard(companyId: string | null, vertical: string) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_rate_cards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "cards", companyId, vertical] }),
  });
}

export function useSetZoneRate(companyId: string | null, vertical: string) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rateCardId: string; zoneId: string; baseRate: number }) => {
      const { error } = await supabase.from("provider_zone_rates").upsert(
        {
          rate_card_id: input.rateCardId,
          zone_id: input.zoneId,
          base_rate: input.baseRate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "rate_card_id,zone_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "cards", companyId, vertical] }),
  });
}
