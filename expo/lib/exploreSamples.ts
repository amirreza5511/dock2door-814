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
    { id: EXPLORE_COMPANY_ID, name: 'Preview Logistics Co.', type: 'Employer', address: '120 Industrial Ave', city: 'Vancouver', status: 'Approved', created_at: hoursFromNow(-800) },
    { id: 'ex-co-2', name: 'Harbour Freight Ltd.', type: 'Employer', address: '20 Port Rd', city: 'Burnaby', status: 'Approved', created_at: hoursFromNow(-900) },
    { id: 'ex-co-3', name: 'Fraser Valley Staffing', type: 'Agency', address: '77 Sumas Way', city: 'Abbotsford', status: 'Approved', created_at: hoursFromNow(-1200) },
    { id: 'ex-co-4', name: 'Annacis Island Distribution', type: 'WarehouseProvider', address: '9200 River Rd', city: 'Delta', status: 'Approved', created_at: hoursFromNow(-1500) },
  ],
  shift_posts: [
    { id: 'ex-sp-1', employer_company_id: EXPLORE_COMPANY_ID, title: 'Warehouse Loader', category: 'general_labour', location_address: '120 Industrial Ave', location_city: 'Vancouver', date: dateStr(0), start_time: '08:00', end_time: '16:00', hourly_rate: 24, minimum_hours: 4, workers_needed: 3, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-20) },
    { id: 'ex-sp-2', employer_company_id: EXPLORE_COMPANY_ID, title: 'Forklift Operator', category: 'forklift', location_address: '55 Dock Rd', location_city: 'Richmond', date: dateStr(1), start_time: '07:00', end_time: '15:00', hourly_rate: 31, minimum_hours: 6, workers_needed: 2, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-10) },
    { id: 'ex-sp-3', employer_company_id: EXPLORE_COMPANY_ID, title: 'Order Picker (evening)', category: 'general_labour', location_address: '900 Cargo Way', location_city: 'Surrey', date: dateStr(2), start_time: '16:00', end_time: '23:00', hourly_rate: 26, minimum_hours: 5, workers_needed: 4, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-5) },
    { id: 'ex-sp-4', employer_company_id: 'ex-co-2', title: 'Dock Hand', category: 'general_labour', location_address: '20 Port Rd', location_city: 'Burnaby', date: dateStr(1), start_time: '09:00', end_time: '17:00', hourly_rate: 25, minimum_hours: 4, workers_needed: 2, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-8) },
    { id: 'ex-sp-5', employer_company_id: 'ex-co-2', title: 'Reach Truck Operator', category: 'forklift', location_address: '18 Glenlyon Pkwy', location_city: 'Burnaby', date: dateStr(3), start_time: '06:00', end_time: '14:00', hourly_rate: 33, minimum_hours: 8, workers_needed: 1, status: 'Filled', is_ongoing: false, created_at: hoursFromNow(-52) },
    { id: 'ex-sp-6', employer_company_id: EXPLORE_COMPANY_ID, title: 'Inventory Counter (weekend)', category: 'general_labour', location_address: '120 Industrial Ave', location_city: 'Vancouver', date: dateStr(4), start_time: '09:00', end_time: '17:00', hourly_rate: 23, minimum_hours: 6, workers_needed: 6, status: 'Posted', is_ongoing: false, created_at: hoursFromNow(-3) },
    { id: 'ex-sp-7', employer_company_id: 'ex-co-4', title: 'Shipping/Receiving Clerk', category: 'general_labour', location_address: '9200 River Rd', location_city: 'Delta', date: dateStr(2), start_time: '08:00', end_time: '16:30', hourly_rate: 28, minimum_hours: 8, workers_needed: 2, status: 'Posted', is_ongoing: true, created_at: hoursFromNow(-14) },
  ],
  worker_profiles: [
    { id: 'ex-wp-1', user_id: 'ex-w-1', display_name: 'Marcus Lee', skills: ['forklift', 'general_labour'], coverage_cities: ['Vancouver', 'Burnaby'], hourly_expectation: 26, verified: true, status: 'Active', bio: 'Certified forklift operator, 5 yrs.', created_at: hoursFromNow(-500) },
    { id: 'ex-wp-2', user_id: 'ex-w-2', display_name: 'Priya Sharma', skills: ['general_labour', 'picker'], coverage_cities: ['Richmond', 'Surrey'], hourly_expectation: 24, verified: true, status: 'Active', bio: 'Fast, reliable order picker.', created_at: hoursFromNow(-450) },
    { id: 'ex-wp-3', user_id: 'ex-w-3', display_name: 'Dan Kowalski', skills: ['forklift', 'reach_truck', 'general_labour'], coverage_cities: ['Delta', 'Surrey', 'Langley'], hourly_expectation: 30, verified: true, status: 'Active', bio: 'Reach & counterbalance certified, night shifts.', created_at: hoursFromNow(-380) },
    { id: 'ex-wp-4', user_id: 'ex-w-4', display_name: 'Aisha Rahman', skills: ['general_labour', 'picker', 'packer'], coverage_cities: ['Vancouver', 'Richmond'], hourly_expectation: 23, verified: false, status: 'Active', bio: 'Available weekends and evenings.', created_at: hoursFromNow(-120) },
    { id: 'ex-wp-5', user_id: 'ex-w-5', display_name: 'Tomas Silva', skills: ['general_labour', 'loader'], coverage_cities: ['Burnaby', 'Coquitlam'], hourly_expectation: 25, verified: true, status: 'Active', bio: 'Heavy loading, WHMIS certified.', created_at: hoursFromNow(-260) },
  ],
  worker_certifications: [
    { id: 'ex-wc-1', worker_user_id: 'ex-w-1', type: 'Forklift', expiry_date: dateStr(280), status: 'Approved', created_at: hoursFromNow(-480) },
    { id: 'ex-wc-2', worker_user_id: 'ex-w-1', type: 'WHMIS', expiry_date: dateStr(120), status: 'Approved', created_at: hoursFromNow(-480) },
    { id: 'ex-wc-3', worker_user_id: 'ex-w-3', type: 'Forklift', expiry_date: dateStr(60), status: 'Approved', created_at: hoursFromNow(-360) },
    { id: 'ex-wc-4', worker_user_id: 'ex-w-4', type: 'WHMIS', expiry_date: dateStr(-10), status: 'Pending', created_at: hoursFromNow(-90) },
  ],
} as const;

