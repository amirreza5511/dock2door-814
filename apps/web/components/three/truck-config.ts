import type { TruckOrientation } from "./TruckScene";

/**
 * Config for the real generated 3D truck model shown on the login page.
 * Populated once the Meshy generation finishes (GLB URL + orientation metadata).
 * Kept as `null` when unavailable so the login page falls back to the photo hero.
 */
export const TRUCK_MODEL: { url: string; orientation: TruckOrientation } | null = null;
