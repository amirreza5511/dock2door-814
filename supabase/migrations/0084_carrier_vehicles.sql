-- Dock2Door — Owner-operator vehicle registry
-- Idempotent. An owner-operator declares which vehicle type(s) they own. The
-- driver marketplace then defaults to loads that match their own truck(s) and
-- never shows loads requiring a larger vehicle than they actually own.

-- =========================================================================
-- 1) OWNED VEHICLE TYPES ON THE PROFILE
-- =========================================================================
alter table public.profiles
  add column if not exists carrier_vehicle_types load_vehicle_type[] not null default '{}';

-- =========================================================================
-- 2) SELF-SERVICE RPC — an owner-operator sets their own owned vehicles.
--    SECURITY DEFINER so it works regardless of profile write RLS, but it can
--    only ever update the caller's own row.
-- =========================================================================
create or replace function public.set_carrier_vehicles(p_types load_vehicle_type[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  update public.profiles
    set carrier_vehicle_types = coalesce(p_types, '{}'),
        updated_at = now()
  where id = auth.uid();
end;
$$;
grant execute on function public.set_carrier_vehicles(load_vehicle_type[]) to authenticated;
