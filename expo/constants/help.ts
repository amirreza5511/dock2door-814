import {
  Boxes, HardHat, PackageOpen, ShieldCheck, Warehouse, Wrench, Users, Clock,
  Truck, Building2, UserCog, Crown, DoorOpen, Send, PackageCheck,
  type LucideIcon,
} from 'lucide-react-native';
import C from '@/constants/colors';

/**
 * Visual layout used to render a stylized "screenshot" preview for a screen
 * inside the manual. Each kind draws a recognizable mock of that screen type.
 */
export type MockKind = 'dashboard' | 'list' | 'form' | 'map' | 'chat' | 'grid' | 'detail' | 'wizard';

export interface ScreenDoc {
  /** Stable id (route tail) */
  id: string;
  /** Human title shown in the manual */
  title: string;
  /** One-line summary of what the screen is for */
  summary: string;
  /** Concrete things the user can do here */
  actions: string[];
  /** Visual style of the rendered preview */
  mock: MockKind;
  /** Labels rendered inside the mock to make it recognizable */
  mockRows?: string[];
  /** Optional primary button label rendered in the mock */
  mockCta?: string;
}

export interface RoleDoc {
  /** Route segment / stable key, also used as the manual deep-link param */
  key: string;
  /** Display name */
  name: string;
  /** Short tagline */
  tagline: string;
  /** Which product world this role belongs to */
  world: 'labour' | 'logistics' | 'freight' | 'admin';
  icon: LucideIcon;
  color: string;
  colorDim: string;
  /** Plain-language overview of what this role does on the platform */
  overview: string;
  screens: ScreenDoc[];
}

export interface WorldDoc {
  key: 'labour' | 'logistics' | 'freight' | 'admin';
  title: string;
  blurb: string;
  color: string;
}

export const HELP_WORLDS: WorldDoc[] = [
  { key: 'freight', title: 'Freight & Delivery', blurb: 'Post loads, accept them, and deliver — Uber for trucks.', color: C.green },
  { key: 'logistics', title: 'Logistics & Warehousing', blurb: 'Warehouse space, industrial services and fulfillment.', color: C.accent },
  { key: 'labour', title: 'Labour', blurb: 'Post shifts and find workers fast.', color: C.purple },
  { key: 'admin', title: 'Administration', blurb: 'Run, price and police the whole platform.', color: C.red },
];

