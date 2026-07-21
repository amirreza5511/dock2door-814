/**
 * Sample fixtures used only in Explore mode (guest browsing without an account).
 * These make each role dashboard look full and alive without hitting the backend.
 * Shapes mirror the tRPC query rows each dashboard consumes.
 */
import type { Domain } from '@/lib/access';

function daysFromNow(days: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function hoursFromNow(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function dateStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Stable synthetic company id used to attach sample data to the exploring guest. */
export const EXPLORE_COMPANY_ID = 'explore-company';
export const EXPLORE_USER_ID = 'explore-user';

/** Bootstrap fixtures for the Labour world (employer / worker / agency dashboards). */
export const SAMPLE_BOOTSTRAP = {
  companies: [
    { id: EXPLORE_COMPANY_ID, name: 'Preview Logistics Co.', type: 'Employer', address: '', city: 'Vancouver', status: 'Approved', created_at: hoursFromNow(-800) },
    { id: 'ex-co-2', name: 'Harbour Freight Ltd.', type: 'Employer', address: '', city: 'Burnaby', status: 'Approved', created_at: hoursFromNow(-900) },
  ],
  shift_posts: [
    { id: 'ex-sp-1', employer_company_id: EXPLORE_COMPANY_ID, title: 'Warehouse Loader', category: 'general_labour', location_address: '120 Industrial Ave', location_city: 'Vancouver', date: dateStr(0), start_time: '08:00', end_time: '16:00', hourly_rate: 24, minimum_hours: 4, workers_needed: 3, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-20) },
    { id: 'ex-sp-2', employer_company_id: EXPLORE_COMPANY_ID, title: 'Forklift Operator', category: 'forklift', location_address: '55 Dock Rd', location_city: 'Richmond', date: dateStr(1), start_time: '07:00', end_time: '15:00', hourly_rate: 31, minimum_hours: 6, workers_needed: 2, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-10) },
    { id: 'ex-sp-3', employer_company_id: EXPLORE_COMPANY_ID, title: 'Order Picker (evening)', category: 'general_labour', location_address: '900 Cargo Way', location_city: 'Surrey', date: dateStr(2), start_time: '16:00', end_time: '23:00', hourly_rate: 26, minimum_hours: 5, workers_needed: 4, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-5) },
    { id: 'ex-sp-4', employer_company_id: 'ex-co-2', title: 'Dock Hand', category: 'general_labour', location_address: '20 Port Rd', location_city: 'Burnaby', date: dateStr(1), start_time: '09:00', end_time: '17:00', hourly_rate: 25, minimum_hours: 4, workers_needed: 2, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-8) },
  ],
  worker_profiles: [
    { id: 'ex-wp-1', user_id: 'ex-w-1', display_name: 'Marcus Lee', skills: ['forklift', 'general_labour'], coverage_cities: ['Vancouver', 'Burnaby'], hourly_expectation: 26, verified: true, status: 'Active', bio: 'Certified forklift operator, 5 yrs.', created_at: hoursFromNow(-500) },
    { id: 'ex-wp-2', user_id: 'ex-w-2', display_name: 'Priya Sharma', skills: ['general_labour', 'picker'], coverage_cities: ['Richmond', 'Surrey'], hourly_expectation: 24, verified: true, status: 'Active', bio: 'Fast, reliable order picker.', created_at: hoursFromNow(-450) },
  ],
} as const;