/** Warehouse bookings — customer & warehouse provider dashboards. */
export const SAMPLE_WAREHOUSE_BOOKINGS = [
  { id: 'ex-wb-1', reference_number: 'WH-20481', listing_id: 'ex-wl-1', customer_company_id: EXPLORE_COMPANY_ID, pallets_requested: 40, start_date: dateStr(-5), end_date: dateStr(25), handling_required: true, proposed_price: 1280, final_price: 1280, status: 'Active', payment_status: 'Paid', transport_mode: 'delivery', cargo_description: 'Retail furniture, palletized', declared_pieces: 40, declared_weight_kg: 8200, created_at: hoursFromNow(-140) },
  { id: 'ex-wb-2', reference_number: 'WH-20502', listing_id: 'ex-wl-2', customer_company_id: EXPLORE_COMPANY_ID, pallets_requested: 18, start_date: dateStr(2), end_date: dateStr(32), handling_required: true, proposed_price: 1044, counter_offer_price: 980, status: 'Requested', payment_status: 'Pending', transport_mode: 'unspecified', cargo_description: 'Frozen seafood', declared_pieces: 18, declared_weight_kg: 5400, created_at: hoursFromNow(-18) },
  { id: 'ex-wb-3', reference_number: 'WH-20460', listing_id: 'ex-wl-3', customer_company_id: 'ex-co-2', pallets_requested: 60, start_date: dateStr(-30), end_date: dateStr(-2), handling_required: false, proposed_price: 2700, final_price: 2700, status: 'Completed', payment_status: 'Paid', transport_mode: 'pickup', cargo_description: 'Chilled beverages', declared_pieces: 60, declared_weight_kg: 14000, created_at: hoursFromNow(-760) },
] as const;

/** Service listings — services marketplace (rental / repair / insurance / customs). */
export const SAMPLE_SERVICE_LISTINGS = [
  { id: 'ex-sl-1', company_id: 'ex-co-2', service_type: 'rental', category: 'equipment_rental', title: 'Operated Crane — 20t', description: 'Operated mobile crane for lifts, by the day or half day.', coverage_area: ['Surrey', 'Langley', 'Delta'], hourly_rate: 220, daily_rate: 1500, minimum_hours: 4, status: 'Published', negotiable: true, created_at: hoursFromNow(-300) },
  { id: 'ex-sl-2', company_id: EXPLORE_COMPANY_ID, service_type: 'repair', category: 'mobile_repair', title: 'Mobile Reefer & Trailer Repair', description: 'On-site reefer, trailer and forklift repair technicians, 24/7.', coverage_area: ['Vancouver', 'Burnaby', 'Richmond'], hourly_rate: 145, minimum_hours: 2, status: 'Published', negotiable: false, created_at: hoursFromNow(-220) },
  { id: 'ex-sl-3', company_id: 'ex-co-4', service_type: 'insurance', category: 'cargo_insurance', title: 'Per-Shipment Cargo Cover', description: 'Freight cargo insurance, per-shipment or annual.', coverage_area: ['Vancouver', 'Toronto', 'Calgary'], hourly_rate: 0, cargo_rate_percent: 0.9, min_premium: 85, minimum_hours: 1, status: 'Published', negotiable: true, created_at: hoursFromNow(-160) },
  { id: 'ex-sl-4', company_id: 'ex-co-4', service_type: 'service', category: 'customs_brokerage', title: 'Customs Clearance (Import/Export)', description: 'PARS/PAPS, HS classification, duty & tax remittance.', coverage_area: ['Delta', 'Vancouver'], hourly_rate: 120, per_job_rate: 175, minimum_hours: 1, status: 'Published', negotiable: false, created_at: hoursFromNow(-90) },
] as const;

