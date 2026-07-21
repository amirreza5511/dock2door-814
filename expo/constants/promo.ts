/**
 * Launch intro shown on first app open (and when replayed from settings).
 *
 * The intro is a *sequence* of scenes: branded video clips interleaved with
 * lightweight "ad slots" (full-screen promo cards). This keeps the intro longer
 * (~30s) and leaves obvious, easy-to-swap places for promotions / sponsors.
 *
 * To add a real sponsor clip later, drop another `{ kind: 'video', url }` scene
 * in — or swap an ad slot's copy/colors. Everything is data-driven here.
 */

/** A single branded video clip. */
export type PromoVideoScene = {
  kind: 'video';
  url: string;
  /** Hard fallback in case the clip never fires its end event (stuck video guard). */
  maxMs?: number;
  /** Show the brand tagline overlay for the final stretch of this clip. */
  tagline?: boolean;
};

/** A full-screen promo / ad card shown between clips. */
export type PromoAdScene = {
  kind: 'ad';
  durationMs: number;
  title: string;
  subtitle: string;
  badge?: string;
  /** Two-stop background gradient. */
  colors: readonly [string, string];
  /** Small "Ad" / "Sponsored" tag in the corner (optional). */
  sponsored?: boolean;
};

export type PromoScene = PromoVideoScene | PromoAdScene;

/** Primary brand clip (AI-generated). */
export const PROMO_VIDEO_URL: string | null =
  'https://r2-pub.rork.com/generated-video/vaj7ce20dtfjwaoecptg3/9eb04496-dc11-4432-b884-df1d5d158e79.mp4';

/** Second brand clip (AI-generated) — chained after the first to lengthen the intro. */
export const PROMO_VIDEO_URL_2: string | null =
  'https://r2-pub.rork.com/generated-video/vaj7ce20dtfjwaoecptg3/2d74c88c-087f-4e2d-acf7-e7a80cc002f6.mp4';

/** Background music played over the whole intro (muted video + this track). */
export const PROMO_MUSIC_URL: string | null =
  'https://r2-pub.rork.com/generated-audio/vaj7ce20dtfjwaoecptg3/7a3bceb0-a687-42ad-9b0c-5df5c90355c7.mp3';

/** Tagline overlaid near the end of the brand clip. */
export const PROMO_TAGLINE = 'All you need';
export const PROMO_SUBLINE = 'Trucks · Warehousing · Freight · Cargo · Couriers';

/**
 * Ordered intro sequence. Ad slots use plain gradients + copy so the intro is
 * long and fully functional today with zero extra assets; replace copy/colors
 * (or swap in real sponsor clips) whenever you like.
 */
export const PROMO_SCENES: readonly PromoScene[] = PROMO_VIDEO_URL
  ? [
      { kind: 'video', url: PROMO_VIDEO_URL, maxMs: 16000, tagline: !PROMO_VIDEO_URL_2 },
      ...(PROMO_VIDEO_URL_2
        ? [{ kind: 'video' as const, url: PROMO_VIDEO_URL_2, maxMs: 16000, tagline: true }]
        : []),
      {
        kind: 'ad',
        durationMs: 5500,
        badge: 'NEW',
        title: 'Ship & Return',
        subtitle: 'Send any parcel or start a return — compare every courier, print a label, drop off or book a pickup.',
        colors: ['#0D1E35', '#08111E'],
      },
      {
        kind: 'ad',
        durationMs: 5000,
        badge: 'Your space',
        title: 'Promote here',
        subtitle: 'This slot is reserved for featured partners and promotions.',
        colors: ['#12253D', '#08111E'],
        sponsored: true,
      },
      {
        kind: 'ad',
        durationMs: 4500,
        title: 'Dock2Door',
        subtitle: 'One app for labour, logistics, freight, drayage, marketplace and couriers.',
        colors: ['#1A2A1E', '#08111E'],
      },
    ]
  : [];
