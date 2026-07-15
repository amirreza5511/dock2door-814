"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { Navigation, MapPin, Truck, CheckCircle2, Clock, Phone, PackageCheck } from "lucide-react";
import LoadsMap, { type MapPoint, type MapRoute } from "@/components/loads-map";
import { useRoadRoute } from "@/lib/route";
import { usePublicTrack, VEHICLE_LABEL, loadStageLabel, type PublicTrack } from "@/lib/hooks/use-loads";
import { VoiceCallButton } from "@/components/voice-call";

function isCoord(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)}h ago`;
}

export default function PublicTrackPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const q = usePublicTrack(token);
  const load = q.data;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">Live shipment tracking</p>
            <p className="text-xs text-muted-foreground">Follow your delivery in real time</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 p-4">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading shipment…</p>
        ) : !load ? (
          <div className="rounded-2xl border border-white/10 bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">This tracking link is invalid or has expired.</p>
          </div>
        ) : (
          <TrackBody load={load} />
        )}
      </div>
    </main>
  );
}

function TrackBody({ load }: { load: PublicTrack }) {
  const driver = isCoord(load.driver_lat) && isCoord(load.driver_lng) ? { lat: Number(load.driver_lat), lng: Number(load.driver_lng) } : null;
  const pickup = isCoord(load.pickup_lat) && isCoord(load.pickup_lng) ? { lat: Number(load.pickup_lat), lng: Number(load.pickup_lng) } : null;
  const dropoff = isCoord(load.dropoff_lat) && isCoord(load.dropoff_lng) ? { lat: Number(load.dropoff_lat), lng: Number(load.dropoff_lng) } : null;

  const beforePickup = load.status === "Accepted" || !load.picked_up_at;
  const origin = driver ?? pickup;
  const target = beforePickup ? pickup : dropoff;
  const road = useRoadRoute([origin, target], Boolean(origin && target));

  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    if (pickup) pts.push({ id: "pickup", lat: pickup.lat, lng: pickup.lng, kind: "pickup", label: "Pickup" });
    if (dropoff) pts.push({ id: "dropoff", lat: dropoff.lat, lng: dropoff.lng, kind: "dropoff", label: "Drop-off" });
    if (driver) pts.push({ id: "driver", lat: driver.lat, lng: driver.lng, kind: "driver", label: "Truck", selected: true });
    return pts;
  }, [pickup, dropoff, driver]);

  const routes = useMemo<MapRoute[]>(() => {
    const out: MapRoute[] = [];
    if (origin && target) out.push({ from: origin, to: target, path: road.data?.path ?? undefined });
    if (beforePickup && pickup && dropoff) out.push({ from: pickup, to: dropoff, muted: true });
    return out;
  }, [origin, target, road.data, beforePickup, pickup, dropoff]);

  const arrived = load.status === "Arrived";
  const delivered = load.status === "Delivered";
  const hasDriverPos = driver != null;

  return (
    <>
      {/* Status banner */}
      <div className={`rounded-2xl border p-5 ${arrived ? "border-amber-500/40 bg-amber-500/10" : delivered ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-card"}`}>
        <div className="flex items-center gap-3">
          {delivered ? <PackageCheck className="h-6 w-6 text-emerald-400" /> : <Navigation className="h-6 w-6 text-primary" />}
          <div className="flex-1">
            <p className="text-lg font-semibold">{loadStageLabel(load.status)}</p>
            <p className="text-sm text-muted-foreground">
              {hasDriverPos
                ? `Driver location updated ${relativeTime(load.driver_location_at)}`
                : delivered ? "Trip complete" : "Waiting for driver location…"}
            </p>
          </div>
        </div>
      </div>

      {points.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <LoadsMap points={points} routes={routes} height={340} className="rounded-none border-0" />
        </div>
      )}

      {/* Call the driver — tap-to-call + in-app voice */}
      {(arrived || load.status === "EnRoute") && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {load.driver_phone && (
            <a
              href={`tel:${load.driver_phone}`}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
            >
              <Phone className="h-4 w-4" /> Call driver{load.driver_name ? ` · ${load.driver_name}` : ""}
            </a>
          )}
          <VoiceCallButton room={`load-${load.id}`} role="receiver" className="flex-1" />
        </div>
      )}

      {/* Route */}
      <div className="rounded-2xl border border-white/10 bg-card p-5">
        <p className="mb-3 text-sm font-semibold">Route</p>
        <div className="space-y-2">
          <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" /><span className="text-sm text-muted-foreground">{load.pickup_address || load.pickup_city || "Pickup point"}</span></div>
          <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-400" /><span className="text-sm text-muted-foreground">{load.dropoff_address || load.dropoff_city || "Drop-off point"}</span></div>
          <div className="flex items-center gap-6 border-t border-white/5 pt-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {load.distance_km ?? "—"} km</span>
            <span className="flex items-center gap-1.5 text-muted-foreground"><Truck className="h-3.5 w-3.5" /> {VEHICLE_LABEL[load.vehicle_type] ?? load.vehicle_type}</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="rounded-2xl border border-white/10 bg-card p-5">
        <p className="mb-3 text-sm font-semibold">Progress</p>
        <div className="space-y-3">
          <StepRow icon={<Truck className="h-4 w-4" />} title="Picked up" done={Boolean(load.picked_up_at)} meta={load.picked_up_at ? new Date(load.picked_up_at).toLocaleString() : "Not picked up yet"} />
          <StepRow icon={<CheckCircle2 className="h-4 w-4" />} title="Delivered" done={Boolean(load.delivered_at)} meta={load.delivered_at ? `${new Date(load.delivered_at).toLocaleString()}${load.receiver_name ? ` · received by ${load.receiver_name}` : ""}` : "Not delivered yet"} />
        </div>
      </div>
    </>
  );
}

function StepRow({ icon, title, meta, done }: { icon: React.ReactNode; title: string; meta: string; done: boolean }) {
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
