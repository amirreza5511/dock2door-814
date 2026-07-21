import type { FreightMode } from '@/constants/globalFreight';

/**
 * Canadian city hub network. These are the destination hubs where inbound
 * freight (ocean LCL/FCL, air, truck, drayage) is received, deconsolidated and
 * dispatched for final-mile delivery.
 *
 * `isMember` marks hubs operated by partners who joined our network — these are
 * prioritised (sorted first, badged) now, and will get live capacity/pricing in
 * the future. Non-member hubs stay selectable as coverage cities.
 */
export interface CanadaHub {
  id: string;
  city: string;
  province: string;
  /** Nearest seaport code (from world.ts SEAPORTS) if the city is ocean-served. */
  seaportCode?: string;
  /** Nearest air-cargo airport code (from world.ts AIRPORTS). */
  airportCode?: string;
  /** Freight modes this hub can receive & hand off to final-mile. */
  modes: FreightMode[];
  /** Partner-operated hub in our network — static fallback / seed priority. */
  isMember: boolean;
  /** Metro-area city names (lowercase) that map to this hub for live matching. */
  aliases: string[];
  /** Short line describing the facility / coverage. */
  blurb: string;
}

/** All modes served by an inland hub with no local port. */
const INLAND: FreightMode[] = ['air', 'truck', 'fcl', 'lcl'];
/** Coastal / river-port hubs additionally serve ocean directly. */
const COASTAL: FreightMode[] = ['ocean', 'air', 'truck', 'fcl', 'lcl'];

export const CANADA_HUBS: CanadaHub[] = [
  {
    id: 'yyz-toronto', city: 'Toronto', province: 'ON',
    airportCode: 'YYZ', modes: INLAND, isMember: true,
    aliases: ['toronto', 'gta', 'mississauga', 'brampton', 'markham', 'scarborough', 'etobicoke', 'vaughan', 'north york', 'concord'],
    blurb: 'GTA gateway — largest inland deconsolidation & last-mile coverage.',
  },
  {
    id: 'yvr-vancouver', city: 'Vancouver', province: 'BC',
    seaportCode: 'CAVAN', airportCode: 'YVR', modes: COASTAL, isMember: true,
    aliases: ['vancouver', 'van', 'burnaby', 'richmond', 'surrey', 'delta', 'coquitlam', 'port moody', 'langley', 'new westminster', 'north vancouver', 'port coquitlam'],
    blurb: 'Pacific port hub — ocean LCL/FCL landing & West-coast distribution.',
  },
  {
    id: 'yul-montreal', city: 'Montreal', province: 'QC',
    seaportCode: 'CAMTR', airportCode: 'YUL', modes: COASTAL, isMember: true,
    aliases: ['montreal', 'montréal', 'laval', 'longueuil', 'dorval', 'lachine'],
    blurb: 'St. Lawrence port + air gateway for Quebec & Eastern Canada.',
  },
  {
    id: 'yyc-calgary', city: 'Calgary', province: 'AB',
    modes: INLAND, isMember: false,
    aliases: ['calgary', 'airdrie'],
    blurb: 'Prairie distribution hub for Alberta & the West.',
  },
  {
    id: 'yeg-edmonton', city: 'Edmonton', province: 'AB',
    modes: INLAND, isMember: false,
    aliases: ['edmonton', 'nisku', 'leduc', 'sherwood park'],
    blurb: 'Northern Alberta gateway & industrial freight coverage.',
  },
  {
    id: 'ywg-winnipeg', city: 'Winnipeg', province: 'MB',
    modes: INLAND, isMember: false,
    aliases: ['winnipeg'],
    blurb: 'Central Canada crossroads — rail & road consolidation.',
  },
  {
    id: 'yow-ottawa', city: 'Ottawa', province: 'ON',
    modes: INLAND, isMember: false,
    aliases: ['ottawa', 'gatineau', 'kanata', 'nepean'],
    blurb: 'National capital region delivery coverage.',
  },
  {
    id: 'yhz-halifax', city: 'Halifax', province: 'NS',
    seaportCode: 'CAHAL', modes: COASTAL, isMember: false,
    aliases: ['halifax', 'dartmouth'],
    blurb: 'Atlantic port hub — first inbound call for Europe/Asia via Suez.',
  },
];

/** A live network-hub city + how many warehouses back it (from the DB). */
export interface LiveHubCity {
  city: string;
  hub_count: number;
}

/**
 * Decide whether a hub is a live partner, using real network-hub warehouse
 * cities from the DB. Falls back to the static `isMember` seed when no live
 * data is available (guest / offline).
 */
export function isHubLiveMember(hub: CanadaHub, liveCities: LiveHubCity[]): boolean {
  if (liveCities.length === 0) return hub.isMember;
  return liveCities.some((lc) => hub.aliases.includes(lc.city.toLowerCase().trim()));
}

/** Count of live network-hub warehouses backing a hub. */
export function liveHubCount(hub: CanadaHub, liveCities: LiveHubCity[]): number {
  return liveCities
    .filter((lc) => hub.aliases.includes(lc.city.toLowerCase().trim()))
    .reduce((sum, lc) => sum + (Number(lc.hub_count) || 0), 0);
}

/** Member hubs first (live-aware), then alphabetical by city. */
export function sortedCanadaHubs(liveCities: LiveHubCity[] = []): CanadaHub[] {
  return [...CANADA_HUBS].sort((a, b) => {
    const am = isHubLiveMember(a, liveCities);
    const bm = isHubLiveMember(b, liveCities);
    if (am !== bm) return am ? -1 : 1;
    return a.city.localeCompare(b.city);
  });
}

/** Hubs that can receive a given freight mode, member-priority ordered. */
export function hubsForMode(mode: FreightMode, liveCities: LiveHubCity[] = []): CanadaHub[] {
  return sortedCanadaHubs(liveCities).filter((h) => h.modes.includes(mode));
}