/** Container orders — trpc.drayage.customerOrders (freight forwarder / customer drayage) */
export const SAMPLE_CONTAINER_ORDERS = [
  {
    id: 'ex-ord-1', reference_code: 'DRY-10428', direction: 'Import', status: 'Assigned',
    container_number: 'MSKU7841200', container_size: '40ft', container_type: 'Standard',
    commodity: 'Furniture', port_reservation_date: daysFromNow(1, 10), created_at: hoursFromNow(-40),
  },
  {
    id: 'ex-ord-2', reference_code: 'DRY-10455', direction: 'Export', status: 'Open',
    container_number: 'TCLU9930411', container_size: '20ft', container_type: 'Standard',
    commodity: 'Machinery parts', port_reservation_date: daysFromNow(2, 9), created_at: hoursFromNow(-12),
  },
  {
    id: 'ex-ord-3', reference_code: 'DRY-10390', direction: 'Import', status: 'Delivered',
    container_number: 'HLBU1122334', container_size: '40ft', container_type: 'Reefer',
    commodity: 'Produce', port_reservation_date: hoursFromNow(-60), created_at: hoursFromNow(-96),
  },
] as const;

/** Drayage company dashboard — trpc.drayage.dashboard */
export const SAMPLE_DRAYAGE_DASHBOARD = {
  openOrders: [
    { id: 'ex-av-1', reference_code: 'DRY-10461', direction: 'Import', status: 'Open', container_number: 'CMAU5510012', container_size: '40ft', commodity: 'Electronics', created_at: hoursFromNow(-3) },
    { id: 'ex-av-2', reference_code: 'DRY-10467', direction: 'Export', status: 'Open', container_number: 'OOLU2213445', container_size: '20ft', commodity: 'Lumber', created_at: hoursFromNow(-1) },
    { id: 'ex-av-3', reference_code: 'DRY-10470', direction: 'Import', status: 'Open', container_number: 'MSCU8890021', container_size: '40HC', commodity: 'Apparel', created_at: hoursFromNow(-5) },
  ],
  myOrders: [
    { id: 'ex-ord-1', reference_code: 'DRY-10428', direction: 'Import', status: 'Assigned', container_number: 'MSKU7841200', container_size: '40ft', commodity: 'Furniture', created_at: hoursFromNow(-40) },
    { id: 'ex-ord-2', reference_code: 'DRY-10455', direction: 'Export', status: 'EnRoute', container_number: 'TCLU9930411', container_size: '20ft', commodity: 'Machinery parts', created_at: hoursFromNow(-12) },
  ],
  activeMoves: [
    { id: 'ex-mv-1', reference_code: 'DRY-10455', status: 'EnRoute' },
  ],
  drivers: [
    { id: 'ex-dr-1', name: 'Marcus L.' },
    { id: 'ex-dr-2', name: 'Priya S.' },
    { id: 'ex-dr-3', name: 'Dan K.' },
  ],
} as const;

/** Global Freight — trpc.freight.mine (importer/exporter) */
export const SAMPLE_FREIGHT_QUOTES = [
  {
    id: 'ex-fq-1', title: 'Shanghai → Vancouver, 2×40HQ', mode: 'Ocean', status: 'Quoted',
    origin: 'Shanghai, CN', destination: 'Vancouver, CA', load_type: 'FCL',
    offer_count: 4, created_at: hoursFromNow(-30),
  },
  {
    id: 'ex-fq-2', title: 'Frankfurt → Toronto, 800kg', mode: 'Air', status: 'Open',
    origin: 'Frankfurt, DE', destination: 'Toronto, CA', load_type: 'LCL',
    offer_count: 1, created_at: hoursFromNow(-6),
  },
  {
    id: 'ex-fq-3', title: 'LA → Seattle, 1 truckload', mode: 'Truck', status: 'Accepted',
    origin: 'Los Angeles, US', destination: 'Seattle, US', load_type: 'FTL',
    offer_count: 6, created_at: hoursFromNow(-72),
  },
] as const;

/** Customer dashboard — warehouse & service bookings browse */
export const SAMPLE_WAREHOUSE_LISTINGS = [
  { id: 'ex-wl-1', company_id: 'ex-co-2', name: 'Annacis Island Distribution', city: 'Delta', warehouse_type: 'Dry', available_pallet_capacity: 420, storage_rate_per_pallet: 3.2, status: 'Published' },
  { id: 'ex-wl-2', company_id: 'ex-co-2', name: 'Riverside Cold Storage', city: 'Richmond', warehouse_type: 'Frozen', available_pallet_capacity: 180, storage_rate_per_pallet: 5.8, status: 'Published' },
  { id: 'ex-wl-3', company_id: EXPLORE_COMPANY_ID, name: 'Metro Fulfilment Hub', city: 'Vancouver', warehouse_type: 'Chilled', available_pallet_capacity: 260, storage_rate_per_pallet: 4.5, status: 'Published' },
] as const;

