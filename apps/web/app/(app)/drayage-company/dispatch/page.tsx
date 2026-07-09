"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Radio, Ship, Truck, User, MapPin } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

const ACTIVE_STATUSES = ["Assigned", "Dispatched", "EnRoute", "PickedUp", "InTransit", "AtOrigin", "Loaded", "AtDestination", "Unloaded"];

interface MoveRow {
  id: string;
  order_id: string;
  status: string;
  move_type: string | null;
  driver_user_id: string | null;
  updated_at: string | null;
  drayage_orders: {
    id: string;
    reference_code: string | null;
    container_number: string | null;
    container_size: string | null;
    direction: string | null;
    pickup_city?: string | null;
    delivery_city?: string | null;
  } | null;
  [k: string]: unknown;
}

interface TruckRow {
  moveId: string;
  orderId: string;
  status: string;
  driverName: string;
  truck: string | null;
  referenceCode: string | null;
  containerNumber: string | null;
  direction: string | null;
  lat: number | null;
  lng: number | null;
  recordedAt: string | null;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "no GPS yet";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function useActiveMoves(companyId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["drayage", "activeMoves", companyId],
    enabled: !!companyId,
    refetchInterval: 20000,
    queryFn: async (): Promise<MoveRow[]> => {
      const { data, error } = await supabase
        .from("drayage_moves")
        .select("*, drayage_orders!inner(*)")
        .in("status", ACTIVE_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as MoveRow[] | null) ?? [];
    },
  });
}

function useFleetLive(companyId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["drayage", "fleetLive", companyId],
    enabled: !!companyId,
    refetchInterval: 10000,
    queryFn: async (): Promise<TruckRow[]> => {
      if (!companyId) return [];
      const { data: moves, error } = await supabase
        .from("drayage_moves")
        .select("id, order_id, status, driver_user_id, move_type, drayage_orders!inner(id, reference_code, container_number, container_size, direction, drayage_company_id)")
        .eq("drayage_orders.drayage_company_id", companyId)
        .in("status", ACTIVE_STATUSES)
        .not("driver_user_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (moves as MoveRow[] | null) ?? [];
      if (rows.length === 0) return [];

      const orderIds = Array.from(new Set(rows.map((m) => m.order_id)));
      const [{ data: tracks }, { data: drivers }] = await Promise.all([
        supabase
          .from("container_tracking")
          .select("order_id, move_id, driver_user_id, lat, lng, recorded_at")
          .in("order_id", orderIds)
          .order("recorded_at", { ascending: false })
          .limit(500),
        supabase.from("drivers").select("*").eq("company_id", companyId),
      ]);
      const latestByMove = new Map<string, { lat: number; lng: number; recorded_at: string }>();
      const latestByOrder = new Map<string, { lat: number; lng: number; recorded_at: string }>();
      for (const t of (tracks as { move_id: string | null; order_id: string; lat: number; lng: number; recorded_at: string }[] | null) ?? []) {
        if (t.move_id && !latestByMove.has(t.move_id)) latestByMove.set(t.move_id, t);
        if (!latestByOrder.has(t.order_id)) latestByOrder.set(t.order_id, t);
      }
      const fleet = (drivers as { driver_user_id?: string; name?: string; data?: { name?: string; truck_plate?: string } }[] | null) ?? [];
      return rows.map((m) => {
        const ping = latestByMove.get(m.id) ?? latestByOrder.get(m.order_id) ?? null;
        const d = fleet.find((x) => x.driver_user_id === m.driver_user_id);
        return {
          moveId: m.id,
          orderId: m.order_id,
          status: m.status,
          driverName: d?.name ?? d?.data?.name ?? "Driver",
          truck: d?.data?.truck_plate ?? null,
          referenceCode: m.drayage_orders?.reference_code ?? null,
          containerNumber: m.drayage_orders?.container_number ?? null,
          direction: m.drayage_orders?.direction ?? null,
          lat: ping ? Number(ping.lat) : null,
          lng: ping ? Number(ping.lng) : null,
          recordedAt: ping?.recorded_at ?? null,
        };
      });
    },
  });
}

export default function DrayageDispatchPage() {
  const companyId = useActiveCompanyId("DrayageCompany") ?? null;
  const movesQ = useActiveMoves(companyId);
  const fleetQ = useFleetLive(companyId);

  const located = useMemo(() => (fleetQ.data ?? []).filter((t) => t.lat != null && t.lng != null), [fleetQ.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Drayage Company</p>
        <h1 className="text-2xl font-semibold tracking-tight">Dispatch board</h1>
        <p className="mt-1 text-sm text-muted-foreground">Live view of active container moves and where your trucks are right now.</p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Live fleet ({located.length})</h2>
        </div>
        {fleetQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : located.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No trucks reporting GPS right now.</CardContent></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {located.map((t) => (
              <Card key={t.moveId}>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium">
                      <Truck className="h-4 w-4 text-primary" />
                      {t.driverName}
                    </div>
                    <Badge variant="secondary">{t.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t.referenceCode ?? t.containerNumber ?? "Container"} · {t.direction ?? "—"}
                    {t.truck ? ` · ${t.truck}` : ""}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {t.lat?.toFixed(4)}, {t.lng?.toFixed(4)} · {timeAgo(t.recordedAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Ship className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Active moves ({movesQ.data?.length ?? 0})</h2>
        </div>
        {movesQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (movesQ.data ?? []).length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No active moves.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {(movesQ.data ?? []).map((m) => (
              <Link key={m.id} href={`/drayage-company/${m.order_id}`}>
                <Card className="transition-colors hover:bg-accent">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <p className="font-medium">
                        {m.drayage_orders?.reference_code ?? m.drayage_orders?.container_number ?? "Container move"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {m.drayage_orders?.direction ?? "—"} · {m.drayage_orders?.container_size ?? ""} · {m.move_type ?? "Move"}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        {m.driver_user_id ? "Driver assigned" : "Unassigned"}
                      </p>
                    </div>
                    <Badge variant="secondary">{m.status}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
