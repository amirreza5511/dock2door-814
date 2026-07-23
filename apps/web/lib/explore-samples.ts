/**
 * Sample fixtures used only in Explore mode (guest browsing without an account),
 * mirroring the mobile app's `expo/lib/exploreSamples.ts`. These make each role
 * dashboard look full and alive without hitting the backend as an anon user.
 *
 * Row shapes mirror what each web dashboard's query returns, so a component can
 * swap `q.data` for the sample array when `isExploring` is true.
 */

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

export const EXPLORE_COMPANY_ID = "explore-company";
export const EXPLORE_USER_ID = "explore-user";

/** Shipper dashboard — mirrors LoadRow rows from useMyPostedLoads. */
export const SAMPLE_SHIPPER_LOADS = [
  {
    id: "ex-load-1", vehicle_type: "cargo_van", cargo_type: "general", pallets: 4, status: "EnRoute",
    pickup_address: "Vancouver, BC", pickup_city: "Vancouver", dropoff_address: "Burnaby, BC", dropoff_city: "Burnaby",
    distance_km: 18, total_price: 240, created_at: hoursFromNow(-6),
  },
  {
    id: "ex-load-2", vehicle_type: "five_ton", cargo_type: "palletized", pallets: 10, status: "Open",
    pickup_address: "Richmond, BC", pickup_city: "Richmond", dropoff_address: "Surrey, BC", dropoff_city: "Surrey",
    distance_km: 32, total_price: 520, created_at: hoursFromNow(-2),
  },
  {
    id: "ex-load-3", vehicle_type: "sprinter", cargo_type: "fragile", pallets: 2, status: "Delivered",
    pickup_address: "Delta, BC", pickup_city: "Delta", dropoff_address: "North Vancouver, BC", dropoff_city: "North Vancouver",
    distance_km: 41, total_price: 310, created_at: hoursFromNow(-30),
  },
  {
    id: "ex-load-4", vehicle_type: "reefer", cargo_type: "refrigerated", pallets: 8, status: "Accepted",
    pickup_address: "Abbotsford, BC", pickup_city: "Abbotsford", dropoff_address: "Vancouver, BC", dropoff_city: "Vancouver",
    distance_km: 68, total_price: 890, created_at: hoursFromNow(-10),
  },
] as const;

/** Trucking company loads board — open loads a carrier can accept. */
export const SAMPLE_CARRIER_LOADS = [
  {
    id: "ex-cl-1", vehicle_type: "five_ton", cargo_type: "palletized", pallets: 10, status: "Open",
    pickup_address: "Richmond, BC", dropoff_address: "Surrey, BC", distance_km: 32,
    total_price: 520, freight_price: 470, created_at: hoursFromNow(-2),
  },
  {
    id: "ex-cl-2", vehicle_type: "reefer", cargo_type: "refrigerated", pallets: 8, status: "Open",
    pickup_address: "Abbotsford, BC", dropoff_address: "Vancouver, BC", distance_km: 68,
    total_price: 890, freight_price: 820, created_at: hoursFromNow(-1),
  },
  {
    id: "ex-cl-3", vehicle_type: "cube_van", cargo_type: "general", pallets: 5, status: "Open",
    pickup_address: "Coquitlam, BC", dropoff_address: "Langley, BC", distance_km: 44,
    total_price: 610, freight_price: 560, created_at: hoursFromNow(-4),
  },
] as const;

