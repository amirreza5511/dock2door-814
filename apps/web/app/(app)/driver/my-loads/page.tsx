"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Truck, Loader2, ArrowRight, ScanLine, Camera, Check, X, PenLine, Navigation, Flag, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadsMap, { type MapPoint, type MapRoute } from "@/components/loads-map";
import { useRoadRoute } from "@/lib/route";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  useMyTrips,
  useAdvanceLoad,
  useScanPiece,
  CARGO_LABEL,
  VEHICLE_LABEL,
  money,
  loadStageLabel,
  LOAD_STATUS_FLOW,
  type LoadRow,
} from "@/lib/hooks/use-loads";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const SAMPLE_TRIPS = [
  { id: "ex-trip-1", vehicle_type: "FiveTon", cargo_type: "Pallet", status: "EnRoute", pickup_address: "Richmond, BC", pickup_city: "Richmond", dropoff_address: "Surrey, BC", dropoff_city: "Surrey", pickup_lat: 49.1666, pickup_lng: -123.1336, dropoff_lat: 49.1913, dropoff_lng: -122.849, driver_lat: 49.178, driver_lng: -123.02, distance_km: 32, total_price: 520, picked_up_at: new Date(Date.now() - 3600000).toISOString(), delivered_at: null, recipient_phone: "+1 604 555 0142", recipient_name: "Harbour Freight Ltd." },
  { id: "ex-trip-2", vehicle_type: "CargoVan", cargo_type: "Box", status: "Accepted", pickup_address: "Vancouver, BC", pickup_city: "Vancouver", dropoff_address: "Burnaby, BC", dropoff_city: "Burnaby", pickup_lat: 49.2827, pickup_lng: -123.1207, dropoff_lat: 49.2488, dropoff_lng: -122.9805, distance_km: 14, total_price: 180, picked_up_at: null, delivered_at: null },
  { id: "ex-trip-3", vehicle_type: "FiveTon", cargo_type: "Pallet", status: "Delivered", pickup_address: "Delta, BC", pickup_city: "Delta", dropoff_address: "North Vancouver, BC", dropoff_city: "North Vancouver", distance_km: 41, total_price: 310, picked_up_at: new Date(Date.now() - 86400000).toISOString(), delivered_at: new Date(Date.now() - 82800000).toISOString(), receiver_name: "J. Tran" },
] as unknown as LoadRow[];

