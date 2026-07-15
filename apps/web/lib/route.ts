"use client";

import { useQuery } from "@tanstack/react-query";

export type LatLng = { lat: number; lng: number };

/** A road-following route: the decoded polyline plus distance/duration. */
export interface RoadRoute {
  path: LatLng[];
  distanceKm: number;
  durationMin: number;
}

function isFinitePair(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    !(p.lat === 0 && p.lng === 0)
  );
}

/**
 * Fetch a driving route that follows real roads between an ordered list of
 * waypoints using the public OSRM router. Returns the full geometry as an
 * array of {lat,lng} points so it can be drawn as a polyline on the map.
 * Falls back to null on any failure so callers can degrade to a straight line.
 */
export async function fetchRoadRoute(waypoints: LatLng[], signal?: AbortSignal): Promise<RoadRoute | null> {
  const pts = waypoints.filter(isFinitePair);
  if (pts.length < 2) return null;

  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code?: string;
      routes?: { geometry?: { coordinates?: [number, number][] }; distance?: number; duration?: number }[];
    };
    if (json.code !== "Ok" || !json.routes || json.routes.length === 0) return null;
    const route = json.routes[0];
    const coordinates = route.geometry?.coordinates ?? [];
    if (coordinates.length < 2) return null;
    const path: LatLng[] = coordinates.map(([lng, lat]) => ({ lat, lng }));
    return {
      path,
      distanceKm: (route.distance ?? 0) / 1000,
      durationMin: (route.duration ?? 0) / 60,
    };
  } catch {
    return null;
  }
}

/** Build a stable cache key from waypoints rounded to ~11m precision. */
function keyOf(waypoints: (LatLng | null | undefined)[]): string {
  return waypoints
    .map((p) => (isFinitePair(p) ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : "x"))
    .join("|");
}

/**
 * React Query hook returning a cached road-following route between waypoints.
 * Any null/zero waypoint disables the query. Cached for 5 minutes since the
 * road geometry between two fixed points does not change.
 */
export function useRoadRoute(waypoints: (LatLng | null | undefined)[], enabled = true) {
  const clean = waypoints.filter(isFinitePair);
  const canRun = enabled && clean.length >= 2;
  return useQuery<RoadRoute | null>({
    queryKey: ["road-route", keyOf(waypoints)],
    queryFn: ({ signal }) => fetchRoadRoute(clean, signal),
    enabled: canRun,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
}