/** Employer shifts — mirrors shift_posts rows. */
export const SAMPLE_EMPLOYER_SHIFTS = [
  { id: "ex-sp-1", title: "Warehouse Loader", category: "general_labour", status: "Posted", date: dateStr(0), start_time: "08:00", end_time: "16:00", hourly_rate: 24, workers_needed: 3, location_city: "Vancouver", requirements: null, created_at: hoursFromNow(-20) },
  { id: "ex-sp-2", title: "Forklift Operator", category: "forklift", status: "Posted", date: dateStr(1), start_time: "07:00", end_time: "15:00", hourly_rate: 31, workers_needed: 2, location_city: "Richmond", requirements: "Forklift cert", created_at: hoursFromNow(-10) },
  { id: "ex-sp-3", title: "Order Picker (evening)", category: "general_labour", status: "Posted", date: dateStr(2), start_time: "16:00", end_time: "23:00", hourly_rate: 26, workers_needed: 4, location_city: "Surrey", requirements: null, created_at: hoursFromNow(-5) },
  { id: "ex-sp-5", title: "Reach Truck Operator", category: "forklift", status: "Filled", date: dateStr(3), start_time: "06:00", end_time: "14:00", hourly_rate: 33, workers_needed: 1, location_city: "Burnaby", requirements: "Reach cert", created_at: hoursFromNow(-52) },
  { id: "ex-sp-6", title: "Inventory Counter (weekend)", category: "general_labour", status: "Posted", date: dateStr(4), start_time: "09:00", end_time: "17:00", hourly_rate: 23, workers_needed: 6, location_city: "Vancouver", requirements: null, created_at: hoursFromNow(-3) },
] as const;

/** Employer applications. */
export const SAMPLE_EMPLOYER_APPLICATIONS = [
  { id: "ex-app-1", shift_id: "ex-sp-1", worker_user_id: "ex-w-1", status: "Applied", applied_at: hoursFromNow(-4), shift_title: "Warehouse Loader", worker_name: "Marcus Lee" },
  { id: "ex-app-2", shift_id: "ex-sp-2", worker_user_id: "ex-w-3", status: "Applied", applied_at: hoursFromNow(-3), shift_title: "Forklift Operator", worker_name: "Dan Kowalski" },
  { id: "ex-app-3", shift_id: "ex-sp-3", worker_user_id: "ex-w-2", status: "Accepted", applied_at: hoursFromNow(-8), shift_title: "Order Picker (evening)", worker_name: "Priya Sharma" },
] as const;

/** Worker — browsable open shifts. */
export const SAMPLE_WORKER_SHIFTS = [
  { id: "ex-sp-1", title: "Warehouse Loader", category: "general_labour", status: "Posted", date: dateStr(0), start_time: "08:00", end_time: "16:00", hourly_rate: 24, location_city: "Vancouver", company_name: "Preview Logistics Co.", created_at: hoursFromNow(-20) },
  { id: "ex-sp-2", title: "Forklift Operator", category: "forklift", status: "Posted", date: dateStr(1), start_time: "07:00", end_time: "15:00", hourly_rate: 31, location_city: "Richmond", company_name: "Preview Logistics Co.", created_at: hoursFromNow(-10) },
  { id: "ex-sp-4", title: "Dock Hand", category: "general_labour", status: "Posted", date: dateStr(1), start_time: "09:00", end_time: "17:00", hourly_rate: 25, location_city: "Burnaby", company_name: "Harbour Freight Ltd.", created_at: hoursFromNow(-8) },
] as const;

/** Warehouse bookings — customer & warehouse provider. */
export const SAMPLE_WAREHOUSE_BOOKINGS = [
  { id: "ex-wb-1", reference_number: "WH-20481", pallets_requested: 40, start_date: dateStr(-5), end_date: dateStr(25), proposed_price: 1280, final_price: 1280, status: "Active", payment_status: "Paid", cargo_description: "Retail furniture, palletized", created_at: hoursFromNow(-140) },
  { id: "ex-wb-2", reference_number: "WH-20502", pallets_requested: 18, start_date: dateStr(2), end_date: dateStr(32), proposed_price: 1044, counter_offer_price: 980, status: "Requested", payment_status: "Pending", cargo_description: "Frozen seafood", created_at: hoursFromNow(-18) },
  { id: "ex-wb-3", reference_number: "WH-20460", pallets_requested: 60, start_date: dateStr(-30), end_date: dateStr(-2), proposed_price: 2700, final_price: 2700, status: "Completed", payment_status: "Paid", cargo_description: "Chilled beverages", created_at: hoursFromNow(-760) },
] as const;

