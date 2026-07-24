"use client";

import { useMemo, useState } from "react";
import { Package, Loader2, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOpenLoads, useAcceptLoad, CARGO_LABEL, VEHICLE_LABEL, money, type LoadRow } from "@/lib/hooks/use-loads";
import { useExplore, useActionGuard } from "@/lib/explore-store";
import { SAMPLE_CARRIER_LOADS } from "@/lib/explore-samples";

const VEHICLES = ["All", ...Object.keys(VEHICLE_LABEL)];

export default function DriverMarketplacePage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const [vehicle, setVehicle] = useState<string>("All");
  const q = useOpenLoads(vehicle === "All" ? undefined : [vehicle]);
  const accept = useAcceptLoad();
  const [busyId, setBusyId] = useState<string | null>(null);

  const loads = useMemo<LoadRow[]>(() => (isExploring ? (SAMPLE_CARRIER_LOADS as unknown as LoadRow[]) : q.data ?? []), [q.data, isExploring]);

  const doAccept = async (id: string) => {
    if (!guard("Accept this load")) return;
    setBusyId(id);
    try {
      await accept.mutateAsync(id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to accept load");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Driver</p>
        <h1 className="text-2xl font-semibold tracking-tight">Load marketplace</h1>
        <p className="mt-1 text-sm text-muted-foreground">Open loads near you. Accept one and it moves to your trips.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {VEHICLES.map((v) => (
          <button
            key={v}
            onClick={() => setVehicle(v)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${vehicle === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
          >
            {v === "All" ? "All vehicles" : VEHICLE_LABEL[v]}
          </button>
        ))}
      </div>

      {!isExploring && q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Package className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No open loads right now. Check back soon.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {loads.map((l) => (
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
                  <span className="text-sm text-muted-foreground">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type} · {l.distance_km} km</span>
                  <Button size="sm" onClick={() => void doAccept(l.id)} disabled={busyId === l.id}>
                    {busyId === l.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Accept load
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
