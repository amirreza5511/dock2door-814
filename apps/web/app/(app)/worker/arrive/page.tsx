"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, LocateFixed, MapPin, Navigation } from "lucide-react";

const SITE_RADIUS_METERS = 350;

interface Coords {
  latitude: number;
  longitude: number;
}

function haversineMeters(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function geocodeAddress(address: string): Promise<Coords | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat: string; lon: string }[];
    const first = rows[0];
    if (!first) return null;
    return { latitude: Number(first.lat), longitude: Number(first.lon) };
  } catch {
    return null;
  }
}

function distanceLabel(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

type Status = "loading" | "ready" | "denied" | "noSite";

export default function WorkerArrivePage() {
  const router = useRouter();
  const params = useSearchParams();
  const address = params.get("address") ?? "";
  const city = params.get("city") ?? "";
  const title = params.get("title") ?? "";

  const siteLabel = useMemo(() => [address, city].filter(Boolean).join(", "), [address, city]);

  const [site, setSite] = useState<Coords | null>(null);
  const [me, setMe] = useState<Coords | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    let watchId: number | null = null;

    (async () => {
      const resolved = siteLabel ? await geocodeAddress(siteLabel) : null;
      if (cancelled) return;
      if (!resolved) {
        setStatus("noSite");
        return;
      }
      setSite(resolved);

      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setStatus("denied");
        return;
      }
      setStatus("ready");
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!cancelled) setMe({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        },
        () => {
          if (!cancelled) setStatus("denied");
        },
        { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 },
      );
    })();

    return () => {
      cancelled = true;
      if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    };
  }, [siteLabel]);

  const distance = useMemo(() => (site && me ? haversineMeters(me, site) : null), [site, me]);
  const arrived = distance != null && distance <= SITE_RADIUS_METERS;

  const openDirections = useCallback(() => {
    window.open(`https://maps.google.com/?q=${encodeURIComponent(siteLabel)}`, "_blank", "noopener,noreferrer");
  }, [siteLabel]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title || "Arrive at site"}</h1>
        <p className="text-sm text-muted-foreground">{siteLabel || "Job location"}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live check-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <LocateFixed className="h-8 w-8 animate-pulse text-primary" />
              <p className="text-sm text-muted-foreground">Locating the job site…</p>
            </div>
          )}

          {status === "noSite" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <MapPin className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">We couldn&apos;t map this address.</p>
              <Button className="gap-2" onClick={openDirections}>
                <Navigation className="h-4 w-4" /> Open in Maps
              </Button>
            </div>
          )}

          {status === "denied" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <LocateFixed className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Location access is off. Enable it in your browser to confirm you&apos;re on site.
              </p>
              <Button className="gap-2" variant="outline" onClick={openDirections}>
                <Navigation className="h-4 w-4" /> Directions
              </Button>
            </div>
          )}

          {status === "ready" && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div
                className={`grid h-24 w-24 place-items-center rounded-full border-2 ${
                  arrived ? "border-emerald-500 bg-emerald-500/10" : "border-primary bg-primary/10"
                }`}
              >
                <MapPin className={`h-8 w-8 ${arrived ? "text-emerald-500" : "text-primary"}`} />
              </div>
              <p className="text-sm text-muted-foreground">
                {distance != null ? `${distanceLabel(distance)} from the site` : "Getting your position…"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {status === "ready" && (
        <Card className={arrived ? "border-emerald-500/40 bg-emerald-500/5" : undefined}>
          <CardContent className="flex items-center gap-3 py-4">
            {arrived ? (
              <>
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500">
                  <CheckCircle2 className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-emerald-600">You&apos;ve arrived</p>
                  <p className="text-sm text-muted-foreground">
                    You&apos;re at the job site. Head to My shifts to clock in from the mobile app.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15">
                  <Navigation className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {distance != null ? `${distanceLabel(distance)} away` : "Tracking your location…"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Get within {SITE_RADIUS_METERS} m of the site to check in.
                  </p>
                </div>
                <Button size="sm" variant="outline" className="gap-1" onClick={openDirections}>
                  <Navigation className="h-4 w-4" /> Directions
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Button variant="ghost" onClick={() => router.push("/worker/shifts")}>← Back to my shifts</Button>
    </div>
  );
}
