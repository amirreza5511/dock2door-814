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
  /** Short caption/subtitle shown at the bottom while this clip plays. */
  caption?: string;
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
  /** Advertiser website shown as a call-to-action on the ad card (optional). */
  website?: string;
  /** Full-bleed background image behind the gradient (optional). */
  image?: string;
};

export type PromoScene = PromoVideoScene | PromoAdScene;

/** Primary brand clip (AI-generated). */
export const PROMO_VIDEO_URL: string | null =
  'https://r2-pub.rork.com/generated-video/vaj7ce20dtfjwaoecptg3/9eb04496-dc11-4432-b884-df1d5d158e79.mp4';

/** Second brand clip (AI-generated) — chained after the first to lengthen the intro. */
export const PROMO_VIDEO_URL_2: string | null =
  'https://r2-pub.rork.com/generated-video/vaj7ce20dtfjwaoecptg3/2d74c88c-087f-4e2d-acf7-e7a80cc002f6.mp4';

/** Third brand clip (AI-generated) — parcel / ship & return theme. */
export const PROMO_VIDEO_URL_3: string | null =
  'https://r2-pub.rork.com/generated-video/vaj7ce20dtfjwaoecptg3/3a4b9897-09a4-40f6-8838-0cb938e307d2.mp4';

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
      {
        kind: 'video',
        url: PROMO_VIDEO_URL,
        maxMs: 16000,
        tagline: !PROMO_VIDEO_URL_2 && !PROMO_VIDEO_URL_3,
        caption: 'Trucks · Warehousing · Freight',
      },
      ...(PROMO_VIDEO_URL_2
        ? [{
            kind: 'video' as const,
            url: PROMO_VIDEO_URL_2,
            maxMs: 16000,
            tagline: !PROMO_VIDEO_URL_3,
            caption: 'One network — port, road & air',
          }]
        : []),
      ...(PROMO_VIDEO_URL_3
        ? [{
            kind: 'video' as const,
            url: PROMO_VIDEO_URL_3,
            maxMs: 16000,
            tagline: true,
            caption: 'Ship & Return — parcels to your door',
          }]
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
        durationMs: 5500,
        badge: 'Sponsor',
        title: 'Pars Freight Ways',
        subtitle: 'Over 1M sq ft of food-grade warehousing, a fleet of 120 trucks, freight forwarding & drayage across Canada.',
        colors: ['#10243A', '#08111E'],
        sponsored: true,
        website: 'parsfreight.ca',
        image: 'https://r2-pub.rork.com/projects/vaj7ce20dtfjwaoecptg3/assets/e48c412f-fbc6-46ed-bc47-9130ed7ea54e.png',
      },
      {
        kind: 'ad',
        durationMs: 5500,
        badge: 'Sponsor',
        title: 'CIFFA',
        subtitle: 'Canadian International Freight Forwarders Association — 300+ member firms, training, certification & industry advocacy.',
        colors: ['#0B2A2E', '#08111E'],
        sponsored: true,
        website: 'ciffa.com',
        image: 'https://r2-pub.rork.com/projects/vaj7ce20dtfjwaoecptg3/assets/fc5fefad-769d-4a67-ac10-6e3ac481bec3.png',
      },
      {
        kind: 'ad',
        durationMs: 5500,
        badge: 'Sponsor',
        title: 'Paige Logistics',
        subtitle: 'Award-winning Canadian 3PL — freight forwarding, trucking, intermodal & warehousing across Canada and the USA.',
        colors: ['#1A2436', '#08111E'],
        sponsored: true,
        website: 'paigelogistics.com',
        image: 'https://r2-pub.rork.com/projects/vaj7ce20dtfjwaoecptg3/assets/8b246f20-b2bb-49ea-9a5a-cf473737c79a.png',
      },
      {
        kind: 'ad',
        durationMs: 5000,
        badge: 'Your space',
        title: 'Your ad could be here',
        subtitle: 'Reach thousands of shippers, carriers & forwarders. Feature your company in the Dock2Door intro.',
        colors: ['#12253D', '#08111E'],
        sponsored: true,
        website: 'Contact us to advertise',
        image: 'https://r2-pub.rork.com/projects/vaj7ce20dtfjwaoecptg3/assets/6f1b2020-ac77-46e8-b6f4-fbbba35ea9fe.png',
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
