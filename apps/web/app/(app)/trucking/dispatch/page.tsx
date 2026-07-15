"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, Truck, Navigation } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import LoadsMap, { type MapPoint, type MapRoute } from "@/components/loads-map";
import { useRoadRoute } from "@/lib/route";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { VEHICLE_LABEL, type LoadRow } from "@/lib/hooks/use-loads";

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
        <p className="text-sm text-muted-foreground">Track every truck live, assign drivers, and update status.</p>
      </div>

      <FleetLiveBoard />

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

const ACTIVE_STATUSES = ["Accepted", "EnRoute", "Arrived"];

function isCoord(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "no signal yet";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Live map of every active truck for the company, with per-driver tracking. */
function FleetLiveBoard() {
  const supabase = getBrowserSupabase();
  const companyId = useActiveCompanyId("TruckingCompany");
  const [selected, setSelected] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["fleet", "live-loads", companyId ?? "none"],
    enabled: Boolean(companyId),
    refetchInterval: 10000,
    queryFn: async (): Promise<LoadRow[]> => {
      const { data, error } = await supabase
        .from("loads")
        .select("*")
        .eq("accepted_company_id", companyId)
        .in("status", ACTIVE_STATUSES)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as LoadRow[] | null) ?? [];
    },
  });

  const trips = useMemo<LoadRow[]>(() => q.data ?? [], [q.data]);
  const selectedTrip = useMemo(() => trips.find((t) => t.id === selected) ?? null, [trips, selected]);

  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    for (const t of trips) {
      const isSel = t.id === selected;
      if (isCoord(t.driver_lat) && isCoord(t.driver_lng)) {
        pts.push({ id: `d-${t.id}`, lat: Number(t.driver_lat), lng: Number(t.driver_lng), kind: "driver", label: (t.driver_name as string) || "Truck", selected: isSel });
      }
      if (isSel) {
        if (isCoord(t.pickup_lat) && isCoord(t.pickup_lng)) pts.push({ id: `p-${t.id}`, lat: Number(t.pickup_lat), lng: Number(t.pickup_lng), kind: "pickup", label: "Pickup" });
        if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng)) pts.push({ id: `x-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: "dropoff", label: "Drop-off" });
      } else if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng) && !(isCoord(t.driver_lat) && isCoord(t.driver_lng))) {
        pts.push({ id: `l-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: "load", label: (t.driver_name as string) || "Assigned" });
      }
    }
    return pts;
  }, [trips, selected]);

  const toPickup = selectedTrip?.status === "Accepted";
  const navOrigin = selectedTrip
    ? isCoord(selectedTrip.driver_lat) && isCoord(selectedTrip.driver_lng)
      ? { lat: Number(selectedTrip.driver_lat), lng: Number(selectedTrip.driver_lng) }
      : isCoord(selectedTrip.pickup_lat) && isCoord(selectedTrip.pickup_lng)
        ? { lat: Number(selectedTrip.pickup_lat), lng: Number(selectedTrip.pickup_lng) }
        : null
    : null;
  const navTarget = selectedTrip
    ? toPickup
      ? isCoord(selectedTrip.pickup_lat) && isCoord(selectedTrip.pickup_lng) ? { lat: Number(selectedTrip.pickup_lat), lng: Number(selectedTrip.pickup_lng) } : null
      : isCoord(selectedTrip.dropoff_lat) && isCoord(selectedTrip.dropoff_lng) ? { lat: Number(selectedTrip.dropoff_lat), lng: Number(selectedTrip.dropoff_lng) } : null
    : null;
  const road = useRoadRoute([navOrigin, navTarget], Boolean(selectedTrip));

  const routes = useMemo<MapRoute[]>(() => {
    if (!selectedTrip || !navOrigin || !navTarget) return [];
    return [{ from: navOrigin, to: navTarget, path: road.data?.path ?? undefined }];
  }, [selectedTrip, navOrigin, navTarget, road.data]);

  const withGps = trips.filter((t) => isCoord(t.driver_lat) && isCoord(t.driver_lng)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live fleet map</CardTitle>
        <CardDescription>{trips.length} active · {withGps} live on map</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoadsMap
          points={points}
          routes={routes}
          height={340}
          onSelectPoint={(id) => { const tid = id.split("-").slice(1).join("-"); setSelected(tid); }}
        />

        {trips.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Truck className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No trucks on the road right now. Drivers appear here live once they start a trip.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {trips.map((t) => {
              const isSel = t.id === selected;
              const live = isCoord(t.driver_lat) && isCoord(t.driver_lng);
              return (
                <div
                  key={t.id}
                  onClick={() => setSelected(isSel ? null : t.id)}
                  className={`cursor-pointer rounded-xl border p-3 transition-colors ${isSel ? "border-primary bg-primary/5" : "border-white/10 hover:bg-accent/40"}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`grid h-9 w-9 place-items-center rounded-lg ${live ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Truck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{(t.driver_name as string) || VEHICLE_LABEL[t.vehicle_type] || "Assigned driver"}</p>
                      <span className="flex items-center gap-1.5 text-xs" style={{ color: live ? "#34d399" : undefined }}>
                        <Radio className="h-3 w-3" />
                        <span className={live ? "" : "text-muted-foreground"}>{live ? `Live · ${relativeTime(t.driver_location_at)}` : "No GPS signal yet"}</span>
                      </span>
                    </div>
                    <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                  </div>
                  <div className="mt-2 space-y-1 pl-12">
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /><span className="truncate text-xs text-muted-foreground">{t.pickup_address || t.pickup_city || "Pickup point"}</span></div>
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-red-400" /><span className="truncate text-xs text-muted-foreground">{t.dropoff_address || t.dropoff_city || "Drop-off point"}</span></div>
                  </div>
                  {isSel && (
                    <Link href={`/shipper/track/${t.id}`} className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
                      <Navigation className="h-4 w-4" /> Open live tracking
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function statusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Completed" || s === "Arrived") return "success";
  if (s === "InTransit" || s === "Assigned") return "default";
  if (s === "Scheduled") return "warning";
  if (s === "Cancelled") return "destructive";
  return "secondary";
}
