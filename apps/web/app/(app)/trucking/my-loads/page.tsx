"use client";

import { useMemo, useState } from "react";
import { Truck, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useMyTrips,
  useAdvanceLoad,
  CARGO_LABEL,
  VEHICLE_LABEL,
  LOAD_STATUS_FLOW,
  loadStageLabel,
  money,
  type LoadRow,
} from "@/lib/hooks/use-loads";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const FILTERS = ["Active", "Delivered", "All"] as const;
type Filter = (typeof FILTERS)[number];

const SAMPLE_MY_LOADS = [
  { id: "ex-ml-1", vehicle_type: "five_ton", cargo_type: "palletized", pallets: 10, status: "EnRoute", pickup_address: "Richmond, BC", dropoff_address: "Surrey, BC", distance_km: 32, total_price: 520, created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
  { id: "ex-ml-2", vehicle_type: "reefer", cargo_type: "refrigerated", pallets: 8, status: "Accepted", pickup_address: "Abbotsford, BC", dropoff_address: "Vancouver, BC", distance_km: 68, total_price: 890, created_at: new Date(Date.now() - 3600000 * 2).toISOString() },
  { id: "ex-ml-3", vehicle_type: "cube_van", cargo_type: "general", pallets: 5, status: "Delivered", pickup_address: "Coquitlam, BC", dropoff_address: "Langley, BC", distance_km: 44, total_price: 610, created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
] as unknown as LoadRow[];

export default function TruckingMyLoadsPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const q = useMyTrips({ enabled: !isExploring });
  const advance = useAdvanceLoad();
  const [filter, setFilter] = useState<Filter>("Active");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loads = useMemo<LoadRow[]>(() => {
    const all = isExploring ? SAMPLE_MY_LOADS : (q.data ?? []);
    if (filter === "All") return all;
    if (filter === "Delivered") return all.filter((l) => l.status === "Delivered");
    return all.filter((l) => l.status !== "Delivered" && l.status !== "Cancelled");
  }, [q.data, filter, isExploring]);

  const doAdvance = async (l: LoadRow) => {
    const flow = LOAD_STATUS_FLOW[l.status];
    if (!flow) return;
    if (!guard(flow.label)) return;
    setBusyId(l.id);
    try {
      await advance.mutateAsync({ id: l.id, status: flow.next });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to update load");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Trucking</p>
        <h1 className="text-2xl font-semibold tracking-tight">My loads</h1>
        <p className="mt-1 text-sm text-muted-foreground">Loads your fleet has claimed. Move each one through its stages.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
          >
            {f}
          </button>
        ))}
      </div>

      {!isExploring && q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Truck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No loads here yet. Claim one from the dispatch board.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {loads.map((l) => {
            const flow = LOAD_STATUS_FLOW[l.status];
            return (
              <Card key={l.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-blue-500/15 text-blue-300">{CARGO_LABEL[l.cargo_type] ?? l.cargo_type}</Badge>
                    <span className="text-lg font-bold">{money(Number(l.total_price))}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /><span className="truncate text-sm text-muted-foreground">{l.pickup_address || l.pickup_city || "Pickup point"}</span></div>
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-red-400" /><span className="truncate text-sm text-muted-foreground">{l.dropoff_address || l.dropoff_city || "Drop-off point"}</span></div>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/5 pt-3">
                    <span className="text-sm text-muted-foreground">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type} · {loadStageLabel(l.status)}</span>
                    {flow && (
                      <Button size="sm" onClick={() => void doAdvance(l)} disabled={busyId === l.id}>
                        {busyId === l.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {flow.label}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