/** Shipper dashboard — trpc.loads.listPosted */
export const SAMPLE_SHIPPER_LOADS = [
  {
    id: 'ex-load-1', vehicle_type: 'cargo_van', cargo_type: 'general', pallets: 4, status: 'EnRoute',
    pickup_address: 'Vancouver, BC', dropoff_address: 'Burnaby, BC',
    distance_km: 18, total_price: 240, created_at: hoursFromNow(-6),
    uses_hub: false, driver_hold: true,
  },
  {
    id: 'ex-load-2', vehicle_type: 'five_ton', cargo_type: 'palletized', pallets: 10, status: 'Open',
    pickup_address: 'Richmond, BC', dropoff_address: 'Surrey, BC',
    distance_km: 32, total_price: 520, created_at: hoursFromNow(-2),
    uses_hub: true, hub_name: 'Dock2Door Hub — Annacis', hub_leg_status: 'Pending', handling_fee: 40, storage_per_day: 12,
  },
  {
    id: 'ex-load-3', vehicle_type: 'sprinter', cargo_type: 'fragile', pallets: 2, status: 'Delivered',
    pickup_address: 'Delta, BC', dropoff_address: 'North Vancouver, BC',
    distance_km: 41, total_price: 310, created_at: hoursFromNow(-30),
    uses_hub: false,
  },
  {
    id: 'ex-load-4', vehicle_type: 'reefer', cargo_type: 'refrigerated', pallets: 8, status: 'Accepted',
    pickup_address: 'Abbotsford, BC', dropoff_address: 'Vancouver, BC',
    distance_km: 68, total_price: 890, created_at: hoursFromNow(-10),
    uses_hub: false, driver_hold: false,
  },
] as const;

/** Driver dashboard — trpc.operations.driverJobs */
export const SAMPLE_DRIVER_JOBS = [
  {
    id: 'ex-job-1', status: 'EnRoute', appointment_type: 'Delivery', scheduled_start: hoursFromNow(1),
    dock_door: '7', driver_name: 'You (preview)', truck_plate: 'BC 4821 KP', pallet_count: 10,
    data: { eta_minutes: 22 },
  },
  {
    id: 'ex-job-2', status: 'Scheduled', appointment_type: 'Pickup', scheduled_start: hoursFromNow(4),
    dock_door: null, truck_plate: 'BC 4821 KP', pallet_count: 6, data: {},
  },
  {
    id: 'ex-job-3', status: 'Scheduled', appointment_type: 'Delivery', scheduled_start: daysFromNow(1, 8),
    dock_door: '3', truck_plate: 'BC 4821 KP', pallet_count: 12, data: {},
  },
  {
    id: 'ex-job-4', status: 'Completed', appointment_type: 'Delivery', scheduled_start: hoursFromNow(-5),
    dock_door: '2', truck_plate: 'BC 4821 KP', pallet_count: 8, data: { podFileId: 'ex-pod-1' },
  },
] as const;

