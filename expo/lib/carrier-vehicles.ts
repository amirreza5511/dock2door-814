import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VehicleType } from '@/constants/loads';

/**
 * On-device store for an owner-operator's registered vehicle type(s).
 *
 * The freight schema migration that adds `profiles.carrier_vehicle_types` and the
 * `set_carrier_vehicles` RPC is not yet applied to the live database, so reading
 * or writing those would fail. The vehicle selection is a per-driver preference
 * that only drives client-side marketplace filtering, so we persist it locally —
 * scoped per user id — which works immediately and survives app restarts.
 */
const KEY_PREFIX = 'carrier-vehicles:';

const VALID = new Set<VehicleType>([
  'Bicycle', 'Motorcycle', 'Car', 'Pickup', 'MovingTruck', 'FiveTon', 'FlatDeck', 'Semi',
]);

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** Read the vehicle types the given user has registered. */
export async function getCarrierVehicles(userId: string): Promise<VehicleType[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is VehicleType => typeof v === 'string' && VALID.has(v as VehicleType));
  } catch {
    return [];
  }
}

/** Persist the vehicle types for the given user. */
export async function setCarrierVehicles(userId: string, types: VehicleType[]): Promise<VehicleType[]> {
  if (!userId) throw new Error('Not authenticated');
  const clean = Array.from(new Set(types.filter((v) => VALID.has(v))));
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(clean));
  return clean;
}
