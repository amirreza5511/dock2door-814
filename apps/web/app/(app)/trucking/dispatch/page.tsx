"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, Truck, Navigation, UserPlus, Search, Clock, Route as RouteIcon, X, UserRound } from "lucide-react";
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

type FilterKey = "all" | "waiting" | "enroute" | "arrived";
const FILTERS: [FilterKey, string][] = [
  ["all", "All"],
  ["waiting", "Waiting for driver"],
  ["enroute", "En route"],
  ["arrived", "Arrived"],
];

interface FleetDriver {
  id: string;
  name: string | null;
  status: string;
  company_id: string;
  phone: string | null;
  data: { name?: string; email?: string; userId?: string } | null;
}

function driverUserIdOf(d: FleetDriver): string | null {
  return d.data?.userId ?? null;
}

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

/** Live map of every active truck for the company, with per-driver tracking & dispatch. */
function FleetLiveBoard() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const companyId = useActiveCompanyId("TruckingCompany");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState<string>("");
  const [assignFor, setAssignFor] = useState<LoadRow | null>(null);

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

  const fleetDriversQ = useQuery({
    queryKey: ["fleet", "drivers-full", companyId ?? "none"],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<FleetDriver[]> => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id,name,status,company_id,phone,data")
        .eq("company_id", companyId)
        .is("archived_at", null)
        .limit(300);
      if (error) throw error;
      return (data as FleetDriver[] | null) ?? [];
    },
  });

  const fleetDrivers = useMemo<FleetDriver[]>(() => fleetDriversQ.data ?? [], [fleetDriversQ.data]);
  const linkedDrivers = useMemo(() => fleetDrivers.filter((d) => !!driverUserIdOf(d)), [fleetDrivers]);
  const unlinkedCount = fleetDrivers.length - linkedDrivers.length;

  const driverNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of fleetDrivers) {
      const uid = driverUserIdOf(d);
      if (uid) map.set(uid, d.name || d.data?.name || "Driver");
    }
    return map;
  }, [fleetDrivers]);

  const resolveDriverName = useMemo(() => (t: LoadRow): string => {
    const dn = t.driver_name as string | null | undefined;
    if (dn && dn.trim()) return dn.trim();
    if (t.accepted_driver_user_id) {
      const n = driverNameById.get(t.accepted_driver_user_id);
      if (n) return n;
    }
    return VEHICLE_LABEL[t.vehicle_type] || "Assigned driver";
  }, [driverNameById]);

  const dispatch = useMutation({
    mutationFn: async ({ loadId, driverUserId }: { loadId: string; driverUserId: string }) => {
      const { error } = await supabase.rpc("dispatch_load", { p_load_id: loadId, p_driver_user_id: driverUserId });
      if (error) throw error;
    },
    onSuccess: () => {
      setAssignFor(null);
      qc.invalidateQueries({ queryKey: ["fleet", "live-loads"] });
    },
  });

  const allTrips = useMemo<LoadRow[]>(() => q.data ?? [], [q.data]);
  const waiting = useMemo(() => allTrips.filter((t) => !t.accepted_driver_user_id), [allTrips]);

  const trips = useMemo<LoadRow[]>(() => {
    let list = allTrips;
    if (filter === "waiting") list = list.filter((t) => !t.accepted_driver_user_id);
    else if (filter === "enroute") list = list.filter((t) => t.status === "EnRoute" || (t.status === "Accepted" && !!t.accepted_driver_user_id));
    else if (filter === "arrived") list = list.filter((t) => t.status === "Arrived");
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter((t) =>
        `${resolveDriverName(t)} ${t.pickup_address ?? ""} ${t.dropoff_address ?? ""} ${t.vehicle_type}`.toLowerCase().includes(s),
      );
    }
    return list;
  }, [allTrips, filter, search, resolveDriverName]);

  const selectedTrip = useMemo(() => trips.find((t) => t.id === selected) ?? null, [trips, selected]);

  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    for (const t of trips) {
      const isSel = t.id === selected;
      if (isCoord(t.driver_lat) && isCoord(t.driver_lng)) {
        pts.push({ id: `d-${t.id}`, lat: Number(t.driver_lat), lng: Number(t.driver_lng), kind: "driver", label: resolveDriverName(t), selected: isSel });
      }
      if (isSel) {
        if (isCoord(t.pickup_lat) && isCoord(t.pickup_lng)) pts.push({ id: `p-${t.id}`, lat: Number(t.pickup_lat), lng: Number(t.pickup_lng), kind: "pickup", label: "Pickup" });
        if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng)) pts.push({ id: `x-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: "dropoff", label: "Drop-off" });
      } else if (isCoord(t.dropoff_lat) && isCoord(t.dropoff_lng) && !(isCoord(t.driver_lat) && isCoord(t.driver_lng))) {
        pts.push({ id: `l-${t.id}`, lat: Number(t.dropoff_lat), lng: Number(t.dropoff_lng), kind: "load", label: resolveDriverName(t) });
      }
    }
    return pts;
  }, [trips, selected, resolveDriverName]);

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

  const withGps = allTrips.filter((t) => isCoord(t.driver_lat) && isCoord(t.driver_lng)).length;
  const eta = road.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dispatch console</CardTitle>
        <CardDescription>{allTrips.length} active · {withGps} live · {waiting.length} waiting</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoadsMap
          points={points}
          routes={routes}
          height={340}
          onSelectPoint={(id) => { const tid = id.split("-").slice(1).join("-"); setSelected(tid); }}
        />

        {allTrips.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Truck className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No active loads. Loads your company accepts appear here — assign a driver to each and track them live.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search driver, city, address"
                className="h-10 flex-1 bg-transparent text-sm outline-none"
              />
              {search && <button onClick={() => setSearch("")}><X className="h-4 w-4 text-muted-foreground" /></button>}
            </div>

            <div className="flex flex-wrap gap-2">
              {FILTERS.map(([key, label]) => {
                const active = filter === key;
                const count = key === "all" ? allTrips.length : key === "waiting" ? waiting.length : key === "enroute" ? allTrips.filter((t) => t.status === "EnRoute" || (t.status === "Accepted" && !!t.accepted_driver_user_id)).length : allTrips.filter((t) => t.status === "Arrived").length;
                return (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-accent/40"}`}
                  >
                    {label} · {count}
                  </button>
                );
              })}
            </div>

            {filter === "all" && waiting.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <UserPlus className="h-4 w-4 text-amber-400" />
                <span className="flex-1 text-xs font-semibold">{waiting.length} load{waiting.length > 1 ? "s" : ""} waiting for a driver</span>
                <button className="text-xs font-bold text-amber-400" onClick={() => setFilter("waiting")}>View</button>
              </div>
            )}

            {trips.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No loads match this filter or search.</p>
            ) : (
              <div className="grid gap-2">
                {trips.map((t) => {
                  const isSel = t.id === selected;
                  const live = isCoord(t.driver_lat) && isCoord(t.driver_lng);
                  const hasDriver = !!t.accepted_driver_user_id;
                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border p-3 transition-colors ${isSel ? "border-primary bg-primary/5" : "border-white/10"}`}
                    >
                      <div className="flex cursor-pointer items-center gap-3" onClick={() => setSelected(isSel ? null : t.id)}>
                        <div className={`grid h-9 w-9 place-items-center rounded-lg ${live ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                          <Truck className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{hasDriver ? resolveDriverName(t) : "Unassigned load"}</p>
                          <span className="flex items-center gap-1.5 text-xs" style={{ color: live ? "#34d399" : undefined }}>
                            <Radio className="h-3 w-3" />
                            <span className={live ? "" : "text-muted-foreground"}>{live ? `Live · ${relativeTime(t.driver_location_at)}` : hasDriver ? "No GPS signal yet" : "Not dispatched"}</span>
                          </span>
                        </div>
                        <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                      </div>
                      <div className="mt-2 space-y-1 pl-12">
                        <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /><span className="truncate text-xs text-muted-foreground">{t.pickup_address || t.pickup_city || "Pickup point"}</span></div>
                        <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-red-400" /><span className="truncate text-xs text-muted-foreground">{t.dropoff_address || t.dropoff_city || "Drop-off point"}</span></div>
                      </div>
                      {isSel && eta && (
                        <div className="mt-2 flex items-center gap-2 pl-12">
                          <span className="flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 text-xs font-bold text-primary"><RouteIcon className="h-3 w-3" />{eta.distanceKm.toFixed(1)} km</span>
                          <span className="flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 text-xs font-bold text-primary"><Clock className="h-3 w-3" />~{Math.round(eta.durationMin)} min</span>
                          <span className="text-xs text-muted-foreground">{toPickup ? "to pickup" : "to drop-off"}</span>
                        </div>
                      )}
                      <div className="mt-3 flex gap-2 pl-12">
                        <button
                          onClick={() => setAssignFor(t)}
                          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary"
                        >
                          <UserPlus className="h-4 w-4" /> {hasDriver ? "Reassign driver" : "Assign driver"}
                        </button>
                        {isSel && (
                          <Link href={`/shipper/track/${t.id}`} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
                            <Navigation className="h-4 w-4" /> Track
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>

      {assignFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAssignFor(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold">Assign a driver</h3>
                <p className="text-sm text-muted-foreground">Pick a fleet driver to run this load.</p>
              </div>
              <button onClick={() => setAssignFor(null)} className="grid h-8 w-8 place-items-center rounded-lg bg-muted"><X className="h-4 w-4" /></button>
            </div>
            {fleetDriversQ.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading drivers…</p>
            ) : linkedDrivers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <UserRound className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-semibold">No drivers with a login</p>
                <p className="text-sm text-muted-foreground">Drivers can only be dispatched once they join your fleet with a Driver account. Open Fleet and set the email they signed up with, or share your fleet code.</p>
                <Link href="/trucking/fleet" className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Open Fleet</Link>
              </div>
            ) : (
              <div className="max-h-[360px] space-y-2 overflow-y-auto">
                {linkedDrivers.map((d) => {
                  const uid = driverUserIdOf(d);
                  const current = assignFor.accepted_driver_user_id === uid;
                  return (
                    <button
                      key={d.id}
                      disabled={dispatch.isPending || !uid}
                      onClick={() => uid && dispatch.mutate({ loadId: assignFor.id, driverUserId: uid })}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${current ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40"}`}
                    >
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary"><UserRound className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{d.name || d.data?.name || "Driver"}</p>
                        {(d.phone || d.data?.email) && <p className="truncate text-xs text-muted-foreground">{[d.phone, d.data?.email].filter(Boolean).join(" · ")}</p>}
                      </div>
                      {current && <span className="text-xs font-bold text-primary">Current</span>}
                    </button>
                  );
                })}
                {unlinkedCount > 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">{unlinkedCount} more driver{unlinkedCount > 1 ? "s are" : " is"} not linked to an app account yet and can’t be dispatched.</p>
                )}
                {dispatch.error && <p className="text-sm text-red-500">{(dispatch.error as Error).message}</p>}
              </div>
            )}
          </div>
        </div>
      )}
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