/** Service jobs / bookings — provider & customer marketplace views. */
export const SAMPLE_SERVICE_JOBS = [
  { id: 'ex-sj-1', service_id: 'ex-sl-1', customer_company_id: EXPLORE_COMPANY_ID, provider_company_id: 'ex-co-2', location_address: '900 Cargo Way', location_city: 'Surrey', date_time_start: daysFromNow(1, 8), duration_hours: 4, total_price: 880, status: 'Confirmed', payment_status: 'Held', quote_status: 'accepted', quoted_amount: 880, created_at: hoursFromNow(-26) },
  { id: 'ex-sj-2', service_id: 'ex-sl-2', customer_company_id: 'ex-co-2', provider_company_id: EXPLORE_COMPANY_ID, location_address: '20 Port Rd', location_city: 'Burnaby', date_time_start: hoursFromNow(3), duration_hours: 3, total_price: 435, status: 'Requested', payment_status: 'Pending', quote_status: 'sent', quoted_amount: 435, created_at: hoursFromNow(-4) },
  { id: 'ex-sj-3', service_id: 'ex-sl-4', customer_company_id: EXPLORE_COMPANY_ID, provider_company_id: 'ex-co-4', location_address: '9200 River Rd', location_city: 'Delta', date_time_start: hoursFromNow(-40), duration_hours: 1, total_price: 175, status: 'Completed', payment_status: 'Paid', customer_confirmed: true, quote_status: 'accepted', quoted_amount: 175, created_at: hoursFromNow(-96) },
] as const;

/** Payments / earnings — finance widgets across dashboards. */
export const SAMPLE_PAYMENTS = [
  { id: 'ex-pay-1', reference_type: 'load', reference_id: 'ex-load-3', gross_amount: 310, commission_amount: 31, net_amount: 279, status: 'Paid', created_at: hoursFromNow(-28) },
  { id: 'ex-pay-2', reference_type: 'warehouse_booking', reference_id: 'ex-wb-1', gross_amount: 1280, commission_amount: 128, net_amount: 1152, status: 'Paid', created_at: hoursFromNow(-138) },
  { id: 'ex-pay-3', reference_type: 'service_job', reference_id: 'ex-sj-3', gross_amount: 175, commission_amount: 17.5, net_amount: 157.5, status: 'Paid', created_at: hoursFromNow(-94) },
  { id: 'ex-pay-4', reference_type: 'load', reference_id: 'ex-load-1', gross_amount: 240, commission_amount: 24, net_amount: 216, status: 'Pending', created_at: hoursFromNow(-5) },
] as const;

/** Messages — inbox previews shown in explore mode. */
export const SAMPLE_MESSAGES = [
  { id: 'ex-msg-1', reference_type: 'load', reference_id: 'ex-load-2', sender_user_id: 'ex-dr-1', text: 'On my way to pickup, ETA 20 min.', created_at: hoursFromNow(-1) },
  { id: 'ex-msg-2', reference_type: 'warehouse_booking', reference_id: 'ex-wb-2', sender_user_id: 'ex-co-2', text: 'Can you do $980 for the 30 days?', created_at: hoursFromNow(-2) },
  { id: 'ex-msg-3', reference_type: 'service_job', reference_id: 'ex-sj-2', sender_user_id: EXPLORE_USER_ID, text: 'Technician confirmed for 3pm.', created_at: hoursFromNow(-3) },
] as const;

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

/**
 * Ground freight loads (LTL & FTL Quotes world) — trpc.freight.mine filtered to
 * truck/fcl/lcl modes. Shape mirrors the FreightRequest row the ground hub renders.
 */
