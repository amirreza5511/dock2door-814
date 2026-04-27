"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface Appointment {
  id: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  warehouse_company_id: string | null;
  trucking_company_id: string | null;
  driver_id: string | null;
  truck_id: string | null;
  trailer_id: string | null;
  created_at: string;
}

interface Driver { id: string; name: string; status: string; company_id: string }

export default function DispatchPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [assigning, setAssigning] = useState<string | null>(null);
  const [driverPick, setDriverPick] = useState<string>("");

  const appts = useQuery({
    queryKey: ["trucking", "appointments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dock_appointments")
        .select("id,status,scheduled_start,scheduled_end,warehouse_company_id,trucking_company_id,driver_id,truck_id,trailer_id,created_at")
        .is("archived_at", null)
        .order("scheduled_start", { ascending: true })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
  });

  const drivers = useQuery({
    queryKey: ["trucking", "drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id,name,status,company_id")
        .is("archived_at", null)
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Driver[];
    },
  });

  const assign = useMutation({
    mutationFn: async ({ appt, driver }: { appt: string; driver: string }) => {
      const { error } = await supabase
        .from("dock_appointments")
        .update({ driver_id: driver, status: "Assigned" })
        .eq("id", appt);
      if (error) throw error;
    },
    onSuccess: () => {
      setAssigning(null); setDriverPick("");
      qc.invalidateQueries({ queryKey: ["trucking", "appointments"] });
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("dock_appointments").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trucking", "appointments"] }),
  });

  const cols: Column<Appointment>[] = [
    { key: "id", header: "Appointment", render: (a) => <span className="font-mono text-xs">{a.id.slice(0, 8)}</span> },
    { key: "scheduled", header: "Scheduled", render: (a) => a.scheduled_start ? formatDate(a.scheduled_start) : "—", sortable: true, sortValue: (a) => a.scheduled_start },
    { key: "status", header: "Status", render: (a) => <Badge variant={statusVariant(a.status)}>{a.status}</Badge>, sortable: true, sortValue: (a) => a.status },
    { key: "driver", header: "Driver", render: (a) => {
      const d = drivers.data?.find((x) => x.id === a.driver_id);
      return d?.name ?? (a.driver_id ? a.driver_id.slice(0, 8) : "—");
    } },
    { key: "actions", header: "", className: "text-right", render: (a) => (
      <div className="flex flex-wrap justify-end gap-2">
        {!a.driver_id && (
          <Button size="sm" onClick={() => setAssigning(a.id)}>Assign driver</Button>
        )}
        {a.status === "Assigned" && (
          <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: a.id, status: "InTransit" })}>Dispatch</Button>
        )}
        {a.status === "InTransit" && (
          <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: a.id, status: "Arrived" })}>Mark arrived</Button>
        )}
        {a.status !== "Completed" && a.status !== "Cancelled" && (
          <Button size="sm" variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: a.id, status: "Completed" })}>Complete</Button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dispatch board</h1>
        <p className="text-sm text-muted-foreground">Assign drivers, dispatch loads, and update live status.</p>
      </div>

      {assigning && (
        <Card>
          <CardHeader><CardTitle>Assign driver</CardTitle><CardDescription>Appointment {assigning.slice(0, 8)}</CardDescription></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-2">
              <select
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                value={driverPick}
                onChange={(e) => setDriverPick(e.target.value)}
              >
                <option value="">Select driver…</option>
                {(drivers.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.status})</option>
                ))}
              </select>
              <Button disabled={!driverPick || assign.isPending} onClick={() => assign.mutate({ appt: assigning, driver: driverPick })}>Assign</Button>
              <Button variant="secondary" onClick={() => { setAssigning(null); setDriverPick(""); }}>Cancel</Button>
              {assign.error && <span className="text-sm text-red-600">{(assign.error as Error).message}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Appointments</CardTitle><CardDescription>{appts.data?.length ?? 0} active</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={appts.data ?? []}
            columns={cols}
            rowKey={(a) => a.id}
            isLoading={appts.isLoading}
            error={appts.error as Error | null}
            searchPlaceholder="Search id, driver…"
            filters={["Scheduled", "Assigned", "InTransit", "Arrived", "Completed", "Cancelled"].map((st) => ({
              value: st.toLowerCase(),
              label: st,
              predicate: (a: Appointment) => a.status === st,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function statusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Completed" || s === "Arrived") return "success";
  if (s === "InTransit" || s === "Assigned") return "default";
  if (s === "Scheduled") return "warning";
  if (s === "Cancelled") return "destructive";
  return "secondary";
}
