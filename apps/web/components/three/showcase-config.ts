import type { GeneratedOrientation } from "./ShowcaseScene";

/**
 * Config for the real generated 3D models shown in the landing "Showcase" section.
 * The diorama slowly rotates on a turntable, so the models are treated as
 * directionless (no forced facing) and simply spin in view.
 */
export type ShowcaseModel = { url: string; orientation: GeneratedOrientation };

const DIRECTIONLESS: GeneratedOrientation = {
  hasIntrinsicFront: false,
  localFrontAxis: "positiveZ",
  localUpAxis: "positiveY",
};

export const SHOWCASE_TRUCK: ShowcaseModel | null = {
  url: "https://r2-pub.rork.com/generated-3d-models/vaj7ce20dtfjwaoecptg3/55f3af6b-ad30-41b8-ac8c-e6e8127d58d5.glb",
  orientation: DIRECTIONLESS,
};

export const SHOWCASE_CONTAINER: ShowcaseModel | null = {
  url: "https://r2-pub.rork.com/generated-3d-models/vaj7ce20dtfjwaoecptg3/fb70cb2c-9914-430d-ac04-ef766e69c863.glb",
  orientation: DIRECTIONLESS,
};