export const HELP_ROLES: RoleDoc[] = [
  // ─────────────────────────────── FREIGHT ───────────────────────────────
  {
    key: 'shipper',
    name: 'Shipper',
    tagline: 'Post deliveries of any size',
    world: 'freight',
    icon: PackageOpen,
    color: C.green,
    colorDim: C.greenDim,
    overview:
      'Shippers post anything that needs to move — from a single box to a full truckload — get an instant quote, then watch it get picked up and delivered with photo proof and live tracking.',
    screens: [
      {
        id: 'index', title: 'Shipper Home', summary: 'Your delivery dashboard with active loads and quick actions.',
        mock: 'dashboard', mockRows: ['Active loads', 'In transit', 'Delivered this week'], mockCta: 'Post a load',
        actions: ['See loads at a glance by status', 'Jump to posting a new load', 'Open live tracking for an active load'],
      },
      {
        id: 'post-load', title: 'Post a Load', summary: 'Describe what to move, where, and when — and get an instant price.',
        mock: 'wizard', mockRows: ['Pickup address', 'Drop-off address', 'Cargo size & pallets', 'Vehicle type'], mockCta: 'Get quote & post',
        actions: ['Set pickup and drop-off locations', 'Choose vehicle type and cargo size', 'See the instant quote before posting'],
      },
      {
        id: 'loads', title: 'My Loads', summary: 'Every load you have posted, with its current stage.',
        mock: 'list', mockRows: ['Posted · waiting for carrier', 'Accepted · driver assigned', 'Delivered · proof attached'],
        actions: ['Filter loads by status', 'Open a load to view details and proof', 'Cancel a load that is still open'],
      },
      {
        id: 'track', title: 'Live Tracking', summary: 'Watch the assigned truck move on a map in near real-time.',
        mock: 'map', mockRows: ['Pickup pin', 'Truck (live)', 'Drop-off pin'],
        actions: ['Follow the truck position live', 'See pickup & delivery photo proof', 'Read the trip stage and last-updated time'],
      },
    ],
  },
  {
    key: 'driver',
    name: 'Owner-Operator (Driver)',
    tagline: 'Bring your truck, accept loads',
    world: 'freight',
    icon: Truck,
    color: C.green,
    colorDim: C.greenDim,
    overview:
      'Owner-operators browse open loads on a map, accept the ones that fit, and complete them with pickup and delivery photo proof — getting paid the carrier net after platform commission.',
    screens: [
      {
        id: 'index', title: 'Driver Home', summary: 'Today’s job, earnings and your next steps.',
        mock: 'dashboard', mockRows: ['Current job', 'Earnings', 'Documents status'], mockCta: 'Find loads',
        actions: ['See your active job', 'Check earnings and document status', 'Jump into the loads marketplace'],
      },
      {
        id: 'loads', title: 'Loads Marketplace', summary: 'Open loads shown as pins on a real map — tap to see details.',
        mock: 'map', mockRows: ['Load · Toronto → Ottawa', 'Load · parcel, same-day', 'Tap pin for details'], mockCta: 'Accept load',
        actions: ['Browse open loads on the map', 'Tap a pin to read the full load detail', 'Accept a load to assign it to yourself'],
      },
      {
        id: 'my-loads', title: 'My Loads', summary: 'Loads you have accepted and their delivery progress.',
        mock: 'list', mockRows: ['En route to pickup', 'Picked up · en route', 'Delivered'], mockCta: 'Advance status',
        actions: ['Advance a load through its stages', 'Capture pickup & delivery photo proof', 'Message the shipper or contacts'],
      },
      {
        id: 'pod', title: 'Proof of Delivery', summary: 'Snap the photo and capture the receiver’s name to close a job.',
        mock: 'form', mockRows: ['Pickup photo', 'Delivery photo', 'Receiver name'], mockCta: 'Submit proof',
        actions: ['Take a pickup photo before going en route', 'Take a delivery photo at the drop-off', 'Record who received the goods'],
      },
      {
        id: 'documents', title: 'Documents', summary: 'Your licence, insurance and vehicle registration on file.',
        mock: 'list', mockRows: ['Driver licence', 'Insurance', 'Vehicle registration'],
        actions: ['Upload and update required documents', 'See approval status', 'Stay eligible to accept loads'],
      },
    ],
  },
  {
    key: 'trucking-company',
    name: 'Fleet / Carrier Company',
    tagline: 'Accept loads & dispatch drivers',
    world: 'freight',
    icon: Building2,
    color: C.green,
    colorDim: C.greenDim,
    overview:
      'Carrier companies run a fleet: they see every open load on a dispatch board, accept the ones they want, and assign them to their drivers — then track finance and appointments in one place.',
    screens: [
      {
        id: 'index', title: 'Carrier Home', summary: 'Fleet overview — active loads, drivers and finance.',
        mock: 'dashboard', mockRows: ['Active loads', 'Drivers on duty', 'Revenue'], mockCta: 'Open dispatch',
        actions: ['See fleet activity at a glance', 'Open the dispatch board', 'Review finance and appointments'],
      },
      {
        id: 'loads', title: 'Dispatch Board', summary: 'All open loads on a map — accept and assign to a driver in one flow.',
        mock: 'map', mockRows: ['Open load', 'Accept', 'Assign to driver'], mockCta: 'Accept & assign',
        actions: ['View every open load on the map', 'Accept a load for your company', 'Assign it directly to a fleet driver'],
      },
      {
        id: 'my-loads', title: 'Company Loads', summary: 'Loads your company has taken, and who is driving them.',
        mock: 'list', mockRows: ['Assigned · driver A', 'En route', 'Delivered'], mockCta: 'Reassign',
        actions: ['Track each company load’s progress', 'Reassign a load to a different driver', 'Open chat for a load'],
      },
      {
        id: 'fleet', title: 'Fleet & Drivers', summary: 'Your trucks and drivers, plus the vehicle types you run.',
        mock: 'list', mockRows: ['Driver · status', 'Truck · type', 'Add vehicle type'],
        actions: ['Manage drivers in your fleet', 'Set the vehicle types you operate', 'See driver availability'],
      },
      {
        id: 'appointments', title: 'Appointments', summary: 'Dock and pickup appointments for your loads.',
        mock: 'list', mockRows: ['Dock 4 · 09:00', 'Pickup · 13:30', 'Drop-off · 16:00'],
        actions: ['View scheduled dock appointments', 'Coordinate pickup and drop-off times'],
      },
      {
        id: 'finance', title: 'Finance', summary: 'Earnings, payouts and commission for your fleet.',
        mock: 'dashboard', mockRows: ['Gross', 'Commission', 'Net payout'],
        actions: ['Review earnings and payouts', 'See platform commission deducted', 'Track net revenue'],
      },
      {
        id: 'messages', title: 'Messages', summary: 'Conversations with shippers, drivers and dispatch.',
        mock: 'chat', mockRows: ['Shipper thread', 'Driver thread', 'Dispatch'],
        actions: ['Chat with shippers about loads', 'Coordinate with your drivers'],
      },
    ],
  },
  // ─────────────────────────────── LOGISTICS ───────────────────────────────
  {
    key: 'customer',
    name: 'Customer',
    tagline: 'Book warehouse space & services',
    world: 'logistics',
    icon: ShieldCheck,
    color: C.blue,
    colorDim: C.blueDim,
    overview:
      'Customers book warehouse space, hire industrial services, ship orders and post freight loads — managing inventory, bookings and billing from one account.',
    screens: [
      {
        id: 'index', title: 'Customer Home', summary: 'Your bookings, orders and shortcuts.',
        mock: 'dashboard', mockRows: ['Active bookings', 'Open orders', 'Inventory'], mockCta: 'Find warehouse',
        actions: ['See bookings and orders at a glance', 'Jump to browse warehouses or services'],
      },
      {
        id: 'warehouses', title: 'Browse Warehouses', summary: 'Find storage by location, type and price.',
        mock: 'grid', mockRows: ['Dry storage', 'Chilled', 'Frozen'], mockCta: 'Book space',
        actions: ['Filter by storage type and location', 'Compare pallet pricing', 'Request a booking'],
      },
      {
        id: 'services', title: 'Browse Services', summary: 'Hire industrial and on-demand crews.',
        mock: 'grid', mockRows: ['Loading crew', 'Packing', 'Forklift'], mockCta: 'Request service',
        actions: ['Browse available services', 'Request a service booking'],
      },
      {
        id: 'bookings', title: 'My Bookings', summary: 'All your warehouse and service bookings.',
        mock: 'list', mockRows: ['Requested', 'Confirmed', 'Completed'],
        actions: ['Track booking status', 'Open a booking for details'],
      },
      {
        id: 'orders', title: 'Orders', summary: 'Fulfillment orders for your goods.',
        mock: 'list', mockRows: ['New order', 'Picking', 'Shipped'],
        actions: ['Create and track orders', 'See fulfillment progress'],
      },
      {
        id: 'inventory', title: 'Inventory', summary: 'What you have stored and where.',
        mock: 'list', mockRows: ['SKU · qty · location', 'Low stock', 'Reorder'],
        actions: ['View stock by SKU and location', 'Spot low-stock items'],
      },
      {
        id: 'loads', title: 'Freight Loads', summary: 'Post and track freight from your account.',
        mock: 'list', mockRows: ['Posted', 'In transit', 'Delivered'], mockCta: 'Post a load',
        actions: ['Post a load to the freight network', 'Track its delivery'],
      },
      {
        id: 'post-load', title: 'Post a Load', summary: 'Create a freight load with an instant quote.',
        mock: 'wizard', mockRows: ['Pickup', 'Drop-off', 'Cargo'], mockCta: 'Post',
        actions: ['Enter pickup and drop-off', 'Get an instant quote and post'],
      },
      {
        id: 'billing', title: 'Billing', summary: 'Invoices and payments for your account.',
        mock: 'list', mockRows: ['Invoice · paid', 'Invoice · due', 'Payment method'],
        actions: ['Review invoices', 'Manage payment methods'],
      },
    ],
  },
  {
    key: 'warehouse-provider',
    name: 'Warehouse Provider',
    tagline: 'List space & run your WMS',
    world: 'logistics',
    icon: Warehouse,
    color: C.accent,
    colorDim: C.accentDim,
    overview:
      'Warehouse providers list storage space, accept bookings, and run a full warehouse management system — receiving, putaway, picking, packing and shipping — with staff and station tooling.',
    screens: [
      {
        id: 'index', title: 'Provider Home', summary: 'Occupancy, bookings and warehouse activity.',
        mock: 'dashboard', mockRows: ['Occupancy', 'Pending bookings', 'Orders today'], mockCta: 'Open WMS',
        actions: ['See occupancy and bookings', 'Jump into the WMS or stations'],
      },
      {
        id: 'listings', title: 'Listings', summary: 'Your storage listings and pricing.',
        mock: 'list', mockRows: ['Dry · $/pallet', 'Chilled', 'Frozen'], mockCta: 'New listing',
        actions: ['Manage storage listings', 'Update availability and pricing'],
      },
      {
        id: 'create-listing', title: 'Create Listing', summary: 'Add a new storage listing.',
        mock: 'form', mockRows: ['Type', 'Capacity', 'Price per pallet'], mockCta: 'Publish',
        actions: ['Describe the space and type', 'Set capacity and pricing'],
      },
      {
        id: 'bookings', title: 'Bookings', summary: 'Incoming booking requests to accept or decline.',
        mock: 'list', mockRows: ['Requested', 'Confirmed', 'Active'],
        actions: ['Accept or decline requests', 'Manage active bookings'],
      },
      {
        id: 'wms', title: 'WMS Overview', summary: 'The warehouse management cockpit.',
        mock: 'dashboard', mockRows: ['Inbound', 'Stock', 'Outbound'],
        actions: ['Monitor inbound and outbound flow', 'Drill into any station'],
      },
      {
        id: 'stations', title: 'Stations', summary: 'Hub for every work station in the warehouse.',
        mock: 'grid', mockRows: ['Receiving', 'Picking', 'Packing', 'Shipping'],
        actions: ['Open any station workflow', 'See station workload'],
      },
      {
        id: 'station-receiving', title: 'Receiving', summary: 'Check in inbound shipments.',
        mock: 'form', mockRows: ['Scan inbound', 'Confirm quantities', 'Putaway'], mockCta: 'Receive',
        actions: ['Verify inbound goods', 'Record quantities and putaway'],
      },
      {
        id: 'station-picking', title: 'Picking', summary: 'Pick items for outbound orders.',
        mock: 'list', mockRows: ['Pick list', 'Location', 'Qty'], mockCta: 'Confirm pick',
        actions: ['Work through pick lists', 'Confirm picked quantities'],
      },
      {
        id: 'station-packing', title: 'Packing', summary: 'Pack picked orders for shipment.',
        mock: 'form', mockRows: ['Order', 'Box size', 'Weight'], mockCta: 'Pack',
        actions: ['Pack orders into cartons', 'Capture box size and weight'],
      },
      {
        id: 'station-shipping', title: 'Shipping', summary: 'Hand off packed orders to carriers.',
        mock: 'list', mockRows: ['Ready to ship', 'Label', 'Manifest'], mockCta: 'Ship',
        actions: ['Generate labels', 'Build the carrier manifest'],
      },
      {
        id: 'station-inventory', title: 'Station Inventory', summary: 'Stock levels by station.',
        mock: 'list', mockRows: ['SKU · qty', 'Bin', 'Adjust'],
        actions: ['View and adjust stock', 'Track bin locations'],
      },
      {
        id: 'station-dock', title: 'Dock', summary: 'Manage dock doors and yard moves.',
        mock: 'list', mockRows: ['Door 1 · inbound', 'Door 2 · outbound', 'Yard'],
        actions: ['Assign dock doors', 'Coordinate yard moves'],
      },
      {
        id: 'staff', title: 'Staff', summary: 'Your warehouse staff and roles.',
        mock: 'list', mockRows: ['Staff · role', 'Station', 'Status'],
        actions: ['Manage staff and stations', 'Assign roles'],
      },
      {
        id: 'carriers', title: 'Carriers', summary: 'Carrier accounts used for shipping.',
        mock: 'list', mockRows: ['Carrier', 'Service', 'Rates'],
        actions: ['Connect shipping carriers', 'Compare service levels'],
      },
      {
        id: 'stripe-connect', title: 'Payouts (Stripe)', summary: 'Connect your account to receive payouts.',
        mock: 'form', mockRows: ['Connect Stripe', 'Bank details', 'Status'], mockCta: 'Connect',
        actions: ['Link a Stripe account', 'Enable payouts'],
      },
      {
        id: 'billing', title: 'Billing', summary: 'Revenue and invoices for your warehouse.',
        mock: 'list', mockRows: ['Revenue', 'Invoices', 'Payouts'],
        actions: ['Review revenue and invoices', 'Track payouts'],
      },
    ],
  },
  {
    key: 'service-provider',
    name: 'Service Provider',
    tagline: 'Offer industrial services',
    world: 'logistics',
    icon: Wrench,
    color: C.green,
    colorDim: C.greenDim,
    overview:
      'Service providers list industrial services — loading crews, forklift operators, packing teams — accept job requests, and manage their schedule and billing.',
    screens: [
      {
        id: 'index', title: 'Provider Home', summary: 'Jobs and listings at a glance.',
        mock: 'dashboard', mockRows: ['Active jobs', 'Requests', 'Earnings'], mockCta: 'New listing',
        actions: ['See active jobs and requests', 'Open your listings'],
      },
      {
        id: 'listings', title: 'Listings', summary: 'The services you offer.',
        mock: 'list', mockRows: ['Loading crew', 'Forklift', 'Packing'], mockCta: 'New listing',
        actions: ['Manage service listings', 'Set rates and availability'],
      },
      {
        id: 'create-listing', title: 'Create Listing', summary: 'Add a new service.',
        mock: 'form', mockRows: ['Service type', 'Rate', 'Coverage area'], mockCta: 'Publish',
        actions: ['Describe the service', 'Set rate and coverage'],
      },
      {
        id: 'jobs', title: 'Jobs', summary: 'Requested and active service jobs.',
        mock: 'list', mockRows: ['Requested', 'In progress', 'Completed'],
        actions: ['Accept or decline jobs', 'Track job progress'],
      },
      {
        id: 'billing', title: 'Billing', summary: 'Earnings and invoices.',
        mock: 'list', mockRows: ['Earnings', 'Invoices', 'Payouts'],
        actions: ['Review earnings', 'Manage invoices'],
      },
    ],
  },
  {
    key: 'gate-staff',
    name: 'Gate Staff',
    tagline: 'Manage the yard & gate',
    world: 'logistics',
    icon: DoorOpen,
    color: C.yellow,
    colorDim: C.yellowDim,
    overview:
      'Gate staff check trucks in and out and manage yard moves so trailers get to the right dock at the right time.',
    screens: [
      {
        id: 'index', title: 'Gate Home', summary: 'Today’s arrivals and yard status.',
        mock: 'dashboard', mockRows: ['Arrivals', 'In yard', 'Departures'], mockCta: 'Open yard',
        actions: ['See expected arrivals', 'Open the yard board'],
      },
      {
        id: 'yard', title: 'Yard', summary: 'Live yard map of trailers and doors.',
        mock: 'map', mockRows: ['Trailer · spot', 'Door assignment', 'Move'],
        actions: ['Check trucks in and out', 'Assign yard spots and doors'],
      },
    ],
  },
  // ─────────────────────────────── LABOUR ───────────────────────────────
  {
    key: 'employer',
    name: 'Employer',
    tagline: 'Post & fill shifts fast',
    world: 'labour',
    icon: Clock,
    color: C.yellow,
    colorDim: C.yellowDim,
    overview:
      'Employers post labour shifts, browse and book workers, manage a shift calendar, and handle billing — filling crews in hours instead of days.',
    screens: [
      {
        id: 'index', title: 'Employer Home', summary: 'Upcoming shifts and fill status.',
        mock: 'dashboard', mockRows: ['Open shifts', 'Filled', 'This week'], mockCta: 'Post a shift',
        actions: ['See shifts and fill rates', 'Post a new shift'],
      },
      {
        id: 'create-shift', title: 'Create Shift', summary: 'Define the role, time, pay and location.',
        mock: 'form', mockRows: ['Role', 'Date & time', 'Pay rate', 'Location'], mockCta: 'Post shift',
        actions: ['Describe the role and requirements', 'Set pay, time and location'],
      },
      {
        id: 'shifts', title: 'Shifts', summary: 'All your posted shifts and applicants.',
        mock: 'list', mockRows: ['Open · 3 applicants', 'Filled', 'Completed'],
        actions: ['Review applicants', 'Confirm or cancel shifts'],
      },
      {
        id: 'browse-workers', title: 'Browse Workers', summary: 'Find and book workers directly.',
        mock: 'grid', mockRows: ['Worker · rating', 'Skills', 'Availability'], mockCta: 'Invite',
        actions: ['Search workers by skill', 'Invite a worker to a shift'],
      },
      {
        id: 'calendar', title: 'Calendar', summary: 'Your shifts on a calendar view.',
        mock: 'grid', mockRows: ['Mon', 'Tue', 'Wed', 'Thu'],
        actions: ['See shifts by day', 'Spot coverage gaps'],
      },
      {
        id: 'company-profile', title: 'Company Profile', summary: 'How workers see your business.',
        mock: 'form', mockRows: ['Name & logo', 'About', 'Locations'], mockCta: 'Save',
        actions: ['Edit company details', 'Add locations'],
      },
      {
        id: 'billing', title: 'Billing', summary: 'Invoices and payments for shifts worked.',
        mock: 'list', mockRows: ['Invoice', 'Paid', 'Method'],
        actions: ['Review invoices', 'Manage payment methods'],
      },
      {
        id: 'account', title: 'Account', summary: 'Your profile and settings.',
        mock: 'list', mockRows: ['Profile', 'Notifications', 'Sign out'],
        actions: ['Update your profile', 'Manage notifications'],
      },
    ],
  },
  {
    key: 'worker',
    name: 'Worker',
    tagline: 'Find shifts that fit you',
    world: 'labour',
    icon: Users,
    color: C.purple,
    colorDim: C.purpleDim,
    overview:
      'Workers browse and apply to shifts, set their availability, clock in and out, and track earnings — with hours confirmed and paid automatically.',
    screens: [
      {
        id: 'index', title: 'Worker Home', summary: 'Your next shift and quick actions.',
        mock: 'dashboard', mockRows: ['Next shift', 'Earnings', 'Availability'], mockCta: 'Browse shifts',
        actions: ['See your upcoming shift', 'Clock in when it starts'],
      },
      {
        id: 'browse', title: 'Browse Shifts', summary: 'Open shifts near you.',
        mock: 'list', mockRows: ['Forklift · $/hr', 'Warehouse', 'Packing'], mockCta: 'Apply',
        actions: ['Filter shifts by type and pay', 'Apply with one tap'],
      },
      {
        id: 'my-shifts', title: 'My Shifts', summary: 'Shifts you applied to or are working.',
        mock: 'list', mockRows: ['Confirmed', 'In progress', 'Completed'], mockCta: 'Clock in',
        actions: ['Clock in and out', 'Message the employer'],
      },
      {
        id: 'shift-confirm', title: 'Confirm Hours', summary: 'Confirm worked hours to get paid.',
        mock: 'form', mockRows: ['Clock in', 'Clock out', 'Break'], mockCta: 'Confirm',
        actions: ['Review your hours', 'Confirm them for payment'],
      },
      {
        id: 'availability', title: 'Availability', summary: 'Tell employers when you can work.',
        mock: 'grid', mockRows: ['Mon', 'Tue', 'Wed', 'Weekend'], mockCta: 'Save',
        actions: ['Set the days and times you’re free', 'Get matched to fitting shifts'],
      },
      {
        id: 'earnings', title: 'Earnings', summary: 'What you’ve earned and upcoming payouts.',
        mock: 'dashboard', mockRows: ['This week', 'Pending', 'Paid'],
        actions: ['Track earnings by shift', 'See pending and paid amounts'],
      },
      {
        id: 'profile', title: 'Profile', summary: 'Your skills, documents and ratings.',
        mock: 'list', mockRows: ['Skills', 'Documents', 'Rating'],
        actions: ['Add skills and documents', 'Build your rating'],
      },
    ],
  },
  // ─────────────────────────────── ADMIN ───────────────────────────────
  {
    key: 'admin',
    name: 'Admin',
    tagline: 'Run the platform',
    world: 'admin',
    icon: UserCog,
    color: C.red,
    colorDim: C.redDim,
    overview:
      'Admins oversee the whole platform — users, companies, bookings, disputes, compliance and pricing. The Freight Pricing console sets the rates and commission used for every quote.',
    screens: [
      {
        id: 'index', title: 'Admin Home', summary: 'Platform health and key metrics.',
        mock: 'dashboard', mockRows: ['Users', 'Companies', 'Revenue'],
        actions: ['Monitor platform activity', 'Jump to any admin area'],
      },
      {
        id: 'freight-pricing', title: 'Freight Pricing', summary: 'Set rates & commission for every vehicle type.',
        mock: 'form', mockRows: ['Base + per-km + per-pallet', 'Speed multiplier', 'Commission %', 'Per-company override'], mockCta: 'Save rates',
        actions: ['Edit the rate card per vehicle type', 'Set commission and booking fee', 'Add per-company negotiated overrides'],
      },
      {
        id: 'users', title: 'Users', summary: 'All platform users and their roles.',
        mock: 'list', mockRows: ['User · role', 'Status', 'Actions'],
        actions: ['Search and manage users', 'Suspend or promote accounts'],
      },
      {
        id: 'companies', title: 'Companies', summary: 'Every company on the platform.',
        mock: 'list', mockRows: ['Company · type', 'Status', 'Verify'],
        actions: ['Verify and manage companies', 'Review company details'],
      },
      {
        id: 'entities', title: 'Entities', summary: 'Browse all records across the system.',
        mock: 'list', mockRows: ['Loads', 'Bookings', 'Shifts'],
        actions: ['Inspect any record', 'Cross-reference entities'],
      },
      {
        id: 'bookings', title: 'Bookings', summary: 'All warehouse & service bookings.',
        mock: 'list', mockRows: ['Requested', 'Confirmed', 'Disputed'],
        actions: ['Oversee bookings', 'Step in when needed'],
      },
      {
        id: 'disputes', title: 'Disputes', summary: 'Open disputes that need resolution.',
        mock: 'list', mockRows: ['Open', 'Under review', 'Resolved'], mockCta: 'Resolve',
        actions: ['Review dispute details', 'Resolve and record outcomes'],
      },
      {
        id: 'compliance', title: 'Compliance', summary: 'Documents and checks across companies.',
        mock: 'list', mockRows: ['Pending review', 'Approved', 'Expired'],
        actions: ['Review submitted documents', 'Approve or flag compliance'],
      },
      {
        id: 'certifications', title: 'Certifications', summary: 'Worker and driver certifications.',
        mock: 'list', mockRows: ['Cert · status', 'Expiry', 'Verify'],
        actions: ['Verify certifications', 'Track expiries'],
      },
      {
        id: 'billing', title: 'Billing', summary: 'Platform-wide billing and revenue.',
        mock: 'dashboard', mockRows: ['Revenue', 'Invoices', 'Payouts'],
        actions: ['Monitor revenue', 'Review invoices and payouts'],
      },
      {
        id: 'platform-settings', title: 'Platform Settings', summary: 'Global configuration switches.',
        mock: 'form', mockRows: ['Features', 'Fees', 'Regions'], mockCta: 'Save',
        actions: ['Toggle features', 'Adjust global settings'],
      },
      {
        id: 'shipping-carriers', title: 'Shipping Carriers', summary: 'Carriers available platform-wide.',
        mock: 'list', mockRows: ['Carrier', 'Service', 'Status'],
        actions: ['Manage carrier integrations', 'Enable or disable carriers'],
      },
      {
        id: 'labour-calendar', title: 'Labour Calendar', summary: 'Shift coverage across the platform.',
        mock: 'grid', mockRows: ['Mon', 'Tue', 'Wed', 'Thu'],
        actions: ['Monitor shift coverage', 'Spot platform-wide gaps'],
      },
      {
        id: 'work-photos', title: 'Work Photos', summary: 'Proof photos captured across jobs.',
        mock: 'grid', mockRows: ['Pickup', 'Delivery', 'Job proof'],
        actions: ['Audit proof photos', 'Verify completed work'],
      },
      {
        id: 'audit-logs', title: 'Audit Logs', summary: 'A trail of important actions.',
        mock: 'list', mockRows: ['Who', 'What', 'When'],
        actions: ['Trace key actions', 'Investigate issues'],
      },
      {
        id: 'system-health', title: 'System Health', summary: 'Service status and errors.',
        mock: 'dashboard', mockRows: ['Services', 'Errors', 'Latency'],
        actions: ['Monitor system status', 'Catch problems early'],
      },
      {
        id: 'notifications-health', title: 'Notifications Health', summary: 'Delivery status of notifications.',
        mock: 'dashboard', mockRows: ['Sent', 'Delivered', 'Failed'],
        actions: ['Check notification delivery', 'Spot failures'],
      },
    ],
  },
  {
    key: 'super-admin',
    name: 'Super Admin',
    tagline: 'Full control & data tools',
    world: 'admin',
    icon: Crown,
    color: C.red,
    colorDim: C.redDim,
    overview:
      'Super admins get everything admins have plus deep platform controls, analytics, support tooling and a data manager for the whole system.',
    screens: [
      {
        id: 'index', title: 'Super Admin Home', summary: 'The master control dashboard.',
        mock: 'dashboard', mockRows: ['Platform metrics', 'Alerts', 'Shortcuts'],
        actions: ['Oversee the entire platform', 'Jump to any tool'],
      },
      {
        id: 'analytics', title: 'Analytics', summary: 'Deep platform analytics and trends.',
        mock: 'dashboard', mockRows: ['Growth', 'Revenue', 'Activity'],
        actions: ['Explore trends', 'Track KPIs'],
      },
      {
        id: 'controls', title: 'Controls', summary: 'Powerful platform-wide switches.',
        mock: 'form', mockRows: ['Feature flags', 'Limits', 'Maintenance'], mockCta: 'Apply',
        actions: ['Flip feature flags', 'Set platform limits'],
      },
      {
        id: 'data-manager', title: 'Data Manager', summary: 'Inspect and manage raw data.',
        mock: 'list', mockRows: ['Tables', 'Records', 'Export'],
        actions: ['Browse data tables', 'Export records'],
      },
      {
        id: 'support', title: 'Support', summary: 'Support threads from users.',
        mock: 'chat', mockRows: ['Open ticket', 'Reply', 'Resolve'],
        actions: ['Answer support requests', 'Resolve tickets'],
      },
      {
        id: 'companies', title: 'Companies', summary: 'Manage every company.',
        mock: 'list', mockRows: ['Company', 'Status', 'Verify'],
        actions: ['Verify and edit companies', 'Handle escalations'],
      },
      {
        id: 'users', title: 'Users', summary: 'Manage every user.',
        mock: 'list', mockRows: ['User', 'Role', 'Actions'],
        actions: ['Manage user accounts', 'Adjust roles'],
      },
    ],
  },
];

