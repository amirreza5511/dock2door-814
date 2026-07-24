/**
 * Client-safe catalog + sample data used by the public Explore & Directory pages.
 * No server imports — safe to use in client components. Mirrors the mobile app.
 */

export type Domain = "labour" | "logistics" | "freight" | "drayage" | "marketplace" | "globalfreight";

export const DOMAIN_LABELS: Record<Domain, string> = {
  labour: "Labour",
  logistics: "Logistics & Warehousing",
  freight: "Freight & Delivery",
  drayage: "Container Drayage",
  marketplace: "Rentals & Services",
  globalfreight: "Global Freight",
};

/** Tailwind accent classes per domain (text + subtle bg + border). */
export const DOMAIN_ACCENT: Record<Domain, string> = {
  labour: "text-purple-600 bg-purple-50 border-purple-200",
  logistics: "text-orange-600 bg-orange-50 border-orange-200",
  freight: "text-emerald-600 bg-emerald-50 border-emerald-200",
  drayage: "text-blue-600 bg-blue-50 border-blue-200",
  marketplace: "text-amber-600 bg-amber-50 border-amber-200",
  globalfreight: "text-sky-600 bg-sky-50 border-sky-200",
};

export interface ExploreRole {
  role: string;
  label: string;
  desc: string;
}

export interface DomainFeature {
  title: string;
  desc: string;
}

export interface DomainBullet {
  label: string;
  sub: string;
}

export interface DomainDef {
  key: Domain;
  badge: string;
  title: string;
  tagline: string;
  desc: string;
  /** Short bullets shown on the landing card — mirrors the mobile app landing. */
  bullets: DomainBullet[];
  features: DomainFeature[];
  roles: ExploreRole[];
}

