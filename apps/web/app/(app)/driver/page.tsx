"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Truck, Package, CheckCircle2, DollarSign, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyTrips, useAdvanceLoad, CARGO_LABEL, VEHICLE_LABEL, money, loadStageLabel, LOAD_STATUS_FLOW, type LoadRow } from "@/lib/hooks/use-loads";
import { useExplore, useActionGuard } from "@/lib/explore-store";
import { SAMPLE_SHIPPER_LOADS } from "@/lib/explore-samples";

export default function DriverDashboardPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const trips = useMyTrips();
  const advance = useAdvanceLoad();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo<LoadRow[]>(
    () => (isExploring ? (SAMPLE_SHIPPER_LOADS as unknown as LoadRow[]) : (trips.data ?? [])),
    [trips.data, isExploring],
  );
  const active = useMemo(() => rows.filter((l) => ["Accepted", "EnRoute", "Arrived"].includes(l.status)), [rows]);
  const stats = useMemo(
    () => ({
      active: active.length,
      delivered: rows.filter((l) => l.status === "Delivered").length,
      earned: rows.filter((l) => l.status === "Delivered").reduce((s, l) => s + Number(l.total_price ?? 0), 0),
    }),
    [rows, active],
  );

  const doAdvance = async (l: LoadRow) => {
    if (!guard(`Advance load ${l.id}`)) return;
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Driver</p>
          <h1 className="text-2xl font-semibold tracking-tight">Your trips</h1>
        </div>
        <Button asChild size="lg"><Link href="/driver/loads"><Package className="mr-2 h-4 w-4" /> Find loads</Link></Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<Truck className="h-5 w-5 text-yellow-400" />} value={String(stats.active)} label="Active trips" />
        <Stat icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />} value={String(stats.delivered)} label="Delivered" />
        <Stat icon={<DollarSign className="h-5 w-5 text-primary" />} value={money(stats.earned)} label="Earned" />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Active trips</CardTitle>
          <Link href="/driver/my-loads" className="text-sm font-medium text-primary hover:underline">All trips</Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isExploring && trips.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : active.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Truck className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No active trips. Grab a load from the marketplace to get moving.</p>
              <Button asChild variant="outline" size="sm" className="mt-2"><Link href="/driver/loads">Browse loads</Link></Button>
            </div>
          ) : (
            active.map((l) => {
              const flow = LOAD_STATUS_FLOW[l.status];
              return (
                <div key={l.id} className="rounded-lg border border-white/5 bg-card/60 p-4">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-blue-500/15 text-blue-300">{CARGO_LABEL[l.cargo_type] ?? l.cargo_type}</Badge>
                    <Badge>{loadStageLabel(l.status)}</Badge>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /><span className="truncate text-sm text-muted-foreground">{l.pickup_address || l.pickup_city || "Pickup point"}</span></div>
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-red-400" /><span className="truncate text-sm text-muted-foreground">{l.dropoff_address || l.dropoff_city || "Drop-off point"}</span></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
                    <span className="text-sm text-muted-foreground">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type} · {l.distance_km} km · <span className="font-semibold text-foreground">{money(Number(l.total_price))}</span></span>
                    {flow && (
                      <Button size="sm" onClick={() => void doAdvance(l)} disabled={busyId === l.id}>
                        {busyId === l.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                        {flow.label}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted">{icon}</div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
