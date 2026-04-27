"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { OperatorCard } from "@/components/operator-card";
import { formatDate } from "@/lib/utils";

const KINDS = [
  "check_in", "at_gate", "at_door", "loading", "unloading",
  "no_show", "check_out", "hold", "released", "seal_check",
];

interface GateEvent {
  id: string;
  appointment_id: string | null;
  kind: string;
  notes: string | null;
  created_at: string;
}

interface YardMove {
  id: string;
  kind: string;
  truck_id: string | null;
  trailer_id: string | null;
  from_zone: string | null;
  to_zone: string | null;
  created_at: string;
}

export default function DockStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [appointmentId, setAppointmentId] = useState("");
  const [kind, setKind] = useState("check_in");
  const [notes, setNotes] = useState("");

  const events = useQuery({
    queryKey: ["station", "dock", "events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gate_events")
        .select("id,appointment_id,kind,notes,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as GateEvent[];
    },
  });

  const moves = useQuery({
    queryKey: ["station", "dock", "moves"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("yard_moves")
        .select("id,kind,truck_id,trailer_id,from_zone,to_zone,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as YardMove[];
    },
  });

  const record = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("gate_record_event", {
        p_appointment_id: appointmentId || null,
        p_kind: kind,
        p_notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAppointmentId(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["station", "dock", "events"] });
    },
  });

  const eventCols: Column<GateEvent>[] = [
    { key: "kind", header: "Event", render: (e) => <Badge>{e.kind}</Badge>, sortable: true, sortValue: (e) => e.kind },
    { key: "appointment", header: "Appointment", render: (e) => e.appointment_id ? <span className="font-mono text-xs">{e.appointment_id.slice(0, 8)}</span> : "—" },
    { key: "notes", header: "Notes", render: (e) => e.notes ?? "—" },
    { key: "when", header: "When", render: (e) => formatDate(e.created_at), sortable: true, sortValue: (e) => e.created_at },
  ];

  const moveCols: Column<YardMove>[] = [
    { key: "kind", header: "Move", render: (m) => <Badge variant="secondary">{m.kind}</Badge> },
    { key: "truck", header: "Truck", render: (m) => m.truck_id ?? "—" },
    { key: "trailer", header: "Trailer", render: (m) => m.trailer_id ?? "—" },
    { key: "route", header: "Route", render: (m) => `${m.from_zone ?? "—"} → ${m.to_zone ?? "—"}` },
    { key: "when", header: "When", render: (m) => formatDate(m.created_at) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <OperatorCard stationName="Dock / Gate" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dock & gate</h1>
        <p className="text-sm text-muted-foreground">Record gate events. Each event is audited and may advance an appointment.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Record event</CardTitle><CardDescription>Fires gate_record_event RPC.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); record.mutate(); }}>
            <div className="md:col-span-2"><Label>Appointment id (optional)</Label><Input value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} placeholder="appt_…" /></div>
            <div>
              <Label>Event</Label>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm">
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="md:col-span-3"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Driver name, seal #…" /></div>
            <div className="md:col-span-3 flex items-center gap-2">
              <Button type="submit" disabled={record.isPending}>Log event</Button>
              {record.error && <span className="text-sm text-red-600">{(record.error as Error).message}</span>}
              {record.isSuccess && <span className="text-sm text-emerald-600">Logged.</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent events</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            rows={events.data ?? []}
            columns={eventCols}
            rowKey={(e) => e.id}
            isLoading={events.isLoading}
            error={events.error as Error | null}
            searchPlaceholder="Search appt, notes…"
            filters={KINDS.map((k) => ({ value: k, label: k, predicate: (e: GateEvent) => e.kind === k }))}
            emptyMessage="No gate events."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Yard moves</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            rows={moves.data ?? []}
            columns={moveCols}
            rowKey={(m) => m.id}
            isLoading={moves.isLoading}
            error={moves.error as Error | null}
            emptyMessage="No yard moves yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
