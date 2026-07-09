"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Package, Truck, CheckCircle2, MapPin, Plus, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyPostedLoads, CARGO_LABEL, VEHICLE_LABEL, money, type LoadRow } from "@/lib/hooks/use-loads";

export default function ShipperDashboardPage() {
  const q = useMyPostedLoads();
  const loads = useMemo<LoadRow[]>(() => q.data ?? [], [q.data]);

  const stats = useMemo(
    () => ({
      open: loads.filter((l) => l.status === "Open").length,
      inTransit: loads.filter((l) => ["Accepted", "EnRoute", "Arrived"].includes(l.status)).length,
      delivered: loads.filter((l) => l.status === "Delivered").length,
      spend: loads.filter((l) => l.status !== "Cancelled").reduce((s, l) => s + Number(l.total_price ?? 0), 0),
    }),
    [loads],
  );
  const recent = useMemo(() => loads.slice(0, 6), [loads]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Freight &amp; Delivery</p>
          <h1 className="text-2xl font-semibold tracking-tight">Shipper</h1>
        </div>
        <Button asChild size="lg">
          <Link href="/shipper/post-load"><Plus className="mr-2 h-4 w-4" /> Post a delivery</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Package className="h-5 w-5 text-blue-400" />} value={String(stats.open)} label="Open" />
        <Stat icon={<Truck className="h-5 w-5 text-yellow-400" />} value={String(stats.inTransit)} label="In transit" />
        <Stat icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />} value={String(stats.delivered)} label="Delivered" />
        <Stat icon={<MapPin className="h-5 w-5 text-primary" />} value={money(stats.spend)} label="Total spend" />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent deliveries</CardTitle>
          <Link href="/shipper/loads" className="text-sm font-medium text-primary hover:underline">Track all</Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Send className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No deliveries yet. Post your first load and a nearby driver will pick it up.</p>
              <Button asChild variant="outline" size="sm" className="mt-2"><Link href="/shipper/post-load">Post a delivery</Link></Button>
            </div>
          ) : (
            recent.map((l) => (
              <Link key={l.id} href={`/shipper/track/${l.id}`} className="block">
                <div className="rounded-lg border border-white/5 bg-card/60 p-4 transition-colors hover:border-primary/40">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-blue-500/15 text-blue-300">{CARGO_LABEL[l.cargo_type] ?? l.cargo_type}</Badge>
                    <Badge>{l.status}</Badge>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <Route color="bg-emerald-400" text={l.pickup_address || l.pickup_city || "Pickup point"} />
                    <Route color="bg-red-400" text={l.dropoff_address || l.dropoff_city || "Drop-off point"} />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-sm">
                    <span className="text-muted-foreground">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type} · {l.distance_km} km</span>
                    <span className="font-semibold">{money(Number(l.total_price))}</span>
                  </div>
                </div>
              </Link>
            ))
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

function Route({ color, text }: { color: string; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      <span className="truncate text-sm text-muted-foreground">{text}</span>
    </div>
  );
}