/** Warehouse listings. */
export const SAMPLE_WAREHOUSE_LISTINGS = [
  { id: "ex-wl-1", name: "Annacis Island Distribution", city: "Delta", warehouse_type: "Dry", available_pallet_capacity: 420, storage_rate_per_pallet: 3.2, status: "Published" },
  { id: "ex-wl-2", name: "Riverside Cold Storage", city: "Richmond", warehouse_type: "Frozen", available_pallet_capacity: 180, storage_rate_per_pallet: 5.8, status: "Published" },
  { id: "ex-wl-3", name: "Metro Fulfilment Hub", city: "Vancouver", warehouse_type: "Chilled", available_pallet_capacity: 260, storage_rate_per_pallet: 4.5, status: "Published" },
] as const;

/** Service listings — rental / repair / insurance / customs. */
export const SAMPLE_SERVICE_LISTINGS = [
  { id: "ex-sl-1", service_type: "rental", category: "equipment_rental", title: "Operated Crane — 20t", description: "Operated mobile crane for lifts, by the day or half day.", coverage_area: ["Surrey", "Langley", "Delta"], hourly_rate: 220, daily_rate: 1500, status: "Published", created_at: hoursFromNow(-300) },
  { id: "ex-sl-2", service_type: "repair", category: "mobile_repair", title: "Mobile Reefer & Trailer Repair", description: "On-site reefer, trailer and forklift repair technicians, 24/7.", coverage_area: ["Vancouver", "Burnaby", "Richmond"], hourly_rate: 145, status: "Published", created_at: hoursFromNow(-220) },
  { id: "ex-sl-3", service_type: "insurance", category: "cargo_insurance", title: "Per-Shipment Cargo Cover", description: "Freight cargo insurance, per-shipment or annual.", coverage_area: ["Vancouver", "Toronto", "Calgary"], hourly_rate: 0, status: "Published", created_at: hoursFromNow(-160) },
  { id: "ex-sl-4", service_type: "service", category: "customs_brokerage", title: "Customs Clearance (Import/Export)", description: "PARS/PAPS, HS classification, duty & tax remittance.", coverage_area: ["Delta", "Vancouver"], hourly_rate: 120, status: "Published", created_at: hoursFromNow(-90) },
] as const;

/** Service jobs / bookings. */
export const SAMPLE_SERVICE_JOBS = [
  { id: "ex-sj-1", title: "Operated Crane — 20t", location_city: "Surrey", date_time_start: daysFromNow(1, 8), duration_hours: 4, total_price: 880, status: "Confirmed", payment_status: "Held", created_at: hoursFromNow(-26) },
  { id: "ex-sj-2", title: "Mobile Reefer & Trailer Repair", location_city: "Burnaby", date_time_start: hoursFromNow(3), duration_hours: 3, total_price: 435, status: "Requested", payment_status: "Pending", created_at: hoursFromNow(-4) },
  { id: "ex-sj-3", title: "Customs Clearance", location_city: "Delta", date_time_start: hoursFromNow(-40), duration_hours: 1, total_price: 175, status: "Completed", payment_status: "Paid", created_at: hoursFromNow(-96) },
] as const;

/** Container orders — freight forwarder / customer drayage. */
export const SAMPLE_CONTAINER_ORDERS = [
  { id: "ex-ord-1", reference_code: "DRY-10428", direction: "Import", status: "Assigned", container_number: "MSKU7841200", container_size: "40ft", container_type: "Standard", commodity: "Furniture", port_reservation_date: daysFromNow(1, 10), created_at: hoursFromNow(-40) },
  { id: "ex-ord-2", reference_code: "DRY-10455", direction: "Export", status: "Open", container_number: "TCLU9930411", container_size: "20ft", container_type: "Standard", commodity: "Machinery parts", port_reservation_date: daysFromNow(2, 9), created_at: hoursFromNow(-12) },
  { id: "ex-ord-3", reference_code: "DRY-10390", direction: "Import", status: "Delivered", container_number: "HLBU1122334", container_size: "40ft", container_type: "Reefer", commodity: "Produce", port_reservation_date: hoursFromNow(-60), created_at: hoursFromNow(-96) },
] as const;

