"use client";

import { useMemo, useState } from "react";
import { Truck, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyTrips, useAdvanceLoad, CARGO_LABEL, VEHICLE_LABEL, money, loadStageLabel, LOAD_STATUS_FLOW, type LoadRow } from "@/lib/hooks/use-loads";

const FILTERS = ["All", "Active", "Delivered"] as const;

export default function DriverMyLoadsPage() {
  const trips = useMyTrips();
  const advance = useAdvanceLoad();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const rows = useMemo<LoadRow[]>(() => {
    const all = trips.data ?? [];
    if (filter === "Active") return all.filter((l) => ["Accepted", "EnRoute", "Arrived"].includes(l.status));
    if (filter === "Delivered") return all.filter((l) => l.status === "Delivered");
    return all;
  }, [trips.data, filter]);

  const doAdvance = async (l: LoadRow) => {
    const flow = LOAD_STATUS_FLOW[l.status];
    if (!flow) return;
    setBusyId(l.id);
    try {
      const receiverName = flow.next === "Delivered" ? (window.prompt("Receiver name (optional)") ?? undefined) : undefined;
      await advance.mutateAsync({ id: l.id, status: flow.next, receiverName });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to update load");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My trips</h1>

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

      {trips.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Truck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No trips in this view.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((l) => {
            const flow = LOAD_STATUS_FLOW[l.status];
            return (
              <Card key={l.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-blue-500/15 text-blue-300">{CARGO_LABEL[l.cargo_type] ?? l.cargo_type}</Badge>
                    <Badge>{loadStageLabel(l.status)}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /><span className="truncate text-sm text-muted-foreground">{l.pickup_address || l.pickup_city || "Pickup point"}</span></div>
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-red-400" /><span className="truncate text-sm text-muted-foreground">{l.dropoff_address || l.dropoff_city || "Drop-off point"}</span></div>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/5 pt-3">
                    <span className="text-sm text-muted-foreground">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type} · {l.distance_km} km · <span className="font-semibold text-foreground">{money(Number(l.total_price))}</span></span>
                    {flow && (
                      <Button size="sm" onClick={() => void doAdvance(l)} disabled={busyId === l.id}>
                        {busyId === l.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
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