/** Trucking company dashboard — trpc.operations.truckingDashboard */
export const SAMPLE_TRUCKING_DASHBOARD = {
  appointments: [
    { id: 'ex-ap-1', driver_name: 'Marcus L.', truck_plate: 'BC 4821 KP', appointment_type: 'Delivery', pallet_count: 10, status: 'EnRoute', scheduled_start: hoursFromNow(1) },
    { id: 'ex-ap-2', driver_name: 'Priya S.', truck_plate: 'BC 9930 TR', appointment_type: 'Pickup', pallet_count: 6, status: 'Scheduled', scheduled_start: hoursFromNow(3) },
    { id: 'ex-ap-3', driver_name: 'Dan K.', truck_plate: 'BC 1177 QX', appointment_type: 'Delivery', pallet_count: 12, status: 'AtDoor', scheduled_start: hoursFromNow(-1) },
    { id: 'ex-ap-4', driver_name: 'Unassigned', truck_plate: null, appointment_type: 'Delivery', pallet_count: 8, status: 'Scheduled', scheduled_start: daysFromNow(1, 8) },
  ],
  drivers: [
    { id: 'ex-dr-1', name: 'Marcus L.', license_number: 'Class 1 · Ready', data: { name: 'Marcus L.' } },
    { id: 'ex-dr-2', name: 'Priya S.', license_number: 'Class 1 · On trip', data: { name: 'Priya S.' } },
    { id: 'ex-dr-3', name: 'Dan K.', license_number: 'Class 3 · Ready', data: { name: 'Dan K.' } },
  ],
  trucks: [
    { id: 'ex-tk-1', plate: 'BC 4821 KP' },
    { id: 'ex-tk-2', plate: 'BC 9930 TR' },
    { id: 'ex-tk-3', plate: 'BC 1177 QX' },
  ],
} as const;

/** Trucking company loads board */
export const SAMPLE_CARRIER_LOADS = [
  {
    id: 'ex-cl-1', vehicle_type: 'five_ton', cargo_type: 'palletized', pallets: 10, status: 'Open',
    pickup_address: 'Richmond, BC', dropoff_address: 'Surrey, BC', distance_km: 32,
    total_price: 520, freight_price: 470, created_at: hoursFromNow(-2),
  },
  {
    id: 'ex-cl-2', vehicle_type: 'reefer', cargo_type: 'refrigerated', pallets: 8, status: 'Open',
    pickup_address: 'Abbotsford, BC', dropoff_address: 'Vancouver, BC', distance_km: 68,
    total_price: 890, freight_price: 820, created_at: hoursFromNow(-1),
  },
  {
    id: 'ex-cl-3', vehicle_type: 'cube_van', cargo_type: 'general', pallets: 5, status: 'Open',
    pickup_address: 'Coquitlam, BC', dropoff_address: 'Langley, BC', distance_km: 44,
    total_price: 610, freight_price: 560, created_at: hoursFromNow(-4),
  },
] as const;

/** A company shown in the public directory (browsable by everyone). */
export interface DirectoryCompany {
  id: string;
  name: string;
  domain: Domain;
  roleLabel: string;
  city: string;
  rating: number;
  reviews: number;
  verified: boolean;
  blurb: string;
}

/** A job / opportunity shown in the public directory. */
export interface DirectoryJob {
  id: string;
  title: string;
  domain: Domain;
  company: string;
  city: string;
  pay: string;
  when: string;
  tag: string;
}

