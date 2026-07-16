"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

/**
 * Web data hooks for the driver pay model: monthly Fuel Surcharge (FSC),
 * driver shift clock, and driver settlement — mirroring the mobile
 * `fsc.*`, `driverShifts.*` and `loads.settlement/setSettlement` procedures.
 * Works for both trucking and drayage carrier companies (pass the matching
 * company type).
 */

export interface FscRow {
  id: string;
  company_id: string;
  month: string; // YYYY-MM-DD (first of month)
  percent: number;
}

export interface ShiftRow {
  id: string;
  driver_user_id: string;
  minutes: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface DriverRow {
  id: string;
  name: string | null;
  status: string | null;
  license_number: string | null;
  phone: string | null;
  data: {
    name?: string;
    email?: string;
    userId?: string;
    driverType?: string;
    defaultHourlyRate?: number;
    notes?: string;
  } | null;
}

export interface SettlementLoad {
  id: string;
  vehicle_type: string;
  status: string;
  accepted_driver_user_id: string | null;
  driver_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  provider_net: number | null;
  freight_price: number | null;
  driver_pay_type: string | null;
  driver_pay_value: number | null;
  fuel_cost: number | null;
  driver_settled: boolean | null;
  delivered_at: string | null;
}

export function currentMonthIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Per-load driver pay (Percent/Flat). Hourly loads are 0 here (paid via shifts). */
export function loadDriverPay(l: SettlementLoad): number {
  const net = Number(l.provider_net ?? 0);
  if (l.driver_pay_type === "Percent") return Math.round(net * Number(l.driver_pay_value ?? 0)) / 100;
  if (l.driver_pay_type === "Flat") return Number(l.driver_pay_value ?? 0);
  return 0;
}

export function freightOf(l: SettlementLoad): number {
  return Number(l.freight_price ?? l.provider_net ?? 0);
}

// ── Fuel Surcharge ──────────────────────────────────────────────────────────
export function useFuelSurcharges() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["fsc", "list"],
    queryFn: async (): Promise<FscRow[]> => {
      const { data, error } = await supabase
        .from("fuel_surcharges")
        .select("id,company_id,month,percent")
        .order("month", { ascending: false })
        .limit(36);
      if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
      }
      return (data ?? []) as FscRow[];
    },
  });
}

export function useSetFuelSurcharge() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ month, percent }: { month: string; percent: number }) => {
      const { error } = await supabase.rpc("set_fuel_surcharge", { p_month: month, p_percent: percent });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fsc"] }),
  });
}

// ── Driver shifts (company view) ────────────────────────────────────────────
export function useCompanyShifts(companyId: string | undefined, days = 90) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["driver-shifts", "company", companyId, days],
    enabled: !!companyId,
    queryFn: async (): Promise<ShiftRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const { data, error } = await supabase
        .from("driver_shifts")
        .select("id,driver_user_id,minutes,started_at,ended_at")
        .eq("company_id", companyId as string)
        .gte("started_at", since.toISOString())
        .order("started_at", { ascending: false })
        .limit(1000);
      if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
      }
      return (data ?? []) as ShiftRow[];
    },
  });
}

// ── Drivers (fleet records with type + rate) ────────────────────────────────
export function useDrivers() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["fleet", "drivers"],
    queryFn: async (): Promise<DriverRow[]> => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id,name,status,license_number,phone,data")
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
      }
      return (data ?? []) as DriverRow[];
    },
  });
}

// ── Delivered loads for settlement / reports ────────────────────────────────
export function useSettlementLoads(companyId: string | undefined) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["loads", "settlement", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<SettlementLoad[]> => {
      const { data, error } = await supabase
        .from("loads")
        .select(
          "id,vehicle_type,status,accepted_driver_user_id,driver_name,pickup_address,dropoff_address,provider_net,freight_price,driver_pay_type,driver_pay_value,fuel_cost,driver_settled,delivered_at",
        )
        .eq("accepted_company_id", companyId as string)
        .eq("status", "Delivered")
        .is("archived_at", null)
        .order("delivered_at", { ascending: false })
        .limit(500);
      if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
      }
      return (data ?? []) as SettlementLoad[];
    },
  });
}

export function useSetSettlement() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payType, payValue, fuelCost }: { id: string; payType: string | null; payValue: number | null; fuelCost: number | null }) => {
      const { error } = await supabase.rpc("set_load_settlement", {
        p_load_id: id,
        p_pay_type: payType,
        p_pay_value: payValue,
        p_fuel_cost: fuelCost,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loads", "settlement"] }),
  });
}

export function useMarkSettled() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, settled }: { id: string; settled: boolean }) => {
      const { error } = await supabase.rpc("mark_load_settled", { p_load_id: id, p_settled: settled });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loads", "settlement"] }),
  });
}

/** Convenience: the carrier company id for the signed-in user. */
export function useCarrierCompanyId(type: "trucking_company" | "drayage_company"): string | undefined {
  return useActiveCompanyId(type);
}

function isMissingRelation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  const msg = (e.message ?? "").toLowerCase();
  return msg.includes("could not find the table") || (msg.includes("relation") && msg.includes("does not exist"));
}
