/**
 * Universal provider pricing configuration.
 *
 * One generic rate-card system (migration 0116) powers every vertical. This file
 * describes, per vertical, how the shared Rates screen and pricing card should be
 * labelled and which accessorial line items a brand-new card is seeded with.
 *
 * accessorial `type`:
 *   'flat'    — a fixed fee added once when selected
 *   'perUnit' — amount × quantity (e.g. per extra stop, per container)
 *   'perHour' — amount × hours
 *   'pct'     — a percentage of the base rate (e.g. fuel surcharge)
 */
export type AccessorialType = 'flat' | 'perUnit' | 'perHour' | 'pct';

export type Accessorial = {
  key: string;
  label: string;
  amount: number;
  type: AccessorialType;
};

export type PricingVertical =
  | 'warehouse'
  | 'trucking'
  | 'labor'
  | 'service'
  | 'forwarding';

export type VerticalConfig = {
  vertical: PricingVertical;
  title: string;
  subtitle: string;
  /** Label for the "zone" concept in this vertical. */
  zoneLabel: string;
  zoneLabelPlural: string;
  zonePlaceholder: string;
  zoneHint: string;
  /** Default unit the base rate is measured in. */
  baseUnit: string;
  /** Line items a new card is seeded with. */
  defaultAccessorials: Accessorial[];
};

export const PRICING_VERTICALS: Record<PricingVertical, VerticalConfig> = {
  warehouse: {
    vertical: 'warehouse',
    title: 'Rates & Zones',
    subtitle: 'Publish storage pricing so customers see the charge',
    zoneLabel: 'Space zone',
    zoneLabelPlural: 'Space zones',
    zonePlaceholder: 'e.g. Ambient — front dock',
    zoneHint: "Add zones like 'Ambient', 'Cold storage' or 'Front dock' to price space by area.",
    baseUnit: 'per pallet / day',
    defaultAccessorials: [
      { key: 'offload_20', label: "Offload 20' container", amount: 0, type: 'flat' },
      { key: 'offload_40', label: "Offload 40' container", amount: 0, type: 'flat' },
      { key: 'gate_fee', label: 'Gate fee', amount: 0, type: 'flat' },
      { key: 'labour', label: 'Labour (per hour)', amount: 0, type: 'perHour' },
      { key: 'receiving', label: 'Receiving fee', amount: 0, type: 'flat' },
      { key: 'special_handling', label: 'Special handling', amount: 0, type: 'flat' },
    ],
  },
  trucking: {
    vertical: 'trucking',
    title: 'Rates & Lanes',
    subtitle: 'Publish lane pricing so shippers see the charge',
    zoneLabel: 'Lane',
    zoneLabelPlural: 'Lanes',
    zonePlaceholder: 'e.g. Vancouver → Calgary',
    zoneHint: "Add lanes (origin → destination) to price hauls by route.",
    baseUnit: 'per load',
    defaultAccessorials: [
      { key: 'fuel', label: 'Fuel surcharge', amount: 0, type: 'pct' },
      { key: 'per_mile', label: 'Per mile', amount: 0, type: 'perUnit' },
      { key: 'detention', label: 'Detention (per hour)', amount: 0, type: 'perHour' },
      { key: 'extra_stop', label: 'Extra stop', amount: 0, type: 'perUnit' },
      { key: 'layover', label: 'Layover', amount: 0, type: 'flat' },
    ],
  },
  labor: {
    vertical: 'labor',
    title: 'Labor Rates',
    subtitle: 'Publish labor pricing so clients see the charge',
    zoneLabel: 'Worker category',
    zoneLabelPlural: 'Worker categories',
    zonePlaceholder: 'e.g. General labourer',
    zoneHint: "Add categories like 'General labourer', 'Forklift operator' or 'Lead' to price by skill.",
    baseUnit: 'per hour',
    defaultAccessorials: [
      { key: 'overtime', label: 'Overtime (per hour)', amount: 0, type: 'perHour' },
      { key: 'doubletime', label: 'Double-time (per hour)', amount: 0, type: 'perHour' },
      { key: 'callout', label: 'Call-out fee', amount: 0, type: 'flat' },
      { key: 'min_hours', label: 'Minimum hours top-up', amount: 0, type: 'flat' },
    ],
  },
  service: {
    vertical: 'service',
    title: 'Service Rates',
    subtitle: 'Publish service pricing so customers see the charge',
    zoneLabel: 'Service / area',
    zoneLabelPlural: 'Services & areas',
    zonePlaceholder: 'e.g. Container repair — Metro',
    zoneHint: "Add a row per service type or coverage area to set its base rate.",
    baseUnit: 'per service',
    defaultAccessorials: [
      { key: 'hourly', label: 'Hourly rate', amount: 0, type: 'perHour' },
      { key: 'rush', label: 'Rush fee', amount: 0, type: 'flat' },
      { key: 'after_hours', label: 'After-hours', amount: 0, type: 'flat' },
      { key: 'materials', label: 'Materials', amount: 0, type: 'flat' },
    ],
  },
  forwarding: {
    vertical: 'forwarding',
    title: 'Forwarding Rates',
    subtitle: 'Publish your all-in pricing so customers see the charge',
    zoneLabel: 'Trade lane',
    zoneLabelPlural: 'Trade lanes',
    zonePlaceholder: 'e.g. Shanghai → Vancouver',
    zoneHint: "Add trade lanes to set a base handling rate per route.",
    baseUnit: 'per shipment',
    defaultAccessorials: [
      { key: 'markup', label: 'Margin / markup', amount: 0, type: 'pct' },
      { key: 'documentation', label: 'Documentation', amount: 0, type: 'flat' },
      { key: 'customs', label: 'Customs clearance', amount: 0, type: 'flat' },
      { key: 'handling', label: 'Handling', amount: 0, type: 'flat' },
    ],
  },
};