const FILTERS = ["All", "Active", "Delivered"] as const;

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export default function DriverMyLoadsPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const trips = useMyTrips();
  const advance = useAdvanceLoad();
  const scanPiece = useScanPiece();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  // Pickup scanning
  const [scanFor, setScanFor] = useState<LoadRow | null>(null);
  const [scanState, setScanState] = useState<{ scanned: number; total: number }>({ scanned: 0, total: 0 });

  // Delivery / start-trip proof modal
  const [proof, setProof] = useState<{ load: LoadRow; nextStatus: string; kind: "pickup" | "delivery" } | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  const rows = useMemo<LoadRow[]>(() => {
    const all = isExploring ? SAMPLE_TRIPS : (trips.data ?? []);
    if (filter === "Active") return all.filter((l) => ["Accepted", "EnRoute", "Arrived"].includes(l.status));
    if (filter === "Delivered") return all.filter((l) => l.status === "Delivered");
    return all;
  }, [trips.data, filter, isExploring]);

  // The single load the driver is actively navigating: prefer the furthest-along
  // active trip (Arrived → EnRoute → Accepted), matching the mobile nav card.
  const navLoad = useMemo<LoadRow | null>(() => {
    const all = isExploring ? SAMPLE_TRIPS : (trips.data ?? []);
    const rank: Record<string, number> = { Arrived: 3, EnRoute: 2, Accepted: 1 };
    const active = all.filter((l) => rank[l.status]).sort((a, b) => rank[b.status] - rank[a.status]);
    return active[0] ?? null;
  }, [trips.data, isExploring]);

  const handleScanned = (barcode: string) => {
    scanPiece.mutate(barcode, {
      onSuccess: (res) => {
        if (scanFor && res.loadId && res.loadId !== scanFor.id) {
          window.alert("That label belongs to another shipment.");
          return;
        }
        setScanState({ scanned: Number(res.scannedCount ?? 0), total: Number(res.totalCount ?? 0) });
      },
      onError: (e) => window.alert(e instanceof Error ? e.message : "Scan failed"),
    });
  };

  const onPickPhoto = (f: File | null) => {
    setPhoto(f);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(f ? URL.createObjectURL(f) : null);
  };

  const openProof = (load: LoadRow, nextStatus: string, kind: "pickup" | "delivery") => {
    if (!guard("Update this trip")) return;
    setProof({ load, nextStatus, kind });
    onPickPhoto(null);
    setReceiverName("");
  };

  const closeProof = () => {
    setProof(null);
    onPickPhoto(null);
    setReceiverName("");
  };

  const submitProof = async () => {
    if (!proof) return;
    if (!photo) return window.alert("Add a photo first.");
    if (proof.kind === "delivery" && !receiverName.trim()) return window.alert("Enter the receiver name.");
    setBusy(true);
    try {
      const supabase = getBrowserSupabase();
      const ts = Date.now();
      const photoPath = `load-proof/${proof.load.id}/${proof.kind}_${ts}.jpg`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(photoPath, photo, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;

      let signaturePath: string | null = null;
      if (proof.kind === "delivery" && sigRef.current && !sigRef.current.isBlank()) {
        const sigBlob = await dataUrlToBlob(sigRef.current.toDataUrl());
        const sigPath = `load-proof/${proof.load.id}/signature_${ts}.png`;
        const { error: sErr } = await supabase.storage.from("attachments").upload(sigPath, sigBlob, { contentType: "image/png", upsert: true });
        if (sErr) throw sErr;
        signaturePath = sigPath;
      }

      await advance.mutateAsync({
        id: proof.load.id,
        status: proof.nextStatus,
        proofPhotoPath: photoPath,
        receiverName: proof.kind === "delivery" ? receiverName.trim() : undefined,
        signaturePath,
      });
      closeProof();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to submit");
    } finally {
      setBusy(false);
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

      {navLoad && <DriverNavCard load={navLoad} advance={advance} openProof={openProof} />}

      {!isExploring && trips.isLoading ? (
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
            const isPickup = l.status === "Accepted";
            const isDelivery = flow?.next === "Delivered";
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

                  {isPickup && (
                    <button
                      onClick={() => { if (!guard("Scan piece labels")) return; setScanFor(l); setScanState({ scanned: 0, total: 0 }); }}
                      className="flex w-full items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2.5 text-left"
                    >
                      <ScanLine className="h-4 w-4 text-primary" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold">Scan the piece labels</p>
                        <p className="text-xs text-muted-foreground">Scan each pallet/box QR at pickup</p>
                      </div>
                    </button>
                  )}

                  <div className="flex items-center justify-between border-t border-white/5 pt-3">
                    <span className="text-sm text-muted-foreground">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type} · {l.distance_km} km · <span className="font-semibold text-foreground">{money(Number(l.total_price))}</span></span>
                    {flow && (
                      <Button
                        size="sm"
                        onClick={() => { if (!(isPickup || isDelivery) && !guard(flow.label)) return; (isPickup || isDelivery) ? openProof(l, flow.next, isDelivery ? "delivery" : "pickup") : void advance.mutateAsync({ id: l.id, status: flow.next }); }}
                        disabled={busy}
                      >
                        <ArrowRight className="mr-2 h-4 w-4" />
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

      {/* Pickup scanner */}
      <BarcodeScanner
        open={scanFor !== null}
        onClose={() => setScanFor(null)}
        onScanned={handleScanned}
        title="Scan pickup labels"
        subtitle="Point at each pallet/box QR code"
        progress={scanState.total > 0 ? `${scanState.scanned} of ${scanState.total} scanned` : undefined}
      />

      {/* Proof modal */}
      {proof && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-background p-5 sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{proof.kind === "pickup" ? "Confirm pickup" : "Confirm delivery"}</h2>
              <button onClick={closeProof} className="flex h-9 w-9 items-center justify-center rounded-lg border"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Photo of {proof.kind === "pickup" ? "the loaded cargo" : "the delivery"}</Label>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => fileRef.current?.click()} className="flex h-44 w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-muted/30">
                  {photoPreview ? (
                    <Image src={photoPreview} alt="Proof" width={400} height={176} unoptimized className="h-44 w-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-2 text-muted-foreground"><Camera className="h-8 w-8" /><span className="text-sm">Tap to add photo</span></span>
                  )}
                </button>
              </div>

              {proof.kind === "delivery" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Received by</Label>
                    <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Name of person who received it" />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5"><PenLine className="h-4 w-4" /> Receiver signature</Label>
                    <SignaturePad ref={sigRef} />
                  </div>
                </>
              )}

              <Button className="w-full" size="lg" onClick={() => void submitProof()} disabled={busy || advance.isPending}>
                {busy || advance.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {proof.kind === "pickup" ? "Confirm pickup & start trip" : "Confirm delivery"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isCoord(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

function openMaps(lat: number, lng: number) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function DriverNavCard({
  load,
  advance,
  openProof,
}: {
  load: LoadRow;
  advance: ReturnType<typeof useAdvanceLoad>;
  openProof: (load: LoadRow, nextStatus: string, kind: "pickup" | "delivery") => void;
}) {
  const driver = isCoord(load.driver_lat) && isCoord(load.driver_lng) ? { lat: Number(load.driver_lat), lng: Number(load.driver_lng) } : null;
  const pickup = isCoord(load.pickup_lat) && isCoord(load.pickup_lng) ? { lat: Number(load.pickup_lat), lng: Number(load.pickup_lng) } : null;
  const dropoff = isCoord(load.dropoff_lat) && isCoord(load.dropoff_lng) ? { lat: Number(load.dropoff_lat), lng: Number(load.dropoff_lng) } : null;

  // Accepted = still heading to pickup; otherwise heading to drop-off.
  const toPickup = load.status === "Accepted";
  const origin = driver ?? pickup;
  const target = toPickup ? pickup : dropoff;
  const road = useRoadRoute([origin, target], Boolean(origin && target));

  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    if (pickup) pts.push({ id: "pickup", lat: pickup.lat, lng: pickup.lng, kind: "pickup", label: "Pickup" });
    if (dropoff) pts.push({ id: "dropoff", lat: dropoff.lat, lng: dropoff.lng, kind: "dropoff", label: "Drop-off" });
    if (driver) pts.push({ id: "driver", lat: driver.lat, lng: driver.lng, kind: "driver", label: "You", selected: true });
    return pts;
  }, [pickup, dropoff, driver]);

  const routes = useMemo<MapRoute[]>(() => {
    const out: MapRoute[] = [];
    if (origin && target) out.push({ from: origin, to: target, path: road.data?.path ?? undefined });
    if (toPickup && pickup && dropoff) out.push({ from: pickup, to: dropoff, muted: true });
    return out;
  }, [origin, target, road.data, toPickup, pickup, dropoff]);

  const action = (() => {
    if (load.status === "Accepted") return { label: "Arrived at pickup — confirm & start", run: () => openProof(load, "EnRoute", "pickup") };
    if (load.status === "EnRoute") return { label: "Mark arrived at drop-off", run: () => void advance.mutateAsync({ id: load.id, status: "Arrived" }) };
    if (load.status === "Arrived") return { label: "Complete delivery", run: () => openProof(load, "Delivered", "delivery") };
    return null;
  })();

  const dest = target ?? dropoff ?? pickup;
  const stageText = toPickup ? "Navigate to pickup" : "Navigate to drop-off";
  const destText = toPickup ? (load.pickup_address || load.pickup_city || "Pickup point") : (load.dropoff_address || load.dropoff_city || "Drop-off point");

  return (
    <Card className="overflow-hidden border-primary/40">
      <div className="flex items-center gap-2 border-b border-white/5 bg-primary/10 px-4 py-3">
        <Navigation className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-semibold">{stageText}</p>
          <p className="truncate text-xs text-muted-foreground">{destText}</p>
        </div>
        <Badge>{loadStageLabel(load.status)}</Badge>
      </div>
      {points.length > 0 && <LoadsMap points={points} routes={routes} height={280} className="rounded-none border-x-0 border-t-0" />}
      <CardContent className="space-y-3 py-4">
        {road.data && (
          <p className="text-xs text-muted-foreground">
            {road.data.distanceKm.toFixed(1)} km · about {Math.round(road.data.durationMin)} min by road
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          {dest && (
            <Button variant="secondary" className="flex-1" onClick={() => openMaps(dest.lat, dest.lng)}>
              <Navigation className="mr-2 h-4 w-4" /> Open in Google Maps
            </Button>
          )}
          {action && (
            <Button className="flex-1" onClick={action.run} disabled={advance.isPending}>
              <Flag className="mr-2 h-4 w-4" /> {action.label}
            </Button>
          )}
        </div>

        {load.status === "Arrived" && load.recipient_phone && (
          <a
            href={`tel:${load.recipient_phone}`}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
          >
            <Phone className="h-4 w-4" /> Call receiver{load.recipient_name ? ` · ${load.recipient_name}` : ""}
          </a>
        )}
      </CardContent>
    </Card>
  );
}
