-- Dock2Door — Bill of Lading (BOL) + transport mode for warehouse bookings
-- Lets the customer declare HOW the cargo arrives (our driver, self-delivery, or
-- a third-party carrier), capture carrier/driver/vehicle + cargo details, and
-- generate a printable / electronic Bill of Lading. Receiving already checks in
-- by the booking reference number (WB-XXXXXXXX), which doubles as the BOL number.
-- Idempotent.

-- =========================================================================
-- 1. Transport + BOL columns on warehouse_bookings
-- =========================================================================
alter table public.warehouse_bookings
  add column if not exists transport_mode text not null default 'unspecified',
  add column if not exists carrier_name text not null default '',
  add column if not exists driver_name text not null default '',
  add column if not exists vehicle_plate text not null default '',
  add column if not exists cargo_description text not null default '',
  add column if not exists declared_pieces integer,
  add column if not exists declared_weight_kg numeric,
  add column if not exists bol_issued_at timestamptz;

-- Constrain transport_mode to the known values (drop first so re-runs are safe).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'warehouse_bookings_transport_mode_chk'
  ) then
    alter table public.warehouse_bookings
      add constraint warehouse_bookings_transport_mode_chk
      check (transport_mode in ('unspecified', 'own_driver', 'self_delivery', 'third_party'));
  end if;
end $$;

-- =========================================================================
-- 2. Customer updates the transport declaration + issues the BOL
-- =========================================================================
create or replace function public.warehouse_booking_set_transport(
  p_booking_id uuid,
  p_transport_mode text default null,
  p_carrier_name text default null,
  p_driver_name text default null,
  p_vehicle_plate text default null,
  p_cargo_description text default null,
  p_declared_pieces integer default null,
  p_declared_weight_kg numeric default null,
  p_issue_bol boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.warehouse_bookings;
begin
  select * into v_booking from public.warehouse_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'Booking not found';
  end if;

  -- Only the owning customer company (or an admin) can edit the transport details.
  if not (public.is_member_of(v_booking.customer_company_id) or public.is_admin()) then
    raise exception 'You can only edit your own booking';
  end if;

  if p_transport_mode is not null
     and p_transport_mode not in ('unspecified', 'own_driver', 'self_delivery', 'third_party') then
    raise exception 'Invalid transport mode %', p_transport_mode;
  end if;

  update public.warehouse_bookings set
    transport_mode = coalesce(p_transport_mode, transport_mode),
    carrier_name = coalesce(p_carrier_name, carrier_name),
    driver_name = coalesce(p_driver_name, driver_name),
    vehicle_plate = coalesce(p_vehicle_plate, vehicle_plate),
    cargo_description = coalesce(p_cargo_description, cargo_description),
    declared_pieces = coalesce(p_declared_pieces, declared_pieces),
    declared_weight_kg = coalesce(p_declared_weight_kg, declared_weight_kg),
    bol_issued_at = case when p_issue_bol then coalesce(bol_issued_at, now()) else bol_issued_at end,
    updated_at = now()
  where id = p_booking_id
  returning * into v_booking;

  return to_jsonb(v_booking);
end; $$;
grant execute on function public.warehouse_booking_set_transport(uuid, text, text, text, text, text, integer, numeric, boolean) to authenticated;
