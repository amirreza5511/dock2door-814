import * as Location from 'expo-location';

export interface Coords {
  latitude: number;
  longitude: number;
}

/** Default allowed distance (meters) between the worker and the shift site. */
export const SITE_RADIUS_METERS = 350;

/** Great-circle distance between two coordinates, in meters. */
export function haversineMeters(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Request foreground permission and return the device's current coordinates.
 * Throws a user-friendly error if permission is denied or the fix fails.
 */
export async function getCurrentCoords(): Promise<Coords> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission is required to clock in. Enable it in Settings and try again.');
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

/**
 * Resolve a street address to coordinates. Returns null when geocoding is
 * unavailable (e.g. on web) or the address can't be resolved.
 */
export async function geocodeAddress(address: string): Promise<Coords | null> {
  try {
    const results = await Location.geocodeAsync(address);
    const first = results[0];
    if (!first) return null;
    return { latitude: first.latitude, longitude: first.longitude };
  } catch {
    return null;
  }
}

export interface SiteCheckResult {
  /** Whether the worker is within range (or the site couldn't be resolved). */
  withinRange: boolean;
  /** Distance to the site in meters, when both points are known. */
  distanceMeters: number | null;
  /** The worker's captured coordinates. */
  coords: Coords;
}

/**
 * Verify the worker is physically near the shift location before clocking in.
 * If the site address can't be geocoded, the check passes (we still capture
 * the worker's coordinates) so workers are never blocked by a bad address.
 */
export async function checkAtSite(
  siteAddress: string,
  radiusMeters: number = SITE_RADIUS_METERS,
): Promise<SiteCheckResult> {
  const coords = await getCurrentCoords();
  const site = await geocodeAddress(siteAddress);
  if (!site) {
    return { withinRange: true, distanceMeters: null, coords };
  }
  const distanceMeters = haversineMeters(coords, site);
  return { withinRange: distanceMeters <= radiusMeters, distanceMeters, coords };
}
