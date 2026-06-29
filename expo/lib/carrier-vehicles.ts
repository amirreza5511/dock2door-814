import { supabase } from '@/lib/supabase';
import type { VehicleType } from '@/constants/loads';

/**
 * Owner-operator's registered vehicle type(s), stored on their profile.
 *
 * Backed by `profiles.carrier_vehicle_types` (a load_vehicle_type[] column) and
 * the SECURITY DEFINER `set_carrier_vehicles` RPC — both added in migration 0084.
 * The vehicle selection drives which loads an owner-operator sees in the
 * marketplace (they never see loads requiring a bigger truck than they own).
 */
const VALID = new Set<VehicleType>([
  'Bicycle', 'Motorcycle', 'Car', 'Pickup', 'MovingTruck', 'FiveTon', 'FlatDeck', 'Semi',
]);

function clean(types: VehicleType[]): VehicleType[] {
  return Array.from(new Set(types.filter((v) => VALID.has(v))));
}

/** Read the vehicle types the given user has registered. */
export async function getCarrierVehicles(userId: string): Promise<VehicleType[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('carrier_vehicle_types')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (data?.carrier_vehicle_types as unknown) ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is VehicleType => typeof v === 'string' && VALID.has(v as VehicleType));
}

/** Persist the vehicle types for the current authenticated owner-operator. */
export async function setCarrierVehicles(userId: string, types: VehicleType[]): Promise<VehicleType[]> {
  if (!userId) throw new Error('Not authenticated');
  const next = clean(types);
  const { error } = await supabase.rpc('set_carrier_vehicles', { p_types: next });
  if (error) throw new Error(error.message);
  return next;
}
