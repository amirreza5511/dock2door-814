import type { FreightMode } from "@/lib/global-freight";

/**
 * LTL & FTL Quotes (ground freight world) — web mirror of
 * `expo/constants/groundFreight.ts`. Reuses the existing freight quote/offer
 * engine; ground load types map onto the engine's freight_mode values
 * (LTL/FTL → truck/fcl, LCL → lcl).
 */

export type CoverageArea = "local" | "canada" | "international";

export const COVERAGE_AREAS: { value: CoverageArea; label: string; sublabel: string }[] = [
  { value: "local", label: "Local", sublabel: "Within one city / metro" },
  { value: "canada", label: "Across Canada", sublabel: "Between Canadian cities" },
  { value: "international", label: "International", sublabel: "Cross-border, door delivery" },
];

export const COVERAGE_LABEL: Record<CoverageArea, string> = {
  local: "Local",
  canada: "Across Canada",
  international: "International",
};

/** Ground load type — the truck-focused product the customer is buying. */
export type LoadType = "ltl" | "ftl" | "lcl";

export interface LoadTypeDef {
  value: LoadType;
  label: string;
  short: string;
  sublabel: string;
  /** How this maps onto the shared freight engine's freight_mode. */
  freightMode: FreightMode;
}

export const LOAD_TYPES: LoadTypeDef[] = [
  { value: "ltl", label: "LTL — part load", short: "LTL", sublabel: "A few pallets, share the truck", freightMode: "truck" },
  { value: "ftl", label: "FTL — full truck", short: "FTL", sublabel: "A whole truck to yourself", freightMode: "fcl" },
  { value: "lcl", label: "LCL — shared container", short: "LCL", sublabel: "Share container space by volume", freightMode: "lcl" },
];

export const LOAD_TYPE_MAP: Record<LoadType, LoadTypeDef> = LOAD_TYPES.reduce(
  (acc, l) => { acc[l.value] = l; return acc; },
  {} as Record<LoadType, LoadTypeDef>,
);

/** Freight modes that belong to the ground world (used to filter the board). */
export const GROUND_FREIGHT_MODES: FreightMode[] = ["truck", "fcl", "lcl"];

export interface GroundEstimate {
  low: number;
  high: number;
  currency: string;
}

/** Base price band per load type (CAD, one-way, before coverage/weight factors). */
const BASE_BY_TYPE: Record<LoadType, number> = {
  ltl: 240,
  ftl: 900,
  lcl: 320,
};

/** Coverage multiplier — longer, more complex lanes cost more. */
const COVERAGE_FACTOR: Record<CoverageArea, number> = {
  local: 1,
  canada: 2.1,
  international: 3.4,
};

/**
 * Produce a rough ballpark price range for a ground load. Intentionally a
 * heuristic (no live carrier data): base band × coverage × weight/pallet, with
 * an optional final-mile add-on. Returns a ±18% low/high band.
 */
export function estimateGroundLoad(params: {
  loadType: LoadType;
  coverage: CoverageArea;
  weightKg: number;
  pallets: number;
  finalMile: boolean;
}): GroundEstimate {
  const { loadType, coverage, weightKg, pallets, finalMile } = params;
  const base = BASE_BY_TYPE[loadType];
  const coverageFactor = COVERAGE_FACTOR[coverage];

  // Weight/volume factor — FTL is flat-ish, LTL/LCL scale with size.
  let sizeFactor = 1;
  if (loadType === "ftl") {
    sizeFactor = 1 + Math.min(weightKg, 24000) / 60000;
  } else {
    const palletPart = Math.max(pallets, 1) * 55;
    const weightPart = Math.min(weightKg, 12000) * 0.06;
    sizeFactor = 1 + (palletPart + weightPart) / base;
  }

  const finalMileAdd = finalMile ? (coverage === "local" ? 45 : 120) : 0;
  const mid = base * coverageFactor * sizeFactor + finalMileAdd;

  const low = Math.max(Math.round((mid * 0.82) / 5) * 5, 50);
  const high = Math.round((mid * 1.18) / 5) * 5;
  return { low, high, currency: "CAD" };
}
