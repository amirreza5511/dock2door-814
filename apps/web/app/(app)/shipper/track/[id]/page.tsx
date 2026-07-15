"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Navigation, MapPin, Package, Truck, CheckCircle2, Clock, Share2, Copy, Check, Phone, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLoad, useSetReceiverContact, VEHICLE_LABEL, money, loadStageLabel, type LoadRow } from "@/lib/hooks/use-loads";
import LoadsMap, { type MapPoint, type MapRoute } from "@/components/loads-map";
import { useRoadRoute } from "@/lib/route";

function isCoord(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

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

      <TrackMap load={load} />

      <ShareCard load={load} />
      <ReceiverContactCard load={load} />

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

function ShareCard({ load }: { load: LoadRow }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" && load.track_token ? `${window.location.origin}/t/${load.track_token}` : "";

  const share = async () => {
    if (!url) return;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "Track your delivery", text: "Track your delivery live:", url }); return; } catch { /* fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  if (!load.track_token) return null;
  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Share tracking link</p>
        </div>
        <p className="text-xs text-muted-foreground">Send this to the receiver — they can follow the driver live without an account.</p>
        <div className="flex items-center gap-2">
          <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button onClick={() => void share()} className="shrink-0">
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? "Copied" : "Share"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiverContactCard({ load }: { load: LoadRow }) {
  const setContact = useSetReceiverContact();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPhone(load.recipient_phone ?? "");
    setEmail(load.receiver_email ?? "");
  }, [load.recipient_phone, load.receiver_email]);

  const save = async () => {
    try {
      await setContact.mutateAsync({ id: load.id, phone: phone.trim(), email: email.trim() });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { /* surfaced below */ }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Receiver contact</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Receiver phone" />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Receiver email" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => void save()} disabled={setContact.isPending}>
            {saved ? <Check className="mr-2 h-4 w-4" /> : null}{saved ? "Saved" : setContact.isPending ? "Saving…" : "Save contact"}
          </Button>
          {setContact.error && <span className="text-xs text-red-400">{(setContact.error as Error).message}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function TrackMap({ load }: { load: LoadRow }) {
  const driver = isCoord(load.driver_lat) && isCoord(load.driver_lng) ? { lat: Number(load.driver_lat), lng: Number(load.driver_lng) } : null;
  const pickup = isCoord(load.pickup_lat) && isCoord(load.pickup_lng) ? { lat: Number(load.pickup_lat), lng: Number(load.pickup_lng) } : null;
  const dropoff = isCoord(load.dropoff_lat) && isCoord(load.dropoff_lng) ? { lat: Number(load.dropoff_lat), lng: Number(load.dropoff_lng) } : null;

  // Before pickup the truck heads to the pickup; after that it heads to drop-off.
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
    // Faint remaining leg to the final drop-off while still heading to pickup.
    if (beforePickup && pickup && dropoff) out.push({ from: pickup, to: dropoff, muted: true });
    return out;
  }, [origin, target, road.data, beforePickup, pickup, dropoff]);

  if (points.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <LoadsMap points={points} routes={routes} height={320} className="rounded-2xl" />
      </CardContent>
    </Card>
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
