/** Vehicle types for the freight load marketplace. Values match the
 *  `load_vehicle_type` enum in migration 0082. */
export type VehicleType =
  | 'Bicycle'
  | 'Motorcycle'
  | 'Car'
  | 'Pickup'
  | 'MovingTruck'
  | 'FiveTon'
  | 'FlatDeck'
  | 'Semi';

export interface VehicleOption {
  type: VehicleType;
  label: string;
  description: string;
  emoji: string;
}

export const VEHICLE_OPTIONS: VehicleOption[] = [
  { type: 'Bicycle', label: 'Bicycle', description: 'Tiny same-city parcels', emoji: '🚲' },
  { type: 'Motorcycle', label: 'Motorcycle', description: 'Documents, small packages', emoji: '🏍️' },
  { type: 'Car', label: 'Car', description: 'Small boxes, courier runs', emoji: '🚗' },
  { type: 'Pickup', label: 'Pickup truck', description: 'Furniture, small moves', emoji: '🛻' },
  { type: 'MovingTruck', label: 'Moving truck', description: 'Home / office moves', emoji: '🚚' },
  { type: 'FiveTon', label: '5-ton truck', description: 'Mid-size freight', emoji: '🚛' },
  { type: 'FlatDeck', label: 'Flat deck', description: 'Machinery, oversized', emoji: '🚧' },
  { type: 'Semi', label: 'Semi truck', description: 'Full long-haul truckloads', emoji: '🚖' },
];

export const VEHICLE_LABEL: Record<VehicleType, string> = VEHICLE_OPTIONS.reduce(
  (acc, v) => { acc[v.type] = v.label; return acc; },
  {} as Record<VehicleType, string>,
);

/** Vehicle size order, smallest → largest. Drives the marketplace logic:
 *  an owner-operator can serve loads sized for their own vehicle and anything
 *  smaller, but never anything larger than the biggest truck they own. */
export const VEHICLE_ORDER: VehicleType[] = [
  'Bicycle', 'Motorcycle', 'Car', 'Pickup', 'MovingTruck', 'FiveTon', 'FlatDeck', 'Semi',
];

export function vehicleRank(type: VehicleType): number {
  const i = VEHICLE_ORDER.indexOf(type);
  return i === -1 ? VEHICLE_ORDER.length : i;
}

/** All vehicle types strictly smaller than the operator's largest owned vehicle. */
export function smallerThanOwned(owned: VehicleType[]): VehicleType[] {
  if (owned.length === 0) return [];
  const maxRank = Math.max(...owned.map(vehicleRank));
  const ownedSet = new Set(owned);
  return VEHICLE_ORDER.filter((t) => vehicleRank(t) < maxRank && !ownedSet.has(t));
}

/** Cargo types for the freight marketplace. Values match the
 *  `load_cargo_type` enum in migration 0083. From a letter up to a full load. */
export type CargoType =
  | 'Envelope'
  | 'Box'
  | 'Pallet'
  | 'Crate'
  | 'Container'
  | 'FullLoad';

export interface CargoOption {
  type: CargoType;
  label: string;
  description: string;
  emoji: string;
  /** Vehicle we suggest when this cargo is picked. */
  suggestedVehicle: VehicleType;
  /** Whether item count (how many) makes sense for this cargo. */
  countable: boolean;
}

export const CARGO_OPTIONS: CargoOption[] = [
  { type: 'Envelope', label: 'Envelope / Letter', description: 'Documents, small packets', emoji: '✉️', suggestedVehicle: 'Motorcycle', countable: true },
  { type: 'Box', label: 'Box / Parcel', description: 'One or more boxes', emoji: '📦', suggestedVehicle: 'Car', countable: true },
  { type: 'Pallet', label: 'Pallet(s)', description: 'Palletised freight (LTL)', emoji: '🧱', suggestedVehicle: 'FiveTon', countable: true },
  { type: 'Crate', label: 'Crate', description: 'Wooden crate, machinery', emoji: '🗄️', suggestedVehicle: 'FlatDeck', countable: true },
  { type: 'Container', label: 'Container', description: '20ft / 40ft shipping container', emoji: '🚢', suggestedVehicle: 'FlatDeck', countable: true },
  { type: 'FullLoad', label: 'Full truckload', description: 'A whole truck, long-haul', emoji: '🚛', suggestedVehicle: 'Semi', countable: false },
];

export const CARGO_LABEL: Record<CargoType, string> = CARGO_OPTIONS.reduce(
  (acc, c) => { acc[c.type] = c.label; return acc; },
  {} as Record<CargoType, string>,
);

/** Cargo classes with default surcharge % (mirrors cargo_class_surcharges in
 *  migration 0139). The live % comes from the server; these are display fallbacks. */
export type CargoClass =
  | 'General'
  | 'Food'
  | 'Furniture'
  | 'NonStandardPallet'
  | 'Cigarettes'
  | 'Alcohol'
  | 'UnusualLoad'
  | 'Chemical'
  | 'Hazardous';

export interface CargoClassOption {
  cls: CargoClass;
  label: string;
  emoji: string;
  defaultPct: number;
  note: string;
  /** Sensitive classes get a highlighted warning banner. */
  sensitive?: boolean;
}

export const CARGO_CLASS_OPTIONS: CargoClassOption[] = [
  { cls: 'General', label: 'General cargo', emoji: '📦', defaultPct: 0, note: '' },
  { cls: 'Food', label: 'Food / Groceries', emoji: '🥫', defaultPct: 5, note: 'Perishable — keep the cold chain where required.' },
  { cls: 'Furniture', label: 'Furniture', emoji: '🛋️', defaultPct: 10, note: 'Bulky / blanket-wrap handling.' },
  { cls: 'NonStandardPallet', label: 'Non-standard pallet', emoji: '🧱', defaultPct: 12, note: 'Oversized or irregular pallet footprint.' },
  { cls: 'Cigarettes', label: 'Cigarettes / Tobacco', emoji: '🚬', defaultPct: 15, note: 'Excise-controlled — keep manifest & seals.', sensitive: true },
  { cls: 'Alcohol', label: 'Alcohol', emoji: '🍾', defaultPct: 20, note: 'Licensed goods — ID may be required on delivery.', sensitive: true },
  { cls: 'UnusualLoad', label: 'Unusual load', emoji: '🎯', defaultPct: 20, note: 'Special dimensions or handling.' },
  { cls: 'Chemical', label: 'Chemical', emoji: '⚗️', defaultPct: 25, note: 'Follow SDS handling & segregation rules.', sensitive: true },
  { cls: 'Hazardous', label: 'Hazardous / Dangerous', emoji: '☣️', defaultPct: 35, note: 'DG declaration & placards required.', sensitive: true },
];

export const CARGO_CLASS_LABEL: Record<CargoClass, string> = CARGO_CLASS_OPTIONS.reduce(
  (acc, c) => { acc[c.cls] = c.label; return acc; },
  {} as Record<CargoClass, string>,
);

export type DeliverySpeed = 'SameDay' | 'NextDay';

export const LOAD_STATUS_FLOW: Record<string, { label: string; next: string } | undefined> = {
  Accepted: { label: 'Start trip', next: 'EnRoute' },
  EnRoute: { label: 'Mark arrived', next: 'Arrived' },
  Arrived: { label: 'Mark delivered', next: 'Delivered' },
};
