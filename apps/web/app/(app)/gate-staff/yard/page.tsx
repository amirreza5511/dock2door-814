"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen, Loader2, LogIn, LogOut, Truck, Warehouse } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { useExplore, useActionGuard } from "@/lib/explore-store";

interface Listing {
  id: string;
  title: string | null;
  [k: string]: unknown;
}

interface Appointment {
  id: string;
  scheduled_start: string;
  status: string;
  dock_door: string | null;
  truck_plate: string | null;
  driver_name: string | null;
  appointment_type: string | null;
  pallet_count: number | null;
  reference_number: string | null;
  [k: string]: unknown;
}

const SAMPLE_APPTS: Appointment[] = [
  { id: "ex-ga-1", scheduled_start: new Date(Date.now() - 3600000).toISOString(), status: "CheckedIn", dock_door: "7", truck_plate: "BC 4821 KP", driver_name: "Marcus L.", appointment_type: "Delivery", pallet_count: 10, reference_number: "WB-20481" },
  { id: "ex-ga-2", scheduled_start: new Date(Date.now() + 3600000 * 2).toISOString(), status: "Approved", dock_door: "3", truck_plate: "BC 9930 TR", driver_name: "Priya S.", appointment_type: "Pickup", pallet_count: 6, reference_number: null },
  { id: "ex-ga-3", scheduled_start: new Date(Date.now() + 3600000 * 4).toISOString(), status: "Requested", dock_door: null, truck_plate: null, driver_name: "Dan K.", appointment_type: "Delivery", pallet_count: 12, reference_number: "WB-20502" },
];

const STATUS_TONE: Record<string, string> = {
  Requested: "bg-amber-500/15 text-amber-600",
  Approved: "bg-blue-500/15 text-blue-600",
  CheckedIn: "bg-emerald-500/15 text-emerald-600",
  Completed: "bg-muted text-muted-foreground",
  Cancelled: "bg-red-500/15 text-red-600",
};

function useMyListings(companyId: string | undefined) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["gate", "listings", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Listing[]> => {
      const { data, error } = await supabase.from("warehouse_listings").select("id, title").eq("company_id", companyId);
      if (error) throw error;
      return (data as Listing[] | null) ?? [];
    },
  });
}

function useGatePanel(listingId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["gate", "panel", listingId],
    enabled: !!listingId,
    refetchInterval: 15000,
    queryFn: async (): Promise<Appointment[]> => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(today);
      end.setDate(end.getDate() + 1);
      const { data, error } = await supabase
        .from("dock_appointments")
        .select("*")
        .eq("warehouse_listing_id", listingId)
        .gte("scheduled_start", today.toISOString())
        .lt("scheduled_start", end.toISOString())
        .order("scheduled_start");
      if (error) throw error;
      return (data as Appointment[] | null) ?? [];
    },
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function GateStaffYardPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const companyId = useActiveCompanyId("Warehouse");
  const listingsQ = useMyListings(isExploring ? undefined : companyId);
  const [listingId, setListingId] = useState<string | null>(null);
  const qc = useQueryClient();
  const supabase = getBrowserSupabase();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!listingId && (listingsQ.data?.length ?? 0) > 0) {
      setListingId(listingsQ.data![0].id);
    }
  }, [listingsQ.data, listingId]);

  const panelQ = useGatePanel(isExploring ? null : listingId);
  const appointments = useMemo(() => (isExploring ? SAMPLE_APPTS : (panelQ.data ?? [])), [panelQ.data, isExploring]);

  const recordEvent = useMutation({
    mutationFn: async ({ appointmentId, kind }: { appointmentId: string; kind: string }) => {
      const { error } = await supabase.rpc("gate_record_event", {
        p_appointment_id: appointmentId,
        p_kind: kind,
        p_notes: null,
        p_meta: {},
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["gate", "panel"] });
    },
  });

  const doEvent = async (appointmentId: string, kind: string) => {
    if (!guard(kind === "CheckIn" ? "Check a truck in" : "Check a truck out")) return;
    setBusyId(appointmentId);
    try {
      await recordEvent.mutateAsync({ appointmentId, kind });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to record gate event");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Gate Staff</p>
        <h1 className="text-2xl font-semibold tracking-tight">Gate &amp; yard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Today&apos;s dock appointments. Check trucks in and out at the gate.</p>
      </div>

      {(listingsQ.data?.length ?? 0) > 1 ? (
        <div className="flex flex-wrap gap-2">
          {listingsQ.data!.map((l) => (
            <button
              key={l.id}
              onClick={() => setListingId(l.id)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${listingId === l.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
            >
              <Warehouse className="h-3.5 w-3.5" />
              {l.title ?? "Warehouse"}
            </button>
          ))}
        </div>
      ) : null}

      {!isExploring && panelQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : appointments.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-14 text-center"><DoorOpen className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No appointments scheduled for today.</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {appointments.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-primary" />
                    <span className="font-medium">{a.truck_plate || a.driver_name || "Truck"}</span>
                    <Badge className={STATUS_TONE[a.status] ?? "bg-muted text-muted-foreground"} variant="secondary">{a.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {fmtTime(a.scheduled_start)} · {a.appointment_type ?? "—"}
                    {a.dock_door ? ` · Dock ${a.dock_door}` : ""}
                    {a.pallet_count != null ? ` · ${a.pallet_count} pallets` : ""}
                  </p>
                  {a.reference_number ? <p className="text-xs font-mono text-muted-foreground">Ref: {a.reference_number}</p> : null}
                </div>
                <div className="flex gap-2">
                  {a.status !== "CheckedIn" && a.status !== "Completed" && a.status !== "Cancelled" ? (
                    <Button size="sm" disabled={busyId === a.id} onClick={() => doEvent(a.id, "CheckIn")}>
                      {busyId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      Check in
                    </Button>
                  ) : null}
                  {a.status === "CheckedIn" ? (
                    <Button size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => doEvent(a.id, "CheckOut")}>
                      {busyId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                      Check out
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
