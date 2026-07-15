/**
 * Lightweight cross-platform geocoding using the free OpenStreetMap Nominatim
 * service. Works on web and native via `fetch` (no API key required).
 *
 * Note: Nominatim is rate-limited and intended for low-volume use. For each
 * lookup we request a single best match.
 */

export type GeocodeResult = { lat: number; lng: number; label: string };
export type AddressSuggestion = { id: string; lat: number; lng: number; label: string };
export type RouteResult = { coordinates: { lat: number; lng: number }[]; distanceKm: number; durationMin: number };

const BASE = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';

/** Forward-geocode a free-text address into coordinates. Returns null if not found. */
export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (q.length < 3) return null;
  const url = `${BASE}/search?format=json&addressdetails=0&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const top = data[0];
  const lat = parseFloat(top.lat);
  const lng = parseFloat(top.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: top.display_name };
}

/**
 * Autocomplete free-text address input into a list of candidate matches.
 * Global scope, best-effort. Returns an empty array on failure or short queries.
 */
export async function autocompleteAddress(query: string, limit: number = 6): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const url = `${BASE}/search?format=json&addressdetails=0&limit=${limit}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ place_id?: number | string; lat: string; lon: string; display_name: string }>;
    if (!Array.isArray(data)) return [];
    return data
      .map((d, i): AddressSuggestion | null => {
        const lat = parseFloat(d.lat);
        const lng = parseFloat(d.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { id: String(d.place_id ?? `${lat},${lng},${i}`), lat, lng, label: d.display_name };
      })
      .filter((x): x is AddressSuggestion => x !== null);
  } catch {
    return [];
  }
}

/**
 * Fetch a driving route that follows real roads between two points.
 * Returns polyline coordinates plus true driving distance/time.
 * Returns null on failure so callers can fall back to a straight line.
 */
export async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<RouteResult | null> {
  try {
    const url = `${OSRM}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const route = data.routes?.[0];
    if (!route || data.code !== 'Ok') return null;
    const coordinates = (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
    if (coordinates.length === 0) return null;
    return {
      coordinates,
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.round(route.duration / 60),
    };
  } catch {
    return null;
  }
}

/** Reverse-geocode coordinates into a human-readable address. Returns null on failure. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `${BASE}/reverse?format=json&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name ?? null;
  } catch {
    return null;
  }
}
