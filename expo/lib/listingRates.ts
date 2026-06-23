/**
 * Provider-defined add-on rates for a warehouse listing.
 *
 * The backend `warehouse_listings` table has no dedicated columns for these
 * rates, so we persist them inside the existing free-text `notes` field using a
 * delimited, machine-readable block. The block is stripped before the notes are
 * shown to customers, and parsed back into structured rates when booking.
 */
export interface ListingRates {
  /** Offload fee for a 20' container (per unit). */
  c20: number;
  /** Offload fee for a 40' container (per unit). */
  c40: number;
  /** Offload fee for a 5-ton truck (per unit). */
  t5: number;
  /** Flat gate fee per booking. */
  gate: number;
  /** Labour rate per hour. */
  labour: number;
  /** Flat special unload / load handling fee. */
  special: number;
}

/** Sensible platform defaults used when a provider hasn't set custom rates. */
export const DEFAULT_RATES: ListingRates = {
  c20: 250,
  c40: 400,
  t5: 150,
  gate: 45,
  labour: 38,
  special: 120,
};

const START = '[[D2D_RATES]]';
const END = '[[/D2D_RATES]]';
const BLOCK_RE = /\[\[D2D_RATES\]\][\s\S]*?\[\[\/D2D_RATES\]\]/;

function toNum(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Splits a listing's stored notes into the customer-facing text and the
 * provider-defined rates encoded within it.
 */
export function parseListingRates(notes: string | null | undefined): {
  rates: ListingRates;
  displayNotes: string;
} {
  const raw = notes ?? '';
  const match = raw.match(BLOCK_RE);
  if (!match) return { rates: { ...DEFAULT_RATES }, displayNotes: raw.trim() };

  const inner = match[0].slice(START.length, match[0].length - END.length).trim();
  let parsed: Partial<ListingRates> = {};
  try {
    parsed = JSON.parse(inner) as Partial<ListingRates>;
  } catch {
    parsed = {};
  }
  const rates: ListingRates = {
    c20: toNum(parsed.c20, DEFAULT_RATES.c20),
    c40: toNum(parsed.c40, DEFAULT_RATES.c40),
    t5: toNum(parsed.t5, DEFAULT_RATES.t5),
    gate: toNum(parsed.gate, DEFAULT_RATES.gate),
    labour: toNum(parsed.labour, DEFAULT_RATES.labour),
    special: toNum(parsed.special, DEFAULT_RATES.special),
  };
  const displayNotes = raw.replace(BLOCK_RE, '').trim();
  return { rates, displayNotes };
}

/**
 * Embeds provider-defined rates into the listing notes for storage. Any existing
 * rates block is replaced. The visible notes always come first.
 */
export function encodeListingRates(displayNotes: string, rates: ListingRates): string {
  const clean = (displayNotes ?? '').replace(BLOCK_RE, '').trim();
  const block = `${START}${JSON.stringify(rates)}${END}`;
  return clean ? `${clean}\n\n${block}` : block;
}
