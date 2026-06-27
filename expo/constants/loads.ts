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

export type DeliverySpeed = 'SameDay' | 'NextDay';

export const LOAD_STATUS_FLOW: Record<string, { label: string; next: string } | undefined> = {
  Accepted: { label: 'Start trip', next: 'EnRoute' },
  EnRoute: { label: 'Mark arrived', next: 'Arrived' },
  Arrived: { label: 'Mark delivered', next: 'Delivered' },
};
