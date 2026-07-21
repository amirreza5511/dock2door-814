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
  /** Partner-operated hub in our network — gets priority. */
  isMember: boolean;
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
    blurb: 'GTA gateway — largest inland deconsolidation & last-mile coverage.',
  },
  {
    id: 'yvr-vancouver', city: 'Vancouver', province: 'BC',
    seaportCode: 'CAVAN', airportCode: 'YVR', modes: COASTAL, isMember: true,
    blurb: 'Pacific port hub — ocean LCL/FCL landing & West-coast distribution.',
  },
  {
    id: 'yul-montreal', city: 'Montreal', province: 'QC',
    seaportCode: 'CAMTR', airportCode: 'YUL', modes: COASTAL, isMember: true,
    blurb: 'St. Lawrence port + air gateway for Quebec & Eastern Canada.',
  },
  {
    id: 'yyc-calgary', city: 'Calgary', province: 'AB',
    modes: INLAND, isMember: false,
    blurb: 'Prairie distribution hub for Alberta & the West.',
  },
  {
    id: 'yeg-edmonton', city: 'Edmonton', province: 'AB',
    modes: INLAND, isMember: false,
    blurb: 'Northern Alberta gateway & industrial freight coverage.',
  },
  {
    id: 'ywg-winnipeg', city: 'Winnipeg', province: 'MB',
    modes: INLAND, isMember: false,
    blurb: 'Central Canada crossroads — rail & road consolidation.',
  },
  {
    id: 'yow-ottawa', city: 'Ottawa', province: 'ON',
    modes: INLAND, isMember: false,
    blurb: 'National capital region delivery coverage.',
  },
  {
    id: 'yhz-halifax', city: 'Halifax', province: 'NS',
    seaportCode: 'CAHAL', modes: COASTAL, isMember: false,
    blurb: 'Atlantic port hub — first inbound call for Europe/Asia via Suez.',
  },
];

/** Member hubs first, then alphabetical by city. */
export function sortedCanadaHubs(): CanadaHub[] {
  return [...CANADA_HUBS].sort((a, b) => {
    if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
    return a.city.localeCompare(b.city);
  });
}

/** Hubs that can receive a given freight mode, member-priority ordered. */
export function hubsForMode(mode: FreightMode): CanadaHub[] {
  return sortedCanadaHubs().filter((h) => h.modes.includes(mode));
}