export const DOMAINS: DomainDef[] = [
  {
    key: "labour",
    badge: "Domain 1",
    title: "Labour",
    tagline: "Staffing, on demand",
    desc: "Connect the people who need work with the businesses who need crews.",
    bullets: [
      { label: "Employers", sub: "Post & fill shifts fast" },
      { label: "Workers", sub: "Find shifts that fit you" },
      { label: "Employment Agencies", sub: "Your workers & clients, our platform" },
    ],
    features: [
      { title: "Post shifts in minutes", desc: "Set role, pay, time & location — get matched crews fast." },
      { title: "Find work that fits", desc: "Browse nearby shifts, apply in a tap, track your earnings." },
      { title: "Agencies welcome", desc: "Bring your own workers & clients, book and invoice on-platform." },
    ],
    roles: [
      { role: "Employer", label: "Employer", desc: "Post and manage work shifts" },
      { role: "Worker", label: "Worker", desc: "Find and apply for shifts" },
      { role: "EmploymentAgency", label: "Employment Agency", desc: "Book shifts for your workers" },
    ],
  },
  {
    key: "logistics",
    badge: "Domain 2",
    title: "Logistics & Warehousing",
    tagline: "Space & services in one place",
    desc: "Warehouse space, industrial services, trucking and fulfillment in one place.",
    bullets: [
      { label: "Warehouse Space", sub: "Dry · Chill · Frozen" },
      { label: "Industrial Services", sub: "On-demand crews" },
      { label: "Trucking & Fulfillment", sub: "Move and ship goods" },
    ],
    features: [
      { title: "Book warehouse space", desc: "Dry, chilled or frozen — reserve pallets by the day or month." },
      { title: "Hire industrial services", desc: "On-demand crews for loading, sorting, kitting and more." },
      { title: "Fulfillment & trucking", desc: "Store, pick, pack and ship from one dashboard." },
    ],
    roles: [
      { role: "Customer", label: "Customer", desc: "Book warehouse space & services" },
      { role: "WarehouseProvider", label: "Warehouse Provider", desc: "List & manage storage space" },
      { role: "ServiceProvider", label: "Service Provider", desc: "Offer industrial services" },
      { role: "GateStaff", label: "Gate Staff", desc: "Run dock & gate check-ins" },
    ],
  },
  {
    key: "freight",
    badge: "Domain 3",
    title: "Freight & Delivery",
    tagline: "Uber for trucks",
    desc: "Post any delivery, from a single box to a full load. Owner-operators and fleet carriers grab and dispatch them.",
    bullets: [
      { label: "Shippers", sub: "Post loads — parcel to full truck" },
      { label: "Owner-Operators", sub: "Bring your truck, accept loads" },
      { label: "Fleet / Carrier Companies", sub: "Accept loads & dispatch drivers" },
    ],
    features: [
      { title: "Post any delivery", desc: "From a single parcel to a full truckload — set pickup & drop-off." },
      { title: "Accept & deliver", desc: "Owner-operators grab loads that fit their route and truck." },
      { title: "Dispatch a fleet", desc: "Carriers accept loads and assign them to their drivers live." },
    ],
    roles: [
      { role: "Shipper", label: "Shipper", desc: "Post deliveries — parcel to full load" },
      { role: "Driver", label: "Owner-Operator", desc: "Accept & deliver loads yourself" },
      { role: "TruckingCompany", label: "Fleet / Carrier", desc: "Accept loads & dispatch drivers" },
    ],
  },
  {
    key: "drayage",
    badge: "Domain 4",
    title: "Container Drayage",
    tagline: "Port to door, tracked live",
    desc: "Post import/export container orders. Drayage companies claim them, dispatch drivers, and track containers live on a map.",
    bullets: [
      { label: "Freight Forwarders", sub: "Post import/export container orders" },
      { label: "Drayage Companies", sub: "Claim orders, dispatch & track live" },
      { label: "Drivers", sub: "Receive work orders & advance moves" },
      { label: "Customs Brokers", sub: "Docs, quotes & clearance on-platform" },
    ],
    features: [
      { title: "Post container orders", desc: "Import or export — with port, terminal and appointment details." },
      { title: "Claim & dispatch", desc: "Drayage companies claim orders and assign container drivers." },
      { title: "Customs clearance", desc: "Send docs, receive quotes and clear shipments in-app." },
    ],
    roles: [
      { role: "FreightForwarder", label: "Freight Forwarder", desc: "Post import/export orders & track" },
      { role: "DrayageCompany", label: "Drayage Company", desc: "Claim orders, dispatch & track live" },
      { role: "CustomsBroker", label: "Customs Broker", desc: "Quote & clear shipments" },
    ],
  },
  {
    key: "marketplace",
    badge: "Domain 5",
    title: "Rentals & Services",
    tagline: "Rent, repair & insure",
    desc: "Rent equipment you operate, hire an operated crane service, book mobile repair techs, and insure your cargo.",
    bullets: [
      { label: "Equipment Rental", sub: "Forklifts, lifts & gear you operate" },
      { label: "Crane Service", sub: "Crane + operator comes & does the lift" },
      { label: "Mobile Repair & Services", sub: "On-site techs & labour crews" },
      { label: "Cargo Insurance", sub: "Insure freight & shipments" },
    ],
    features: [
      { title: "Rent equipment", desc: "Forklifts, lifts and heavy gear you operate yourself." },
      { title: "Book mobile repair", desc: "On-site technicians and labour crews, dispatched to you." },
      { title: "Insure your cargo", desc: "Cover freight and shipments by cargo value in a few taps." },
    ],
    roles: [
      { role: "MarketplaceBuyer", label: "Marketplace Buyer", desc: "Rent gear, book repairs & insure cargo" },
      { role: "EquipmentRentalCompany", label: "Equipment / Crane Rental", desc: "Rent out forklifts, cranes & machinery" },
      { role: "MobileRepairProvider", label: "Mobile Repair & Services", desc: "Dispatch technicians & crews" },
      { role: "CargoInsurer", label: "Cargo Insurer", desc: "Insure freight & shipments" },
    ],
  },
  {
    key: "globalfreight",
    badge: "Domain 6",
    title: "Global Freight",
    tagline: "One request, competing quotes",
    desc: "International shipping exchange. Post one freight request — air, ocean, truck, FCL or LCL — and receive competing quotes worldwide.",
    bullets: [
      { label: "Importers / Exporters", sub: "One request, competing quotes" },
      { label: "Global Freight Forwarders", sub: "Quote every mode worldwide" },
      { label: "Carriers / Shipping Lines", sub: "Quote capacity directly" },
    ],
    features: [
      { title: "One quote request", desc: "Air, ocean, truck, FCL or LCL — describe it once." },
      { title: "Competing quotes", desc: "Forwarders and carriers worldwide bid on your shipment." },
      { title: "Pick & ship", desc: "Compare price and transit, accept, then track your booking." },
    ],
    roles: [
      { role: "ImporterExporter", label: "Importer / Exporter", desc: "Post a freight request, get quotes" },
      { role: "GlobalFreightForwarder", label: "Global Freight Forwarder", desc: "Quote worldwide freight requests" },
      { role: "Carrier", label: "Carrier / Shipping Line", desc: "Quote freight capacity directly" },
    ],
  },
];

export const DOMAIN_MAP: Record<Domain, DomainDef> = DOMAINS.reduce(
  (acc, d) => { acc[d.key] = d; return acc; },
  {} as Record<Domain, DomainDef>,
);

/**
 * Web dashboard route for each explorable role. A visitor taps "Explore as
 * [role]" on the domain page, we set the explore cookie, then navigate here.
 * Mirrors the mobile domain routes (adjusted to the web app's URL scheme).
 */
export const EXPLORE_ROLE_ROUTE: Record<string, string> = {
  Employer: "/employer",
  Worker: "/worker",
  EmploymentAgency: "/agency",
  Customer: "/customer",
  WarehouseProvider: "/warehouse",
  ServiceProvider: "/service-provider",
  GateStaff: "/gate-staff",
  Shipper: "/shipper",
  Driver: "/driver",
  TruckingCompany: "/trucking",
  FreightForwarder: "/freight-forwarder",
  DrayageCompany: "/drayage-company",
  CustomsBroker: "/customs-broker",
  MarketplaceBuyer: "/marketplace-buyer",
  EquipmentRentalCompany: "/rental-company",
  MobileRepairProvider: "/repair-provider",
  CargoInsurer: "/cargo-insurer",
  ImporterExporter: "/global-freight",
  GlobalFreightForwarder: "/global-freight",
  Carrier: "/global-freight",
};

