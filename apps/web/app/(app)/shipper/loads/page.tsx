"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyPostedLoads, CARGO_LABEL, VEHICLE_LABEL, money, type LoadRow } from "@/lib/hooks/use-loads";
import { useExplore } from "@/lib/explore-store";
import { SAMPLE_SHIPPER_LOADS } from "@/lib/explore-samples";

const FILTERS = ["All", "Open", "In transit", "Delivered"] as const;

export default function ShipperLoadsPage() {
  const { isExploring } = useExplore();
  const q = useMyPostedLoads();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const loads = useMemo<LoadRow[]>(() => {
    const all = isExploring ? (SAMPLE_SHIPPER_LOADS as unknown as LoadRow[]) : (q.data ?? []);
    if (filter === "Open") return all.filter((l) => l.status === "Open");
    if (filter === "In transit") return all.filter((l) => ["Accepted", "EnRoute", "Arrived"].includes(l.status));
    if (filter === "Delivered") return all.filter((l) => l.status === "Delivered");
    return all;
  }, [q.data, filter, isExploring]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">My deliveries</h1>
        <Button asChild><Link href="/shipper/post-load">Post a delivery</Link></Button>
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
            <Send className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No deliveries in this view.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {loads.map((l) => (
            <Link key={l.id} href={`/shipper/track/${l.id}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-blue-500/15 text-blue-300">{CARGO_LABEL[l.cargo_type] ?? l.cargo_type}</Badge>
                    <Badge>{l.status}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /><span className="truncate text-sm text-muted-foreground">{l.pickup_address || l.pickup_city || "Pickup point"}</span></div>
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-red-400" /><span className="truncate text-sm text-muted-foreground">{l.dropoff_address || l.dropoff_city || "Drop-off point"}</span></div>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/5 pt-3 text-sm">
                    <span className="text-muted-foreground">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type} · {l.distance_km} km</span>
                    <span className="font-semibold">{money(Number(l.total_price))}</span>
                  </div>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/shipper/documents?loadId=${l.id}`; }}
                    className="flex w-full items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                  >
                    <FileText className="h-3.5 w-3.5" /> Labels &amp; BOL{typeof l.bol_number === "string" ? ` · ${l.bol_number}` : ""}
                  </button>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
