"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen, Loader2, Truck } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const gateDate = (h: number): string => new Date(Date.now() + h * 3600e3).toISOString();
const SAMPLE_GATE_APPTS: Appointment[] = [
  { id: "ex-ga-1", reference: "APT-5521", driver_name: "Marcus L.", carrier_name: "Harbour Freight Ltd.", status: "AtGate", scheduled_start: gateDate(0.5), dock_door: "7" },
  { id: "ex-ga-2", reference: "APT-5524", driver_name: "Priya S.", carrier_name: "PacRim Drayage", status: "Scheduled", scheduled_start: gateDate(2), dock_door: null },
  { id: "ex-ga-3", reference: "APT-5518", driver_name: "Dan K.", carrier_name: "Maple Leaf LTL", status: "AtDoor", scheduled_start: gateDate(-1), dock_door: "3" },
];

interface Appointment {
  id: string;
  reference: string | null;
  driver_name: string | null;
  carrier_name: string | null;
  status: string;
  scheduled_start: string | null;
  dock_door: string | null;
  [k: string]: unknown;
}

const EVENT_KINDS: { kind: string; label: string }[] = [
  { kind: "at_gate", label: "At gate" },
  { kind: "check_in", label: "Check in" },
  { kind: "at_door", label: "At door" },
  { kind: "loading", label: "Loading" },
  { kind: "unloading", label: "Unloading" },
  { kind: "released", label: "Release" },
  { kind: "check_out", label: "Check out" },
  { kind: "no_show", label: "No show" },
];

export default function GateStaffPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["gate", "appointments"],
    enabled: !isExploring,
    refetchInterval: 20000,
    queryFn: async (): Promise<Appointment[]> => {
      const { data, error } = await supabase
        .from("dock_appointments")
        .select("*")
        .is("archived_at", null)
        .order("scheduled_start", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data as Appointment[] | null) ?? [];
    },
  });

  const record = useMutation({
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
      void qc.invalidateQueries({ queryKey: ["gate", "appointments"] });
    },
  });

  const rows = useMemo<Appointment[]>(() => (isExploring ? SAMPLE_GATE_APPTS : (q.data ?? [])), [q.data, isExploring]);

  const doRecord = async (appointmentId: string, kind: string) => {
    if (!guard("Record a gate event")) return;
    setBusy(`${appointmentId}:${kind}`);
    try {
      await record.mutateAsync({ appointmentId, kind });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to record gate event");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Gate Staff</p>
        <h1 className="text-2xl font-semibold tracking-tight">Yard &amp; gate</h1>
        <p className="mt-1 text-sm text-muted-foreground">Check trucks in and out and move them through the yard.</p>
      </div>

      {!isExploring && q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <DoorOpen className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No appointments in the yard right now.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Truck className="h-4 w-4 text-blue-400" />
                  {a.driver_name || a.carrier_name || a.reference || "Appointment"}
                </CardTitle>
                <Badge>{a.status}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {a.dock_door ? `Door ${a.dock_door} · ` : ""}
                  {a.scheduled_start ? new Date(a.scheduled_start).toLocaleString() : "Unscheduled"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {EVENT_KINDS.map((k) => (
                    <Button
                      key={k.kind}
                      size="sm"
                      variant="outline"
                      onClick={() => void doRecord(a.id, k.kind)}
                      disabled={busy === `${a.id}:${k.kind}`}
                    >
                      {busy === `${a.id}:${k.kind}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      {k.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
