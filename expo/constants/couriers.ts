import C from '@/constants/colors';

/**
 * Courier catalog for the Ship & Return section.
 *
 * Each courier derives an estimated price from the base parcel quote using a
 * simple multiplier + flat surcharge and a speed tier. These are clearly-labeled
 * ESTIMATES until real carrier credentials are active — at which point the same
 * UI surface can be fed by live rate-shopping without changing any screens.
 *
 * `live` mirrors the backend's supported/implemented carriers; when a courier's
 * credentials are entered and toggled on, its quotes flip from estimate to live.
 */
export interface CourierDef {
  code: string;
  name: string;
  short: string;
  color: string;
  /** Applied to the base chargeable price. */
  priceFactor: number;
  /** Flat surcharge added on top (in base currency, CAD). */
  surcharge: number;
  /** Estimated transit window. */
  etaDays: [number, number];
  /** Relative speed tier for the "fastest" badge (lower = faster). */
  speedRank: number;
  /** Whether the backend has an implemented adapter for this carrier. */
  implemented: boolean;
  /** Credentials this carrier requires (mirrors carriers.supported). */
  requires: string[];
  /** Aggregator (multi-carrier) vs direct integration. */
  mode: 'aggregator' | 'direct';
}

export const COURIERS: CourierDef[] = [
  { code: 'CANADA_POST', name: 'Canada Post', short: 'CP', color: '#D62828', priceFactor: 1.0, surcharge: 0, etaDays: [2, 6], speedRank: 5, implemented: true, requires: ['username', 'password', 'customer_number'], mode: 'direct' },
  { code: 'UPS', name: 'UPS', short: 'UPS', color: '#8B5E29', priceFactor: 1.18, surcharge: 3.5, etaDays: [1, 4], speedRank: 2, implemented: true, requires: ['client_id', 'client_secret', 'account_number'], mode: 'direct' },
  { code: 'FEDEX', name: 'FedEx', short: 'FDX', color: '#4D148C', priceFactor: 1.22, surcharge: 4.0, etaDays: [1, 3], speedRank: 1, implemented: true, requires: ['client_id', 'client_secret', 'account_number'], mode: 'direct' },
  { code: 'DHL', name: 'DHL Express', short: 'DHL', color: '#D40511', priceFactor: 1.35, surcharge: 5.0, etaDays: [1, 3], speedRank: 1, implemented: true, requires: ['username', 'password', 'account_number'], mode: 'direct' },
  { code: 'ARAMEX', name: 'Aramex', short: 'ARX', color: '#E4002B', priceFactor: 1.1, surcharge: 2.5, etaDays: [2, 5], speedRank: 3, implemented: false, requires: ['account_number', 'account_pin', 'username', 'password'], mode: 'direct' },
  { code: 'PUROLATOR', name: 'Purolator', short: 'PUR', color: '#652D86', priceFactor: 1.15, surcharge: 3.0, etaDays: [1, 4], speedRank: 2, implemented: false, requires: ['api_key', 'account_number'], mode: 'direct' },
  { code: 'USPS', name: 'USPS', short: 'USPS', color: '#004B87', priceFactor: 0.95, surcharge: 0, etaDays: [2, 7], speedRank: 5, implemented: false, requires: ['api_key'], mode: 'direct' },
  { code: 'GLS', name: 'GLS', short: 'GLS', color: '#061AB1', priceFactor: 1.05, surcharge: 1.5, etaDays: [2, 5], speedRank: 4, implemented: false, requires: ['api_key'], mode: 'direct' },
  { code: 'EASYPOST', name: 'EasyPost (multi)', short: 'EP', color: C.blue, priceFactor: 1.0, surcharge: 0, etaDays: [1, 6], speedRank: 3, implemented: true, requires: ['api_key'], mode: 'aggregator' },
  { code: 'SHIPPO', name: 'Shippo (multi)', short: 'SH', color: C.green, priceFactor: 1.0, surcharge: 0, etaDays: [1, 6], speedRank: 3, implemented: true, requires: ['api_key'], mode: 'aggregator' },
];

export const COURIER_MAP: Record<string, CourierDef> = COURIERS.reduce(
  (acc, c) => { acc[c.code] = c; return acc; },
  {} as Record<string, CourierDef>,
);

/** Service levels a customer can request (maps to parcel RPC service param). */
export const SERVICE_LEVELS: { value: 'regular' | 'expedited' | 'xpresspost' | 'priority'; label: string; sub: string }[] = [
  { value: 'regular', label: 'Standard', sub: 'Cheapest · ground' },
  { value: 'expedited', label: 'Expedited', sub: 'Faster ground' },
  { value: 'xpresspost', label: 'Express', sub: 'Air · 1-2 days' },
  { value: 'priority', label: 'Priority', sub: 'Fastest · next day' },
];

/** Common preset boxes so users don't have to measure. */
export const PRESET_BOXES: { key: string; label: string; sub: string; l: number; w: number; h: number; kg: number }[] = [
  { key: 'envelope', label: 'Envelope / Document', sub: '30 × 24 × 2 cm', l: 30, w: 24, h: 2, kg: 0.3 },
  { key: 'small', label: 'Small box', sub: '25 × 20 × 15 cm', l: 25, w: 20, h: 15, kg: 1 },
  { key: 'medium', label: 'Medium box', sub: '40 × 30 × 25 cm', l: 40, w: 30, h: 25, kg: 4 },
  { key: 'large', label: 'Large box', sub: '55 × 40 × 35 cm', l: 55, w: 40, h: 35, kg: 9 },
];

/** A derived per-courier estimate from a base chargeable price (CAD). */
export interface CourierQuote {
  courier: CourierDef;
  price: number;
  etaLabel: string;
  isLive: boolean;
}

/**
 * Derive per-courier quotes from the base placeholder chargeable price.
 * Only couriers that are active (have credentials) return "live"; the rest are
 * clearly-labeled estimates. Sorted cheapest first.
 */
export function deriveCourierQuotes(
  basePriceCad: number,
  activeCodes: Set<string>,
  fx: number = 1,
  currency: string = 'CAD',
): CourierQuote[] {
  return COURIERS.map((c) => {
    const priceCad = basePriceCad * c.priceFactor + c.surcharge;
    return {
      courier: c,
      price: Math.round(priceCad * fx * 100) / 100,
      etaLabel: c.etaDays[0] === c.etaDays[1] ? `${c.etaDays[0]} day` : `${c.etaDays[0]}-${c.etaDays[1]} days`,
      isLive: activeCodes.has(c.code),
    };
  }).sort((a, b) => a.price - b.price);
}

/** Static FX from CAD (matches the placeholder rating in migration 0164). */
export const FX_FROM_CAD: Record<string, number> = {
  CAD: 1, USD: 0.73, EUR: 0.68, GBP: 0.58, AED: 2.68, CNY: 5.25,
};