/** Drayage company dashboard aggregates. */
export const SAMPLE_DRAYAGE_DASHBOARD = {
  openOrders: [
    { id: "ex-av-1", reference_code: "DRY-10461", direction: "Import", status: "Open", container_number: "CMAU5510012", container_size: "40ft", commodity: "Electronics", created_at: hoursFromNow(-3) },
    { id: "ex-av-2", reference_code: "DRY-10467", direction: "Export", status: "Open", container_number: "OOLU2213445", container_size: "20ft", commodity: "Lumber", created_at: hoursFromNow(-1) },
    { id: "ex-av-3", reference_code: "DRY-10470", direction: "Import", status: "Open", container_number: "MSCU8890021", container_size: "40HC", commodity: "Apparel", created_at: hoursFromNow(-5) },
  ],
  myOrders: [
    { id: "ex-ord-1", reference_code: "DRY-10428", direction: "Import", status: "Assigned", container_number: "MSKU7841200", container_size: "40ft", commodity: "Furniture", created_at: hoursFromNow(-40) },
    { id: "ex-ord-2", reference_code: "DRY-10455", direction: "Export", status: "EnRoute", container_number: "TCLU9930411", container_size: "20ft", commodity: "Machinery parts", created_at: hoursFromNow(-12) },
  ],
  drivers: [
    { id: "ex-dr-1", name: "Marcus L." },
    { id: "ex-dr-2", name: "Priya S." },
    { id: "ex-dr-3", name: "Dan K." },
  ],
} as const;

/** Global Freight — importer/exporter quote requests. */
export const SAMPLE_FREIGHT_QUOTES = [
  { id: "ex-fq-1", reference_code: "FRT-40188", title: "Shanghai → Vancouver, 2×40HQ", freight_mode: "fcl", origin_country: "China", origin_city: "Shanghai", dest_country: "Canada", dest_city: "Vancouver", weight: 24000, weight_unit: "kg", pieces: 2, currency: "CAD", status: "Quoted", offer_count: 4, ground_offer_count: 0, awarded_amount: 0, needs_container_pickup: true, created_at: hoursFromNow(-30) },
  { id: "ex-fq-2", reference_code: "FRT-40204", title: "Frankfurt → Toronto, 800kg", freight_mode: "air", origin_country: "Germany", origin_city: "Frankfurt", dest_country: "Canada", dest_city: "Toronto", weight: 800, weight_unit: "kg", pieces: 6, currency: "CAD", status: "Open", offer_count: 1, ground_offer_count: 0, awarded_amount: 0, needs_container_pickup: false, created_at: hoursFromNow(-6) },
  { id: "ex-fq-3", reference_code: "FRT-40150", title: "LA → Seattle, 1 truckload", freight_mode: "truck", origin_country: "USA", origin_city: "Los Angeles", dest_country: "USA", dest_city: "Seattle", weight: 12000, weight_unit: "kg", pieces: 20, currency: "USD", status: "Accepted", offer_count: 6, ground_offer_count: 3, awarded_amount: 2400, needs_container_pickup: false, created_at: hoursFromNow(-72) },
] as const;

/** Ground freight loads (LTL & FTL Quotes world). */
export const SAMPLE_GROUND_LOADS = [
  { id: "ex-gl-1", reference_code: "FRT-30188", title: "FTL — Toronto → Montreal", freight_mode: "fcl", origin_city: "Toronto", origin_country: "Canada", dest_city: "Montreal", dest_country: "Canada", weight: 12000, weight_unit: "kg", pieces: 24, currency: "CAD", status: "Quoted", offer_count: 5, ground_offer_count: 5, awarded_amount: 0, needs_container_pickup: false, created_at: hoursFromNow(-20) },
  { id: "ex-gl-2", reference_code: "FRT-30204", title: "LTL — Vancouver → Calgary", freight_mode: "truck", origin_city: "Vancouver", origin_country: "Canada", dest_city: "Calgary", dest_country: "Canada", weight: 1800, weight_unit: "kg", pieces: 3, currency: "CAD", status: "Open", offer_count: 2, ground_offer_count: 2, awarded_amount: 0, needs_container_pickup: false, created_at: hoursFromNow(-8) },
  { id: "ex-gl-3", reference_code: "FRT-30150", title: "LCL — Seattle → Surrey (+ final-mile)", freight_mode: "lcl", origin_city: "Seattle", origin_country: "USA", dest_city: "Surrey", dest_country: "Canada", weight: 900, weight_unit: "kg", pieces: 6, currency: "CAD", status: "Accepted", offer_count: 7, ground_offer_count: 7, awarded_amount: 1240, needs_container_pickup: true, created_at: hoursFromNow(-50) },
] as const;

