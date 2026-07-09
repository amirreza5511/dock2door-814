"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Web data hooks for the freight "loads" marketplace, mirroring the mobile
 * `loads.*` tRPC procedures. Shared by the Shipper (poster) and Driver
 * (carrier) roles. RLS scopes every row to the signed-in user.
 */

export type VehicleType =
  | "Bicycle"
  | "Motorcycle"
  | "Car"
  | "Pickup"
  | "MovingTruck"
  | "FiveTon"
  | "FlatDeck"
  | "Semi";

export const VEHICLE_LABEL: Record<string, string> = {
  Bicycle: "Bicycle",
  Motorcycle: "Motorcycle",
  Car: "Car",
  Pickup: "Pickup truck",
  MovingTruck: "Moving truck",
  FiveTon: "5-ton truck",
  FlatDeck: "Flat deck",
  Semi: "Semi truck",
};

export const CARGO_LABEL: Record<string, string> = {
  Envelope: "Envelope / Letter",
  Box: "Box / Parcel",
  Pallet: "Pallet(s)",
  Crate: "Crate",
  Container: "Container",
  FullLoad: "Full truckload",
};

/** status → what the next carrier action is (mirrors LOAD_STATUS_FLOW). */
export const LOAD_STATUS_FLOW: Record<string, { label: string; next: string } | undefined> = {
  Accepted: { label: "Start trip", next: "EnRoute" },
  EnRoute: { label: "Mark arrived", next: "Arrived" },
  Arrived: { label: "Mark delivered", next: "Delivered" },
};

export interface LoadRow {
  id: string;
  vehicle_type: string;
  cargo_type: string;
  pallets: number;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_city: string | null;
  dropoff_city: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_location_at: string | null;
  distance_km: number;
  total_price: number;
  delivery_speed: string | null;
  notes: string | null;
  item_description: string | null;
  recipient_name: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  receiver_name: string | null;
  poster_user_id: string | null;
  accepted_driver_user_id: string | null;
  created_at: string;
  updated_at: string | null;
  [key: string]: unknown;
}

async function currentUserId(): Promise<string> {
  const supabase = getBrowserSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

/** Loads posted by the current user (Shipper). */
export function useMyPostedLoads() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["loads", "posted"],
    refetchInterval: 20000,
    queryFn: async (): Promise<LoadRow[]> => {
      const uid = await currentUserId();
      const { data, error } = await supabase
        .from("loads")
        .select("*")
        .eq("poster_user_id", uid)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as LoadRow[] | null) ?? [];
    },
  });
}

/** Open loads on the marketplace (Driver). Optionally filtered by vehicle types. */
export function useOpenLoads(vehicleTypes?: string[]) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["loads", "open", vehicleTypes ?? "all"],
    refetchInterval: 15000,
    queryFn: async (): Promise<LoadRow[]> => {
      let q = supabase
        .from("loads")
        .select("*")
        .eq("status", "Open")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (vehicleTypes && vehicleTypes.length > 0) q = q.in("vehicle_type", vehicleTypes);
      const { data, error } = await q;
      if (error) throw error;
      return (data as LoadRow[] | null) ?? [];
    },
  });
}

/** Loads the current driver has accepted / is running. */
export function useMyTrips() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["loads", "trips"],
    refetchInterval: 15000,
    queryFn: async (): Promise<LoadRow[]> => {
      const uid = await currentUserId();
      const { data, error } = await supabase
        .from("loads")
        .select("*")
        .eq("accepted_driver_user_id", uid)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as LoadRow[] | null) ?? [];
    },
  });
}

export function useLoad(id: string) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["loads", "one", id],
    enabled: Boolean(id),
    refetchInterval: 10000,
    queryFn: async (): Promise<LoadRow | null> => {
      const { data, error } = await supabase.from("loads").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as LoadRow | null) ?? null;
    },
  });
}

export interface QuoteInput {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  vehicleType: string;
  pallets: number;
  deliverySpeed: "SameDay" | "NextDay";
  cargoType?: string;
  weightKg?: number;
}

export function useQuoteLoad() {
  const supabase = getBrowserSupabase();
  return useMutation({
    mutationFn: async (input: QuoteInput): Promise<{ total_price?: number; distance_km?: number; [k: string]: unknown }> => {
      const { data, error } = await supabase.rpc("quote_load", {
        p_pickup_lat: input.pickupLat,
        p_pickup_lng: input.pickupLng,
        p_dropoff_lat: input.dropoffLat,
        p_dropoff_lng: input.dropoffLng,
        p_vehicle_type: input.vehicleType,
        p_pallets: input.pallets,
        p_delivery_speed: input.deliverySpeed,
        p_cargo_type: input.cargoType ?? "Pallet",
        p_weight_kg: input.weightKg ?? 0,
      });
      if (error) throw error;
      return (data as Record<string, unknown>) ?? {};
    },
  });
}

export interface PostLoadInput extends QuoteInput {
  pickupAddress?: string;
  pickupCity?: string;
  dropoffAddress?: string;
  dropoffCity?: string;
  notes?: string;
  itemDescription?: string;
  recipientName?: string;
  recipientPhone?: string;
}

export function usePostLoad() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PostLoadInput): Promise<{ id: string }> => {
      const { data, error } = await supabase.rpc("post_load", {
        p_pickup_lat: input.pickupLat,
        p_pickup_lng: input.pickupLng,
        p_pickup_address: input.pickupAddress ?? "",
        p_pickup_city: input.pickupCity ?? "",
        p_dropoff_lat: input.dropoffLat,
        p_dropoff_lng: input.dropoffLng,
        p_dropoff_address: input.dropoffAddress ?? "",
        p_dropoff_city: input.dropoffCity ?? "",
        p_vehicle_type: input.vehicleType,
        p_pallets: input.pallets,
        p_delivery_speed: input.deliverySpeed,
        p_notes: input.notes ?? "",
        p_cargo_type: input.cargoType ?? "Pallet",
        p_item_count: 1,
        p_weight_kg: input.weightKg ?? 0,
        p_length_cm: 0,
        p_width_cm: 0,
        p_height_cm: 0,
        p_item_description: input.itemDescription ?? "",
        p_recipient_name: input.recipientName ?? "",
        p_recipient_phone: input.recipientPhone ?? "",
      });
      if (error) throw error;
      return { id: data as string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["loads", "posted"] });
    },
  });
}

export function useAcceptLoad() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("accept_load", { p_load_id: id });
      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["loads", "open"] });
      void qc.invalidateQueries({ queryKey: ["loads", "trips"] });
    },
  });
}

export function useAdvanceLoad() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: string; receiverName?: string }) => {
      const { error } = await supabase.rpc("advance_load", {
        p_load_id: input.id,
        p_next_status: input.status,
        p_proof_photo_path: null,
        p_receiver_name: input.receiverName ?? null,
      });
      if (error) throw error;
      return { success: true };
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["loads", "trips"] });
      void qc.invalidateQueries({ queryKey: ["loads", "one", v.id] });
    },
  });
}

export function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function loadStageLabel(status: string): string {
  const map: Record<string, string> = {
    Open: "Waiting for a driver",
    Accepted: "Driver assigned",
    EnRoute: "En route",
    Arrived: "Arrived at drop-off",
    Delivered: "Delivered",
    Cancelled: "Cancelled",
  };
  return map[status] ?? status;
}
