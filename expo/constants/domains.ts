import {
  Warehouse, Wrench, Users, ShieldCheck, Clock, HardHat, Boxes, Truck,
  PackageOpen, Anchor, Store, Forklift, Hammer, Construction, UsersRound,
  Globe, Ship, Plane, ClipboardList, Building2,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { UserRole } from '@/constants/types';
import type { Domain } from '@/lib/access';
import C from '@/constants/colors';

/** One explorable role inside a domain. */
export interface DomainRole {
  role: UserRole;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** Dashboard route to open when exploring as this role. */
  route: string;
}

/** A feature/capability highlight for a domain intro. */
export interface DomainFeature {
  icon: LucideIcon;
  title: string;
  desc: string;
}

export interface DomainDef {
  key: Domain;
  badge: string;
  color: string;
  bg: string;
  icon: LucideIcon;
  title: string;
  tagline: string;
  desc: string;
  /** Short bullets shown on the landing card. */
  bullets: { icon: LucideIcon; label: string; sub: string }[];
  /** Richer capability highlights for the intro screen. */
  features: DomainFeature[];
  /** Roles a visitor can explore inside this domain. */
  roles: DomainRole[];
}

export const DOMAINS: DomainDef[] = [
  {
    key: 'labour',
    badge: 'Domain 1',
    color: C.purple,
    bg: C.purpleDim,
    icon: HardHat,
    title: 'Labour',
    tagline: 'Staffing, on demand',
    desc: 'Connect the people who need work with the businesses who need crews.',
    bullets: [
      { icon: Clock, label: 'Employers', sub: 'Post & fill shifts fast' },
      { icon: Users, label: 'Workers', sub: 'Find shifts that fit you' },
      { icon: UsersRound, label: 'Employment Agencies', sub: 'Your workers & clients, our platform' },
    ],
    features: [
      { icon: Clock, title: 'Post shifts in minutes', desc: 'Set role, pay, time & location — get matched crews fast.' },
      { icon: Users, title: 'Find work that fits', desc: 'Browse nearby shifts, apply in a tap, track your earnings.' },
      { icon: UsersRound, title: 'Agencies welcome', desc: 'Bring your own workers & clients, book and invoice on-platform.' },
    ],
    roles: [
      { role: 'Employer', label: 'Employer', desc: 'Post and manage work shifts', icon: Clock, route: '/employer' },
      { role: 'Worker', label: 'Worker', desc: 'Find and apply for shifts', icon: Users, route: '/worker' },
      { role: 'EmploymentAgency', label: 'Employment Agency', desc: 'Book shifts for your workers', icon: UsersRound, route: '/agency' },
    ],
  },
  {
    key: 'logistics',
    badge: 'Domain 2',
    color: C.accent,
    bg: C.accentDim,
    icon: Boxes,
    title: 'Logistics & Warehousing',
    tagline: 'Space & services in one place',
    desc: 'Warehouse space, industrial services, trucking and fulfillment in one place.',
    bullets: [
      { icon: Warehouse, label: 'Warehouse Space', sub: 'Dry · Chill · Frozen' },
      { icon: Wrench, label: 'Industrial Services', sub: 'On-demand crews' },
      { icon: Truck, label: 'Trucking & Fulfillment', sub: 'Move and ship goods' },
    ],
    features: [
      { icon: Warehouse, title: 'Book warehouse space', desc: 'Dry, chilled or frozen — reserve pallets by the day or month.' },
      { icon: Wrench, title: 'Hire industrial services', desc: 'On-demand crews for loading, sorting, kitting and more.' },
      { icon: Boxes, title: 'Fulfillment & trucking', desc: 'Store, pick, pack and ship from one dashboard.' },
    ],
    roles: [
      { role: 'Customer', label: 'Customer', desc: 'Book warehouse space & services', icon: ShieldCheck, route: '/customer' },
      { role: 'WarehouseProvider', label: 'Warehouse Provider', desc: 'List & manage storage space', icon: Warehouse, route: '/warehouse-provider' },
      { role: 'ServiceProvider', label: 'Service Provider', desc: 'Offer industrial services', icon: Wrench, route: '/service-provider' },
      { role: 'GateStaff', label: 'Gate Staff', desc: 'Run dock & gate check-ins', icon: ClipboardList, route: '/gate-staff' },
    ],
  },
  {
    key: 'freight',
    badge: 'Domain 3',
    color: C.green,
    bg: C.greenDim,
    icon: PackageOpen,
    title: 'Freight & Delivery',
    tagline: 'Uber for trucks',
    desc: 'Post any delivery, from a single box to a full load. Owner-operators and fleet carriers grab and dispatch them.',
    bullets: [
      { icon: PackageOpen, label: 'Shippers', sub: 'Post loads — parcel to full truck' },
      { icon: Truck, label: 'Owner-Operators', sub: 'Bring your truck, accept loads' },
      { icon: Truck, label: 'Fleet / Carrier Companies', sub: 'Accept loads & dispatch drivers' },
    ],
    features: [
      { icon: PackageOpen, title: 'Post any delivery', desc: 'From a single parcel to a full truckload — set pickup & drop-off.' },
      { icon: Truck, title: 'Accept & deliver', desc: 'Owner-operators grab loads that fit their route and truck.' },
      { icon: UsersRound, title: 'Dispatch a fleet', desc: 'Carriers accept loads and assign them to their drivers live.' },
    ],
    roles: [
      { role: 'Shipper', label: 'Shipper', desc: 'Post deliveries — parcel to full load', icon: PackageOpen, route: '/shipper' },
      { role: 'Driver', label: 'Owner-Operator', desc: 'Accept & deliver loads yourself', icon: Truck, route: '/driver' },
      { role: 'TruckingCompany', label: 'Fleet / Carrier', desc: 'Accept loads & dispatch drivers', icon: Truck, route: '/trucking-company' },
    ],
  },
  {
    key: 'drayage',
    badge: 'Domain 4',
    color: C.blue,
    bg: C.blueDim,
    icon: Anchor,
    title: 'Container Drayage',
    tagline: 'Port to door, tracked live',
    desc: 'Post import/export container orders. Drayage companies claim them, dispatch drivers, enter port reservations, and track containers live on a map.',
    bullets: [
      { icon: Anchor, label: 'Freight Forwarders', sub: 'Post import/export container orders' },
      { icon: Truck, label: 'Drayage Companies', sub: 'Claim orders, dispatch & track live' },
      { icon: Users, label: 'Drivers', sub: 'Receive work orders & advance moves' },
      { icon: ShieldCheck, label: 'Customs Brokers', sub: 'Docs, quotes & clearance on-platform' },
    ],
    features: [
      { icon: Anchor, title: 'Post container orders', desc: 'Import or export — with port, terminal and appointment details.' },
      { icon: Truck, title: 'Claim & dispatch', desc: 'Drayage companies claim orders and assign container drivers.' },
      { icon: ShieldCheck, title: 'Customs clearance', desc: 'Send docs, receive quotes and clear shipments in-app.' },
    ],
    roles: [
      { role: 'FreightForwarder', label: 'Freight Forwarder', desc: 'Post import/export orders & track', icon: Anchor, route: '/freight-forwarder' },
      { role: 'DrayageCompany', label: 'Drayage Company', desc: 'Claim orders, dispatch & track live', icon: Truck, route: '/drayage-company' },
      { role: 'CustomsBroker', label: 'Customs Broker', desc: 'Quote & clear shipments', icon: ShieldCheck, route: '/customs-broker' },
    ],
  },
  {
    key: 'marketplace',
    badge: 'Domain 5',
    color: C.yellow,
    bg: C.yellowDim,
    icon: Store,
    title: 'Rentals & Services',
    tagline: 'Rent, repair & insure',
    desc: 'Rent equipment you operate, hire an operated crane service, book mobile repair techs, and insure your cargo. Request a quote, get an official price, and place the order.',
    bullets: [
      { icon: Forklift, label: 'Equipment Rental', sub: 'Forklifts, lifts & gear you operate' },
      { icon: Construction, label: 'Crane Service', sub: 'Crane + operator comes & does the lift' },
      { icon: Hammer, label: 'Mobile Repair & Services', sub: 'On-site techs & labour crews' },
      { icon: ShieldCheck, label: 'Cargo Insurance', sub: 'Insure freight & shipments' },
    ],
    features: [
      { icon: Forklift, title: 'Rent equipment', desc: 'Forklifts, lifts and heavy gear you operate yourself.' },
      { icon: Hammer, title: 'Book mobile repair', desc: 'On-site technicians and labour crews, dispatched to you.' },
      { icon: ShieldCheck, title: 'Insure your cargo', desc: 'Cover freight and shipments by cargo value in a few taps.' },
    ],
    roles: [
      { role: 'MarketplaceBuyer', label: 'Marketplace Buyer', desc: 'Rent gear, book repairs & insure cargo', icon: Store, route: '/marketplace-buyer' },
      { role: 'EquipmentRentalCompany', label: 'Equipment / Crane Rental', desc: 'Rent out forklifts, cranes & machinery', icon: Forklift, route: '/rental-company' },
      { role: 'MobileRepairProvider', label: 'Mobile Repair & Services', desc: 'Dispatch technicians & crews', icon: Hammer, route: '/repair-provider' },
      { role: 'CargoInsurer', label: 'Cargo Insurer', desc: 'Insure freight & shipments', icon: ShieldCheck, route: '/cargo-insurer' },
    ],
  },
  {
    key: 'globalfreight',
    badge: 'Domain 6',
    color: C.blue,
    bg: C.blueDim,
    icon: Globe,
    title: 'Global Freight',
    tagline: 'One request, competing quotes',
    desc: 'International shipping & freight exchange. Post one freight quote request — air, ocean, truck, FCL or LCL — and receive competing quotes from forwarders, carriers and truckers worldwide.',
    bullets: [
      { icon: Boxes, label: 'Importers / Exporters', sub: 'One request, competing quotes' },
      { icon: Plane, label: 'Global Freight Forwarders', sub: 'Quote every mode worldwide' },
      { icon: Ship, label: 'Carriers / Shipping Lines', sub: 'Quote capacity directly' },
    ],
    features: [
      { icon: Boxes, title: 'One quote request', desc: 'Air, ocean, truck, FCL or LCL — describe it once.' },
      { icon: Plane, title: 'Competing quotes', desc: 'Forwarders and carriers worldwide bid on your shipment.' },
      { icon: Ship, title: 'Pick & ship', desc: 'Compare price and transit, accept, then track your booking.' },
    ],
    roles: [
      { role: 'ImporterExporter', label: 'Importer / Exporter', desc: 'Post a freight request, get quotes', icon: Boxes, route: '/global-freight' },
      { role: 'GlobalFreightForwarder', label: 'Global Freight Forwarder', desc: 'Quote worldwide freight requests', icon: Plane, route: '/global-freight' },
      { role: 'Carrier', label: 'Carrier / Shipping Line', desc: 'Quote freight capacity directly', icon: Ship, route: '/global-freight' },
    ],
  },
];

export const DOMAIN_MAP: Record<Domain, DomainDef> = DOMAINS.reduce(
  (acc, d) => { acc[d.key] = d; return acc; },
  {} as Record<Domain, DomainDef>,
);

export { Building2 };
