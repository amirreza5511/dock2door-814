"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface AppointmentRow {
  id: string;
  appointment_number: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  warehouse_name?: string | null;
  carrier_name?: string | null;
  driver_name?: string | null;
  reference_number?: string | null;
  notes?: string | null;
  created_at: string;
}

interface GateEvent {
  id: string;
  kind: string;
  occurred_at: string;
  appointment_id: string | null;
  notes: string | null;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  completed: "success",
  checked_out: "success",
  in_progress: "success",
  loading: "success",
  unloading: "success",
  confirmed: "warning",
  scheduled: "warning",
  at_door: "warning",
  at_gate: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
};

export default function TruckingAppointmentsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

  const appointmentsQ = useQuery({
    queryKey: ["trucking", "appointments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dock_appointments")
        .select(`id, appointment_number, appointment_type, status, scheduled_at, confirmed_at, completed_at,
          reference_number, notes, created_at,
          warehouse_listings(name),
          companies(name)`)
        .order("scheduled_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((a: any) => ({
        ...a,
        warehouse_name: a.warehouse_listings?.name ?? null,
        carrier_name: a.companies?.name ?? null,
      })) as AppointmentRow[];
    },
  });

  const gateEventsQ = useQuery({
    queryKey: ["trucking", "gate-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gate_events")
        .select("id, kind, occurred_at, appointment_id, notes")
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) return [];
      return (data ?? []) as GateEvent[];
    },
  });

  const recordEvent = useMutation({
    mutationFn: async ({ appointmentId, kind }: { appointmentId: string; kind: string }) => {
      const { error } = await supabase.rpc("gate_record_event", {
        p_appointment_id: appointmentId,
        p_kind: kind,
        p_notes: "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trucking", "appointments"] });
      qc.invalidateQueries({ queryKey: ["trucking", "gate-events"] });
    },
  });

  const cols: Column<AppointmentRow>[] = [
    {
      key: "appt",
      header: "Appointment",
      render: (a) => (
        <div>
          <div className="font-medium">{a.appointment_number ?? a.id.slice(0, 8)}</div>
          <div className="text-xs text-muted-foreground capitalize">{a.appointment_type ?? "—"}</div>
        </div>
      ),
      sortable: true,
      sortValue: (a) => a.appointment_number,
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <Badge variant={STATUS_VARIANT[a.status ?? ""] ?? "secondary"} className="capitalize">
          {a.status?.replace(/_/g, " ") ?? "—"}
        </Badge>
      ),
      sortable: true,
      sortValue: (a) => a.status,
    },
    {
      key: "warehouse",
      header: "Warehouse",
      render: (a) => a.warehouse_name ?? "—",
    },
    {
      key: "carrier",
      header: "Carrier",
      render: (a) => a.carrier_name ?? "—",
    },
    {
      key: "scheduled",
      header: "Scheduled",
      render: (a) => a.scheduled_at
        ? new Date(a.scheduled_at).toLocaleString("en-CA", { dateStyle: "short", timeStyle: "short" })
        : "—",
      sortable: true,
      sortValue: (a) => a.scheduled_at,
    },
    {
      key: "ref",
      header: "Reference",
      render: (a) => <span className="text-xs font-mono">{a.reference_number ?? "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (a) => (
        <Button size="sm" variant="outline" onClick={() => setSelected(a)}>View</Button>
      ),
    },
  ];

  const stats = {
    scheduled: (appointmentsQ.data ?? []).filter((a) => ["scheduled", "confirmed"].includes(a.status ?? "")).length,
    inProgress: (appointmentsQ.data ?? []).filter((a) => ["at_gate", "at_door", "loading", "unloading", "in_progress"].includes(a.status ?? "")).length,
    completed: (appointmentsQ.data ?? []).filter((a) => ["completed", "checked_out"].includes(a.status ?? "")).length,
    noShow: (appointmentsQ.data ?? []).filter((a) => a.status === "no_show").length,
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dock appointments</h1>
        <p className="text-sm text-muted-foreground">Track inbound and outbound dock appointments and gate events.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Scheduled", value: stats.scheduled },
          { label: "In progress", value: stats.inProgress },
          { label: "Completed today", value: stats.completed },
          { label: "No shows", value: stats.noShow },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appointments</CardTitle>
          <CardDescription>{appointmentsQ.data?.length ?? 0} total</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={appointmentsQ.data ?? []}
            columns={cols}
            rowKey={(a) => a.id}
            isLoading={appointmentsQ.isLoading}
            error={appointmentsQ.error as Error | null}
            searchPlaceholder="Search appointment, carrier, warehouse…"
            filters={[
              { value: "upcoming", label: "Upcoming", predicate: (a) => ["scheduled", "confirmed"].includes(a.status ?? "") },
              { value: "active", label: "Active", predicate: (a) => ["at_gate", "at_door", "loading", "unloading"].includes(a.status ?? "") },
              { value: "completed", label: "Completed", predicate: (a) => ["completed", "checked_out"].includes(a.status ?? "") },
            ]}
            emptyMessage="No dock appointments found."
          />
        </CardContent>
      </Card>

      {/* Recent gate events */}
      <Card>
        <CardHeader>
          <CardTitle>Recent gate events</CardTitle>
          <CardDescription>Live feed of gate activity</CardDescription>
        </CardHeader>
        <CardContent>
          {gateEventsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (gateEventsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No gate events yet.</p>
          ) : (
            <div className="space-y-2">
              {(gateEventsQ.data ?? []).slice(0, 20).map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <Badge variant="secondary" className="capitalize shrink-0">{e.kind.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(e.occurred_at).toLocaleString("en-CA")}</span>
                  {e.notes && <span className="text-xs text-muted-foreground ml-auto">{e.notes}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Appointment detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.appointment_number ?? selected.id.slice(0, 8)}</h2>
                <p className="text-sm text-muted-foreground capitalize">{selected.appointment_type?.replace(/_/g, " ") ?? "—"}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>✕</Button>
            </div>

            {recordEvent.error && (
              <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {(recordEvent.error as Error).message}
              </div>
            )}

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs font-medium uppercase text-muted-foreground mb-1">Status</div>
                  <Badge variant={STATUS_VARIANT[selected.status ?? ""] ?? "secondary"} className="capitalize">{selected.status?.replace(/_/g, " ") ?? "—"}</Badge></div>
                <div><div className="text-xs font-medium uppercase text-muted-foreground mb-1">Warehouse</div><div>{selected.warehouse_name ?? "—"}</div></div>
                <div><div className="text-xs font-medium uppercase text-muted-foreground mb-1">Carrier</div><div>{selected.carrier_name ?? "—"}</div></div>
                <div><div className="text-xs font-medium uppercase text-muted-foreground mb-1">Reference</div><div className="font-mono text-xs">{selected.reference_number ?? "—"}</div></div>
                <div><div className="text-xs font-medium uppercase text-muted-foreground mb-1">Scheduled</div>
                  <div>{selected.scheduled_at ? new Date(selected.scheduled_at).toLocaleString("en-CA") : "—"}</div></div>
              </div>
              {selected.notes && (
                <div><div className="text-xs font-medium uppercase text-muted-foreground mb-1">Notes</div><p>{selected.notes}</p></div>
              )}

              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {["at_gate", "at_door", "loading", "unloading", "check_out"].map((kind) => (
                  <Button key={kind} size="sm" variant="outline" className="capitalize"
                    disabled={recordEvent.isPending}
                    onClick={() => recordEvent.mutate({ appointmentId: selected.id, kind })}>
                    {kind.replace(/_/g, " ")}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