export const SAMPLE_GROUND_LOADS = [
  {
    id: 'ex-gl-1', reference_code: 'FRT-30188', title: 'FTL — Toronto → Montreal',
    freight_mode: 'fcl' as const, origin_city: 'Toronto', origin_country: 'Canada',
    dest_city: 'Montreal', dest_country: 'Canada', weight: 12000, weight_unit: 'kg',
    pieces: 24, currency: 'CAD', status: 'Quoted' as const, offer_count: 5, awarded_amount: 0,
  },
  {
    id: 'ex-gl-2', reference_code: 'FRT-30204', title: 'LTL — Vancouver → Calgary',
    freight_mode: 'truck' as const, origin_city: 'Vancouver', origin_country: 'Canada',
    dest_city: 'Calgary', dest_country: 'Canada', weight: 1800, weight_unit: 'kg',
    pieces: 3, currency: 'CAD', status: 'Open' as const, offer_count: 2, awarded_amount: 0,
  },
  {
    id: 'ex-gl-3', reference_code: 'FRT-30150', title: 'LCL — Seattle → Surrey (+ final-mile)',
    freight_mode: 'lcl' as const, origin_city: 'Seattle', origin_country: 'USA',
    dest_city: 'Surrey', dest_country: 'Canada', weight: 900, weight_unit: 'kg',
    pieces: 6, currency: 'CAD', status: 'Accepted' as const, offer_count: 7, awarded_amount: 1240,
  },
] as const;

/**
 * Ocean container requests (Ocean Booking) — trpc.ocean.mine shape. Used to
 * populate the ocean screen in Explore mode so guests see a realistic board.
 */
