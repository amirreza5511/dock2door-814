import type { TruckOrientation } from "./TruckScene";

/**
 * Config for the real generated 3D truck model shown on the login page.
 * The model sits on a slow turntable, so it's treated as directionless
 * (no forced facing) and simply rotates in view.
 */
export const TRUCK_MODEL: { url: string; orientation: TruckOrientation } | null = {
  url: "https://r2-pub.rork.com/generated-3d-models/vaj7ce20dtfjwaoecptg3/55f3af6b-ad30-41b8-ac8c-e6e8127d58d5.glb",
  orientation: {
    hasIntrinsicFront: false,
    localFrontAxis: "positiveZ",
    localUpAxis: "positiveY",
  },
};
