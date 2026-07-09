"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Navigation, MapPin, Package, Truck, CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLoad, VEHICLE_LABEL, money, loadStageLabel } from "@/lib/hooks/use-loads";

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)}h ago`;
}

export default function ShipperTrackPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const q = useLoad(id);
  const load = q.data;

  if (q.isLoading) return <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading shipment…</p>;
  if (q.isError || !load) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">Shipment not found.</p>
      </div>
    );
  }

  const hasDriverPos = load.driver_lat != null && load.driver_lng != null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink />
      <div className="flex items-center justify-between">
        <Badge className="bg-blue-500/15 text-blue-300">{VEHICLE_LABEL[load.vehicle_type] ?? load.vehicle_type}</Badge>
        <Badge>{load.status}</Badge>
      </div>

      <Card>
        <CardContent className="flex items-center gap-3 pt-6">
          <Navigation className="h-5 w-5 text-blue-400" />
          <div>
            <p className="font-semibold">{loadStageLabel(load.status)}</p>
            <p className="text-sm text-muted-foreground">
              {hasDriverPos
                ? `Truck location updated ${relativeTime(load.driver_location_at)}`
                : load.status === "Delivered" ? "Trip complete" : "Waiting for driver location…"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Route</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" /><span className="text-sm text-muted-foreground">{load.pickup_address || load.pickup_city || "Pickup point"}</span></div>
          <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-400" /><span className="text-sm text-muted-foreground">{load.dropoff_address || load.dropoff_city || "Drop-off point"}</span></div>
          <div className="flex items-center gap-6 border-t border-white/5 pt-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {load.distance_km} km</span>
            <span className="flex items-center gap-1.5 text-muted-foreground"><Package className="h-3.5 w-3.5" /> {money(Number(load.total_price))}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Proof</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ProofRow
            icon={<Truck className="h-4 w-4" />}
            title="Pickup"
            done={Boolean(load.picked_up_at)}
            meta={load.picked_up_at ? new Date(load.picked_up_at).toLocaleString() : "Not picked up yet"}
          />
          <ProofRow
            icon={<CheckCircle2 className="h-4 w-4" />}
            title="Delivery"
            done={Boolean(load.delivered_at)}
            meta={load.delivered_at ? `${new Date(load.delivered_at).toLocaleString()}${load.receiver_name ? ` · received by ${load.receiver_name}` : ""}` : "Not delivered yet"}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/shipper/loads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> All deliveries
    </Link>
  );
}

function ProofRow({ icon, title, meta, done }: { icon: React.ReactNode; title: string; meta: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-card/60 p-3">
      <div className={`grid h-9 w-9 place-items-center rounded-lg ${done ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}>{icon}</div>
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </div>
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}