export const SAMPLE_OCEAN_REQUESTS = [
  {
    id: 'ex-oc-1', title: 'Furniture — Vancouver → Jebel Ali',
    origin_country: 'Canada', origin_port: 'Vancouver', dest_country: 'UAE', dest_port: 'Jebel Ali',
    container_size: '40ft', cargo_type: 'Furniture', weight: 8200, weight_unit: 'kg',
    ready_date: null, incoterms: 'FOB', currency: 'CAD', notes: '', status: 'Open',
    awarded_amount: 0, awarded_name: '', offer_count: 4, created_at: hoursFromNow(-30),
    dest_hub_city: '', dest_hub_is_member: false,
  },
  {
    id: 'ex-oc-2', title: 'Machinery — Shanghai → Toronto',
    origin_country: 'China', origin_port: 'Shanghai', dest_country: 'Canada', dest_port: 'Toronto',
    container_size: 'LCL', cargo_type: 'Machinery parts', weight: 1400, weight_unit: 'kg',
    ready_date: null, incoterms: 'CIF', currency: 'CAD', notes: '', status: 'Accepted',
    awarded_amount: 3180, awarded_name: 'PacificLine Forwarding', offer_count: 6, created_at: hoursFromNow(-72),
    dest_hub_city: 'Toronto', dest_hub_is_member: true,
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
  { id: 'dir-c11', name: 'Pars Freight Ways', domain: 'globalfreight', roleLabel: 'Freight Forwarder', city: 'Toronto, ON', rating: 4.8, reviews: 143, verified: true, blurb: '1M+ sq ft food-grade warehousing, 120-truck fleet, worldwide forwarding.' },
  { id: 'dir-c12', name: 'Maple Leaf LTL', domain: 'freight', roleLabel: 'Fleet / Carrier', city: 'Calgary, AB', rating: 4.5, reviews: 118, verified: true, blurb: 'Less-than-truckload specialists, daily lanes across Western Canada.' },
  { id: 'dir-c13', name: 'Last Mile Couriers', domain: 'freight', roleLabel: 'Owner-Operator', city: 'Vancouver, BC', rating: 4.7, reviews: 205, verified: true, blurb: 'Same-day final-mile parcel & pallet delivery to the door.' },
  { id: 'dir-c14', name: 'Pacific Gateway Warehousing', domain: 'logistics', roleLabel: 'Warehouse Provider', city: 'Surrey, BC', rating: 4.6, reviews: 71, verified: true, blurb: 'Bonded & general storage, fulfillment and cross-dock.' },
  { id: 'dir-c15', name: 'TransCanada Carriers', domain: 'freight', roleLabel: 'Fleet / Carrier', city: 'Mississauga, ON', rating: 4.4, reviews: 260, verified: true, blurb: 'FTL dry van & reefer, cross-country lanes, EDI tracking.' },
  { id: 'dir-c16', name: 'Skyline Air Cargo', domain: 'globalfreight', roleLabel: 'Carrier / Airline', city: 'Toronto, ON', rating: 4.5, reviews: 66, verified: true, blurb: 'Consolidated & express air freight, worldwide gateways.' },
  { id: 'dir-c17', name: 'Harbour Bridge Staffing', domain: 'labour', roleLabel: 'Employment Agency', city: 'Vancouver, BC', rating: 4.2, reviews: 54, verified: false, blurb: 'On-demand forklift, picker and dock crews.' },
  { id: 'dir-c18', name: 'ProLift Equipment', domain: 'marketplace', roleLabel: 'Equipment Rental', city: 'Delta, BC', rating: 4.6, reviews: 47, verified: true, blurb: 'Forklifts, reach trucks and scissor lifts, delivered.' },
];

export const SAMPLE_DIRECTORY_JOBS: DirectoryJob[] = [
  { id: 'dir-j1', title: 'Forklift Operator', domain: 'labour', company: 'Preview Logistics Co.', city: 'Richmond, BC', pay: '$31/hr', when: 'Tomorrow · 7am–3pm', tag: 'Shift' },
  { id: 'dir-j2', title: 'Warehouse Loader', domain: 'labour', company: 'Preview Logistics Co.', city: 'Vancouver, BC', pay: '$24/hr', when: 'Today · 8am–4pm', tag: 'Shift' },
  { id: 'dir-j9', title: 'Order Picker (evening)', domain: 'labour', company: 'Annacis Island Distribution', city: 'Delta, BC', pay: '$26/hr', when: 'Today · 4pm–11pm', tag: 'Shift' },
  { id: 'dir-j10', title: 'Reach Truck Operator', domain: 'labour', company: 'Harbour Freight Ltd.', city: 'Burnaby, BC', pay: '$33/hr', when: 'Fri · 6am–2pm', tag: 'Shift' },
  { id: 'dir-j8', title: 'Crane lift — 20t, half day', domain: 'marketplace', company: 'Buyer request', city: 'Surrey, BC', pay: 'Quote', when: 'This week', tag: 'Service' },
  { id: 'dir-j11', title: 'Mobile reefer repair — on-site', domain: 'marketplace', company: 'Buyer request', city: 'Burnaby, BC', pay: 'Quote', when: 'Today', tag: 'Service' },
  { id: 'dir-j12', title: 'Customs clearance — import', domain: 'drayage', company: 'Buyer request', city: 'Delta, BC', pay: 'Quote', when: 'This week', tag: 'Service' },
];

/** Open freight loads shown in the public directory (separate from jobs). */
export const SAMPLE_DIRECTORY_LOADS: DirectoryJob[] = [
  { id: 'dir-l3', title: 'FTL: Richmond → Surrey, 10 pallets', domain: 'freight', company: 'Open load', city: 'Richmond, BC', pay: '$520', when: 'Open now', tag: 'FTL' },
  { id: 'dir-l4', title: 'Reefer: Abbotsford → Vancouver', domain: 'freight', company: 'Open load', city: 'Abbotsford, BC', pay: '$890', when: 'Open now', tag: 'Reefer' },
  { id: 'dir-l13', title: 'LTL: 3 pallets, Vancouver → Calgary', domain: 'freight', company: 'Open load', city: 'Vancouver, BC', pay: '$430', when: 'Open now', tag: 'LTL' },
  { id: 'dir-l14', title: 'Final-mile: 12 parcels, Surrey routes', domain: 'freight', company: 'Open load', city: 'Surrey, BC', pay: '$310', when: 'Today', tag: 'Final-mile' },
  { id: 'dir-l5', title: 'Import 40HQ pickup — Vanterm', domain: 'drayage', company: 'DRY-10461', city: 'Vancouver, BC', pay: 'Quote', when: 'Open now', tag: 'Container' },
  { id: 'dir-l15', title: 'Export 20ft drop — Deltaport', domain: 'drayage', company: 'DRY-10467', city: 'Delta, BC', pay: 'Quote', when: 'Open now', tag: 'Container' },
  { id: 'dir-l6', title: 'Ocean FCL: Shanghai → Vancouver', domain: 'globalfreight', company: 'Quote request', city: 'Shanghai, CN', pay: '4 quotes', when: '2 days ago', tag: 'Ocean' },
  { id: 'dir-l16', title: 'Ocean LCL: Ningbo → Toronto, 6 CBM', domain: 'globalfreight', company: 'Quote request', city: 'Ningbo, CN', pay: '2 quotes', when: '1 day ago', tag: 'LCL' },
  { id: 'dir-l7', title: 'Air: Frankfurt → Toronto, 800kg', domain: 'globalfreight', company: 'Quote request', city: 'Frankfurt, DE', pay: '1 quote', when: '6h ago', tag: 'Air' },
];
