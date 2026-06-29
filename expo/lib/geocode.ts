/**
 * Lightweight cross-platform geocoding using the free OpenStreetMap Nominatim
 * service. Works on web and native via `fetch` (no API key required).
 *
 * Note: Nominatim is rate-limited and intended for low-volume use. For each
 * lookup we request a single best match.
 */

export type GeocodeResult = { lat: number; lng: number; label: string };

const BASE = 'https://nominatim.openstreetmap.org';

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
