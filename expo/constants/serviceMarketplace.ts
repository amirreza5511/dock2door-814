/**
 * Services Marketplace catalog — the single source of truth shared by phone and
 * web. Any company can publish a listing in one of three types (general service,
 * equipment rental, mobile repair) and any business user can browse and request.
 *
 * `service_type` values MUST match the DB check constraint in migration 0132.
 */

export type ServiceType = 'service' | 'equipment_rental' | 'mobile_repair' | 'cargo_insurance';

export interface ServiceTypeDef {
  id: ServiceType;
  label: string;
  /** Short description shown on the type selector. */
  blurb: string;
  /** lucide icon name to render (kept as a string so both platforms map it). */
  icon: 'Wrench' | 'Forklift' | 'Hammer' | 'ShieldCheck';
}

export const SERVICE_TYPES: ServiceTypeDef[] = [
  { id: 'service', label: 'Services', blurb: 'Labour, loading, cleaning & more', icon: 'Wrench' },
  { id: 'equipment_rental', label: 'Equipment Rental', blurb: 'Forklifts, cranes, lifts & gear', icon: 'Forklift' },
  { id: 'mobile_repair', label: 'Mobile Repair', blurb: 'On-site repair technicians', icon: 'Hammer' },
  { id: 'cargo_insurance', label: 'Cargo Insurance', blurb: 'Insure freight & shipments', icon: 'ShieldCheck' },
];

export interface SubcategoryDef {
  id: string;
  label: string;
}

/** Suggested subcategories per service type. Free-text is also allowed. */
export const SUBCATEGORIES: Record<ServiceType, SubcategoryDef[]> = {
  service: [
    { id: 'general_labour', label: 'General Labour' },
    { id: 'loading_unloading', label: 'Loading / Unloading' },
    { id: 'devanning', label: 'Container Devanning' },
    { id: 'pallet_rework', label: 'Pallet Rework' },
    { id: 'pallet_removal', label: 'Pallet Removal' },
    { id: 'garbage_removal', label: 'Garbage Removal' },
    { id: 'industrial_cleaning', label: 'Industrial Cleaning' },
    { id: 'local_truck', label: 'Local Truck' },
    { id: 'yard_jockey', label: 'Yard Jockey' },
    { id: 'inventory_count', label: 'Inventory / Cycle Count' },
  ],
  equipment_rental: [
    { id: 'forklift', label: 'Forklift' },
    { id: 'reach_truck', label: 'Reach Truck' },
    { id: 'pallet_jack', label: 'Electric Pallet Jack' },
    { id: 'order_picker', label: 'Order Picker' },
    { id: 'scissor_lift', label: 'Scissor Lift' },
    { id: 'boom_lift', label: 'Boom Lift' },
    { id: 'generator', label: 'Generator' },
    { id: 'pressure_washer', label: 'Pressure Washer' },
    { id: 'floor_scrubber', label: 'Floor Scrubber' },
    { id: 'dock_plate', label: 'Dock Plate / Ramp' },
    { id: 'shrink_wrapper', label: 'Shrink Wrapper' },
    { id: 'trailer', label: 'Trailer / Container' },
    { id: 'crane', label: 'Crane' },
    { id: 'hoist_winch', label: 'Hoist / Winch' },
  ],
  mobile_repair: [
    { id: 'forklift_repair', label: 'Forklift Repair' },
    { id: 'truck_trailer_repair', label: 'Truck / Trailer Repair' },
    { id: 'dock_door_repair', label: 'Dock Door / Leveler' },
    { id: 'reefer_repair', label: 'Refrigeration / Reefer' },
    { id: 'hvac', label: 'HVAC' },
    { id: 'electrical', label: 'Electrical' },
    { id: 'hydraulics', label: 'Hydraulics' },
    { id: 'tire_service', label: 'Tire Service' },
    { id: 'welding', label: 'Welding / Fabrication' },
    { id: 'racking_repair', label: 'Pallet Racking Repair' },
  ],
  cargo_insurance: [
    { id: 'import_export', label: 'Import / Export Cargo' },
    { id: 'domestic_transit', label: 'Domestic Transit' },
    { id: 'warehouse_storage', label: 'Warehouse / Storage' },
    { id: 'liability', label: 'Liability Coverage' },
    { id: 'all_risk', label: 'All-Risk Freight' },
    { id: 'high_value', label: 'High-Value / Specialty' },
  ],
};

const TYPE_LABEL: Record<ServiceType, string> = {
  service: 'Services',
  equipment_rental: 'Equipment Rental',
  mobile_repair: 'Mobile Repair',
  cargo_insurance: 'Cargo Insurance',
};

/** True when a listing type is priced as a percentage of cargo value. */
export function isInsuranceType(t: string | null | undefined): boolean {
  return t === 'cargo_insurance';
}

/** Human label for a service type. */
export function serviceTypeLabel(t: string | null | undefined): string {
  if (!t) return 'Services';
  return TYPE_LABEL[t as ServiceType] ?? 'Services';
}

const SUBCATEGORY_LABEL: Record<string, string> = Object.values(SUBCATEGORIES)
  .flat()
  .reduce((acc, s) => {
    acc[s.id] = s.label;
    return acc;
  }, {} as Record<string, string>);

/** Human label for a subcategory id. Falls back to the raw value. */
export function subcategoryLabel(id: string | null | undefined): string {
  if (!id) return '';
  return SUBCATEGORY_LABEL[id] ?? id;
}

/** Pricing unit labels used across the marketplace. */
export const RATE_UNITS = {
  hour: '/hr',
  day: '/day',
  week: '/wk',
} as const;