export interface DirectoryCompany {
  id: string; name: string; domain: Domain; roleLabel: string;
  city: string; rating: number; reviews: number; verified: boolean; blurb: string;
}

export interface DirectoryJob {
  id: string; title: string; domain: Domain; company: string;
  city: string; pay: string; when: string; tag: string;
}

export const DIRECTORY_COMPANIES: DirectoryCompany[] = [
  { id: "dir-c1", name: "Annacis Island Distribution", domain: "logistics", roleLabel: "Warehouse Provider", city: "Delta, BC", rating: 4.8, reviews: 126, verified: true, blurb: "Dry & ambient storage, 420 pallet positions, cross-dock ready." },
  { id: "dir-c2", name: "Riverside Cold Storage", domain: "logistics", roleLabel: "Warehouse Provider", city: "Richmond, BC", rating: 4.7, reviews: 89, verified: true, blurb: "Frozen & chilled 3PL with blast freezing and pick-pack." },
  { id: "dir-c3", name: "Harbour Freight Ltd.", domain: "freight", roleLabel: "Fleet / Carrier", city: "Burnaby, BC", rating: 4.6, reviews: 212, verified: true, blurb: "Regional LTL & FTL fleet, 40 trucks, live tracking." },
  { id: "dir-c4", name: "PacRim Drayage", domain: "drayage", roleLabel: "Drayage Company", city: "Vancouver, BC", rating: 4.9, reviews: 74, verified: true, blurb: "Port & rail container moves, bonded, 24/7 dispatch." },
  { id: "dir-c5", name: "Meridian Global Forwarding", domain: "globalfreight", roleLabel: "Freight Forwarder", city: "Toronto, ON", rating: 4.5, reviews: 158, verified: true, blurb: "Air & ocean forwarding worldwide, customs & insurance." },
  { id: "dir-c6", name: "WestCoast Crane & Rigging", domain: "marketplace", roleLabel: "Equipment Rental", city: "Surrey, BC", rating: 4.7, reviews: 43, verified: false, blurb: "Operated cranes, forklifts & lifts for hire by the day." },
  { id: "dir-c7", name: "OnCall Mobile Repair", domain: "marketplace", roleLabel: "Mobile Repair", city: "Langley, BC", rating: 4.4, reviews: 61, verified: true, blurb: "On-site trailer, reefer & forklift repair technicians." },
  { id: "dir-c8", name: "Fraser Valley Staffing", domain: "labour", roleLabel: "Employment Agency", city: "Abbotsford, BC", rating: 4.3, reviews: 97, verified: true, blurb: "Warehouse & general labour crews, same-day placement." },
  { id: "dir-c9", name: "Delta Customs Brokers", domain: "drayage", roleLabel: "Customs Broker", city: "Delta, BC", rating: 4.8, reviews: 52, verified: true, blurb: "Import/export clearance, HS classification, PARS/PAPS." },
  { id: "dir-c10", name: "Cascade Cargo Insurance", domain: "marketplace", roleLabel: "Cargo Insurer", city: "Vancouver, BC", rating: 4.6, reviews: 38, verified: true, blurb: "Per-shipment and annual freight cargo cover." },
];

export const DIRECTORY_JOBS: DirectoryJob[] = [
  { id: "dir-j1", title: "Forklift Operator", domain: "labour", company: "Preview Logistics Co.", city: "Richmond, BC", pay: "$31/hr", when: "Tomorrow · 7am–3pm", tag: "Shift" },
  { id: "dir-j2", title: "Warehouse Loader", domain: "labour", company: "Preview Logistics Co.", city: "Vancouver, BC", pay: "$24/hr", when: "Today · 8am–4pm", tag: "Shift" },
  { id: "dir-j3", title: "FTL: Richmond → Surrey, 10 pallets", domain: "freight", company: "Open load", city: "Richmond, BC", pay: "$520", when: "Open now", tag: "Load" },
  { id: "dir-j4", title: "Reefer: Abbotsford → Vancouver", domain: "freight", company: "Open load", city: "Abbotsford, BC", pay: "$890", when: "Open now", tag: "Load" },
  { id: "dir-j5", title: "Import 40HQ pickup — Vanterm", domain: "drayage", company: "DRY-10461", city: "Vancouver, BC", pay: "Quote", when: "Open now", tag: "Container" },
  { id: "dir-j6", title: "Ocean FCL: Shanghai → Vancouver", domain: "globalfreight", company: "Quote request", city: "Shanghai, CN", pay: "4 quotes", when: "2 days ago", tag: "Freight" },
  { id: "dir-j7", title: "Air: Frankfurt → Toronto, 800kg", domain: "globalfreight", company: "Quote request", city: "Frankfurt, DE", pay: "1 quote", when: "6h ago", tag: "Freight" },
  { id: "dir-j8", title: "Crane lift — 20t, half day", domain: "marketplace", company: "Buyer request", city: "Surrey, BC", pay: "Quote", when: "This week", tag: "Service" },
];
