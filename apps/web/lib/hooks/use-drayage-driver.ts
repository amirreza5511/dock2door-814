"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export interface DrayageOrder {
  id: string;
  reference_code: string | null;
  container_number: string | null;
  container_size: string | null;
  is_hazmat: boolean | null;
  is_overweight: boolean | null;
}

export interface WorkOrder {
  id: string;
  order_id: string;
  move_type: string;
  status: string;
  appt_date: string | null;
  appt_time: string | null;
  from_address: string | null;
  to_address: string | null;
  from_terminal_id: string | null;
  to_terminal_id: string | null;
  drayage_orders: DrayageOrder | null;
}

export const MOVE_NEXT: Record<string, { label: string; status: string; requiresReceiver?: boolean }> = {
  Assigned: { label: "Start trip", status: "EnRoute" },
  EnRoute: { label: "Arrived at pickup", status: "AtOrigin" },
  AtOrigin: { label: "Container loaded", status: "Loaded" },
  Loaded: { label: "In transit", status: "InTransit" },
  InTransit: { label: "At destination", status: "AtDestination", requiresReceiver: true },
  AtDestination: { label: "Container dropped", status: "Unloaded" },
  Unloaded: { label: "Complete", status: "Completed" },
};

export function useDriverWorkOrders() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["drayage", "driver-work-orders"],
    refetchInterval: 15000,
    queryFn: async (): Promise<WorkOrder[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("drayage_moves")
        .select("*, drayage_orders!inner(*)")
        .eq("driver_user_id", u.user.id)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as WorkOrder[] | null) ?? [];
    },
  });
}

export function useAdvanceMove() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { moveId: string; nextStatus: string; receiverName?: string | null; containerNumber?: string | null }) => {
      const { error } = await supabase.rpc("advance_drayage_move", {
        p_move_id: input.moveId,
        p_next_status: input.nextStatus,
        p_photo_path: null,
        p_receiver_name: input.receiverName ?? null,
        p_container_number: input.containerNumber ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drayage", "driver-work-orders"] }),
  });
}

export function useJoinFleet() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<{ companyName: string }> => {
      const { data, error } = await supabase.rpc("join_fleet_by_code", { p_code: code.trim().toUpperCase() });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { company_name?: string } | null;
      return { companyName: row?.company_name ?? "your fleet" };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drayage", "driver-work-orders"] }),
  });
}