/** Customs broker — clearance requests. */
export const SAMPLE_CLEARANCE_REQUESTS = [
  { id: "ex-cb-1", reference_code: "CLR-8801", status: "Pending", direction: "Import", commodity: "Electronics", customer_name: "Preview Logistics Co.", declared_value: 42000, currency: "CAD", created_at: hoursFromNow(-8) },
  { id: "ex-cb-2", reference_code: "CLR-8794", status: "InReview", direction: "Import", commodity: "Furniture", customer_name: "Harbour Freight Ltd.", declared_value: 18500, currency: "CAD", created_at: hoursFromNow(-30) },
  { id: "ex-cb-3", reference_code: "CLR-8760", status: "Cleared", direction: "Export", commodity: "Machinery parts", customer_name: "Annacis Island Distribution", declared_value: 96000, currency: "CAD", created_at: hoursFromNow(-120) },
] as const;

/** Driver jobs / trips. */
export const SAMPLE_DRIVER_JOBS = [
  { id: "ex-job-1", status: "EnRoute", appointment_type: "Delivery", scheduled_start: hoursFromNow(1), dock_door: "7", driver_name: "You (preview)", truck_plate: "BC 4821 KP", pallet_count: 10 },
  { id: "ex-job-2", status: "Scheduled", appointment_type: "Pickup", scheduled_start: hoursFromNow(4), dock_door: null, truck_plate: "BC 4821 KP", pallet_count: 6 },
  { id: "ex-job-3", status: "Scheduled", appointment_type: "Delivery", scheduled_start: daysFromNow(1, 8), dock_door: "3", truck_plate: "BC 4821 KP", pallet_count: 12 },
  { id: "ex-job-4", status: "Completed", appointment_type: "Delivery", scheduled_start: hoursFromNow(-5), dock_door: "2", truck_plate: "BC 4821 KP", pallet_count: 8 },
] as const;

/** Trucking company dashboard aggregates. */
export const SAMPLE_TRUCKING_DASHBOARD = {
  appointments: [
    { id: "ex-ap-1", driver_name: "Marcus L.", truck_plate: "BC 4821 KP", appointment_type: "Delivery", pallet_count: 10, status: "EnRoute", scheduled_start: hoursFromNow(1) },
    { id: "ex-ap-2", driver_name: "Priya S.", truck_plate: "BC 9930 TR", appointment_type: "Pickup", pallet_count: 6, status: "Scheduled", scheduled_start: hoursFromNow(3) },
    { id: "ex-ap-3", driver_name: "Dan K.", truck_plate: "BC 1177 QX", appointment_type: "Delivery", pallet_count: 12, status: "AtDoor", scheduled_start: hoursFromNow(-1) },
    { id: "ex-ap-4", driver_name: "Unassigned", truck_plate: null, appointment_type: "Delivery", pallet_count: 8, status: "Scheduled", scheduled_start: daysFromNow(1, 8) },
  ],
  drivers: [
    { id: "ex-dr-1", name: "Marcus L.", license_number: "Class 1 · Ready" },
    { id: "ex-dr-2", name: "Priya S.", license_number: "Class 1 · On trip" },
    { id: "ex-dr-3", name: "Dan K.", license_number: "Class 3 · Ready" },
  ],
  trucks: [
    { id: "ex-tk-1", plate: "BC 4821 KP" },
    { id: "ex-tk-2", plate: "BC 9930 TR" },
    { id: "ex-tk-3", plate: "BC 1177 QX" },
  ],
} as const;