/** Shared screens every signed-in user can reach. */
export const SHARED_HELP: ScreenDoc[] = [
  {
    id: 'messages', title: 'Messages', summary: 'Chat with anyone you’re working with on a job, load or shift.',
    mock: 'chat', mockRows: ['Conversations', 'Load chat', 'Support'],
    actions: ['Start a conversation from a load or shift', 'Reply in real-time', 'Reach support'],
  },
  {
    id: 'notifications', title: 'Notifications', summary: 'Updates about your loads, shifts, bookings and payments.',
    mock: 'list', mockRows: ['New', 'Earlier', 'Preferences'],
    actions: ['Stay on top of activity', 'Tune what you get notified about'],
  },
  {
    id: 'assistant', title: 'AI Assistant', summary: 'Ask the assistant anything about how the app works.',
    mock: 'chat', mockRows: ['Ask a question', 'Get an answer', 'Suggestions'],
    actions: ['Ask how to do something', 'Get role-specific guidance'],
  },
  {
    id: 'reviews', title: 'Reviews', summary: 'Ratings and reviews you’ve given and received.',
    mock: 'list', mockRows: ['Received', 'Given', 'Rating'],
    actions: ['Leave a review after a job', 'Build your reputation'],
  },
];

export function getRoleDoc(key: string): RoleDoc | undefined {
  return HELP_ROLES.find((r) => r.key === key);
}

/**
 * Resolves the in-app route for a given role + screen so the manual can deep-link
 * straight to the real screen. Screen ids match the route file names per role folder,
 * and `index` maps to the role root.
 */
export function getScreenRoute(roleKey: string, screenId: string): string {
  return screenId === 'index' ? `/${roleKey}` : `/${roleKey}/${screenId}`;
}

/** Maps an auth UserRole to the matching manual key, when one exists. */
export const ROLE_TO_HELP_KEY: Record<string, string> = {
  Shipper: 'shipper',
  Driver: 'driver',
  TruckingCompany: 'trucking-company',
  Customer: 'customer',
  WarehouseProvider: 'warehouse-provider',
  ServiceProvider: 'service-provider',
  GateStaff: 'gate-staff',
  Employer: 'employer',
  Worker: 'worker',
  Admin: 'admin',
  SuperAdmin: 'super-admin',
};

/** Icons exported for reuse in the UI. */
export const HELP_ICONS = { Boxes, HardHat, PackageOpen, Warehouse, Wrench, Truck, Send, PackageCheck };
