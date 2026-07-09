"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export interface DriverJob {
  id: string;
  appointment_type: string;
  status: string;
  scheduled_start: string | null;
  truck_plate: string | null;
  dock_door: string | null;
}

export interface PodRow {
  id: string;
  signer_name: string | null;
  file_path: string;
  created_at: string;
  notes: string | null;
}

const COMPLETABLE = ["AtDoor", "Loading", "Unloading", "Completed"];

export function useDriverJobs() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["driver", "jobs"],
    queryFn: async (): Promise<DriverJob[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const name = (u.user.user_metadata?.name as string | undefined) ?? "";
      const { data, error } = await supabase
        .from("dock_appointments")
        .select("*")
        .or(`driver_user_id.eq.${u.user.id},driver_name.eq.${encodeURIComponent(name)}`)
        .is("archived_at", null)
        .order("scheduled_start");
      if (error) throw error;
      return ((data as DriverJob[] | null) ?? []).filter((j) => COMPLETABLE.includes(j.status));
    },
  });
}

export function usePods(appointmentId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["pods", appointmentId],
    enabled: !!appointmentId,
    queryFn: async (): Promise<PodRow[]> => {
      if (!appointmentId) return [];
      const { data, error } = await supabase
        .from("pods")
        .select("*")
        .eq("appointment_id", appointmentId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as PodRow[] | null) ?? [];
    },
  });
}

export function useAttachPod() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { appointmentId: string; file: Blob; signerName: string; notes?: string }) => {
      const path = `pods/${input.appointmentId}/pod_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, input.file, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      const { error } = await supabase.rpc("attach_pod", {
        p_appointment_id: input.appointmentId,
        p_shipment_id: null,
        p_file_path: path,
        p_signer_name: input.signerName,
        p_notes: input.notes ?? "",
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["driver", "jobs"] });
      void qc.invalidateQueries({ queryKey: ["pods", v.appointmentId] });
    },
  });
}