export const SAMPLE_DIRECTORY_COMPANIES: DirectoryCompany[] = [
  { id: 'dir-c1', name: 'Annacis Island Distribution', domain: 'logistics', roleLabel: 'Warehouse Provider', city: 'Delta, BC', rating: 4.8, reviews: 126, verified: true, blurb: 'Dry & ambient storage, 420 pallet positions, cross-dock ready.' },
  { id: 'dir-c2', name: 'Riverside Cold Storage', domain: 'logistics', roleLabel: 'Warehouse Provider', city: 'Richmond, BC', rating: 4.7, reviews: 89, verified: true, blurb: 'Frozen & chilled 3PL with blast freezing and pick-pack.' },
  { id: 'dir-c3', name: 'Harbour Freight Ltd.', domain: 'freight', roleLabel: 'Fleet / Carrier', city: 'Burnaby, BC', rating: 4.6, reviews: 212, verified: true, blurb: 'Regional LTL & FTL fleet, 40 trucks, live tracking.' },
  { id: 'dir-c4', name: 'PacRim Drayage', domain: 'drayage', roleLabel: 'Drayage Company', city: 'Vancouver, BC', rating: 4.9, reviews: 74, verified: true, blurb: 'Port & rail container moves, bonded, 24/7 dispatch.' },
  { id: 'dir-c5', name: 'Meridian Global Forwarding', domain: 'globalfreight', roleLabel: 'Freight Forwarder', city: 'Toronto, ON', rating: 4.5, reviews: 158, verified: true, blurb: 'Air & ocean forwarding worldwide, customs & insurance.' },
  { id: 'dir-c6', name: 'WestCoast Crane & Rigging', domain: 'marketplace', roleLabel: 'Equipment Rental', city: 'Surrey, BC', rating: 4.7, reviews: 43, verified: false, blurb: 'Operated cranes, forklifts & lifts for hire by the day.' },
  { id: 'dir-c7', name: 'OnCall Mobile Repair', domain: 'marketplace', roleLabel: 'Mobile Repair', city: 'Langley, BC', rating: 4.4, reviews: 61, verified: true, blurb: 'On-site trailer, reefer & forklift repair technicians.' },
  { id: 'dir-c8', name: 'Fraser Valley Staffing', domain: 'labour', roleLabel: 'Employment Agency', city: 'Abbotsford, BC', rating: 4.3, reviews: 97, verified: true, blurb: 'Warehouse & general labour crews, same-day placement.' },
  { id: 'dir-c9', name: 'Delta Customs Brokers', domain: 'drayage', roleLabel: 'Customs Broker', city: 'Delta, BC', rating: 4.8, reviews: 52, verified: true, blurb: 'Import/export clearance, HS classification, PARS/PAPS.' },
  { id: 'dir-c10', name: 'Cascade Cargo Insurance', domain: 'marketplace', roleLabel: 'Cargo Insurer', city: 'Vancouver, BC', rating: 4.6, reviews: 38, verified: true, blurb: 'Per-shipment and annual freight cargo cover.' },
];

export const SAMPLE_DIRECTORY_JOBS: DirectoryJob[] = [
  { id: 'dir-j1', title: 'Forklift Operator', domain: 'labour', company: 'Preview Logistics Co.', city: 'Richmond, BC', pay: '$31/hr', when: 'Tomorrow · 7am–3pm', tag: 'Shift' },
  { id: 'dir-j2', title: 'Warehouse Loader', domain: 'labour', company: 'Preview Logistics Co.', city: 'Vancouver, BC', pay: '$24/hr', when: 'Today · 8am–4pm', tag: 'Shift' },
  { id: 'dir-j3', title: 'FTL: Richmond → Surrey, 10 pallets', domain: 'freight', company: 'Open load', city: 'Richmond, BC', pay: '$520', when: 'Open now', tag: 'Load' },
  { id: 'dir-j4', title: 'Reefer: Abbotsford → Vancouver', domain: 'freight', company: 'Open load', city: 'Abbotsford, BC', pay: '$890', when: 'Open now', tag: 'Load' },
  { id: 'dir-j5', title: 'Import 40HQ pickup — Vanterm', domain: 'drayage', company: 'DRY-10461', city: 'Vancouver, BC', pay: 'Quote', when: 'Open now', tag: 'Container' },
  { id: 'dir-j6', title: 'Ocean FCL: Shanghai → Vancouver', domain: 'globalfreight', company: 'Quote request', city: 'Shanghai, CN', pay: '4 quotes', when: '2 days ago', tag: 'Freight' },
  { id: 'dir-j7', title: 'Air: Frankfurt → Toronto, 800kg', domain: 'globalfreight', company: 'Quote request', city: 'Frankfurt, DE', pay: '1 quote', when: '6h ago', tag: 'Freight' },
  { id: 'dir-j8', title: 'Crane lift — 20t, half day', domain: 'marketplace', company: 'Buyer request', city: 'Surrey, BC', pay: 'Quote', when: 'This week', tag: 'Service' },
];
