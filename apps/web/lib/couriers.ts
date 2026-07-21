/**
 * Client-safe courier catalog for the public web Ship & Return pages.
 * Mirrors the mobile app's expo/constants/couriers.ts. Estimate-only on web —
 * real labels are created in the app after sign-in.
 */

export interface CourierDef {
  code: string;
  name: string;
  short: string;
  color: string;
  priceFactor: number;
  surcharge: number;
  etaDays: [number, number];
  speedRank: number;
  implemented: boolean;
  mode: "aggregator" | "direct";
}

export const COURIERS: CourierDef[] = [
  { code: "CANADA_POST", name: "Canada Post", short: "CP", color: "#D62828", priceFactor: 1.0, surcharge: 0, etaDays: [2, 6], speedRank: 5, implemented: true, mode: "direct" },
  { code: "UPS", name: "UPS", short: "UPS", color: "#8B5E29", priceFactor: 1.18, surcharge: 3.5, etaDays: [1, 4], speedRank: 2, implemented: true, mode: "direct" },
  { code: "FEDEX", name: "FedEx", short: "FDX", color: "#4D148C", priceFactor: 1.22, surcharge: 4.0, etaDays: [1, 3], speedRank: 1, implemented: true, mode: "direct" },
  { code: "DHL", name: "DHL Express", short: "DHL", color: "#D40511", priceFactor: 1.35, surcharge: 5.0, etaDays: [1, 3], speedRank: 1, implemented: true, mode: "direct" },
  { code: "ARAMEX", name: "Aramex", short: "ARX", color: "#E4002B", priceFactor: 1.1, surcharge: 2.5, etaDays: [2, 5], speedRank: 3, implemented: false, mode: "direct" },
  { code: "PUROLATOR", name: "Purolator", short: "PUR", color: "#652D86", priceFactor: 1.15, surcharge: 3.0, etaDays: [1, 4], speedRank: 2, implemented: false, mode: "direct" },
  { code: "USPS", name: "USPS", short: "USPS", color: "#004B87", priceFactor: 0.95, surcharge: 0, etaDays: [2, 7], speedRank: 5, implemented: false, mode: "direct" },
  { code: "GLS", name: "GLS", short: "GLS", color: "#061AB1", priceFactor: 1.05, surcharge: 1.5, etaDays: [2, 5], speedRank: 4, implemented: false, mode: "direct" },
  { code: "EASYPOST", name: "EasyPost (multi)", short: "EP", color: "#2563eb", priceFactor: 1.0, surcharge: 0, etaDays: [1, 6], speedRank: 3, implemented: true, mode: "aggregator" },
  { code: "SHIPPO", name: "Shippo (multi)", short: "SH", color: "#10b981", priceFactor: 1.0, surcharge: 0, etaDays: [1, 6], speedRank: 3, implemented: true, mode: "aggregator" },
];

export const SERVICE_LEVELS: { value: "regular" | "expedited" | "xpresspost" | "priority"; label: string; sub: string }[] = [
  { value: "regular", label: "Standard", sub: "Cheapest · ground" },
  { value: "expedited", label: "Expedited", sub: "Faster ground" },
  { value: "xpresspost", label: "Express", sub: "Air · 1-2 days" },
  { value: "priority", label: "Priority", sub: "Fastest · next day" },
];

export const PRESET_BOXES: { key: string; label: string; sub: string; l: number; w: number; h: number; kg: number }[] = [
  { key: "envelope", label: "Envelope / Document", sub: "30 × 24 × 2 cm", l: 30, w: 24, h: 2, kg: 0.3 },
  { key: "small", label: "Small box", sub: "25 × 20 × 15 cm", l: 25, w: 20, h: 15, kg: 1 },
  { key: "medium", label: "Medium box", sub: "40 × 30 × 25 cm", l: 40, w: 30, h: 25, kg: 4 },
  { key: "large", label: "Large box", sub: "55 × 40 × 35 cm", l: 55, w: 40, h: 35, kg: 9 },
];

export interface CourierQuote {
  courier: CourierDef;
  price: number;
  etaLabel: string;
}

/**
 * Estimate a base chargeable price (CAD) from parcel dims + weight, mirroring
 * the placeholder rating in migration 0164. Volumetric weight vs actual weight.
 */
export function estimateBasePriceCad(
  lengthCm: number, widthCm: number, heightCm: number, weightKg: number,
  service: string,
): number {
  const volumetric = (lengthCm * widthCm * heightCm) / 5000; // kg
  const chargeable = Math.max(weightKg, volumetric, 0.1);
  const serviceMult = service === "priority" ? 1.9 : service === "xpresspost" ? 1.5 : service === "expedited" ? 1.2 : 1;
  const base = 8 + chargeable * 3.25; // flat + per-kg (CAD)
  return Math.round(base * serviceMult * 100) / 100;
}

export function deriveCourierQuotes(basePriceCad: number): CourierQuote[] {
  return COURIERS.map((c) => ({
    courier: c,
    price: Math.round((basePriceCad * c.priceFactor + c.surcharge) * 100) / 100,
    etaLabel: c.etaDays[0] === c.etaDays[1] ? `${c.etaDays[0]} day` : `${c.etaDays[0]}-${c.etaDays[1]} days`,
  })).sort((a, b) => a.price - b.price);
}
