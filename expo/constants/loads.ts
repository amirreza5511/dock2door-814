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

export type DeliverySpeed = 'SameDay' | 'NextDay';

export const LOAD_STATUS_FLOW: Record<string, { label: string; next: string } | undefined> = {
  Accepted: { label: 'Start trip', next: 'EnRoute' },
  EnRoute: { label: 'Mark arrived', next: 'Arrived' },
  Arrived: { label: 'Mark delivered', next: 'Delivered' },
};
