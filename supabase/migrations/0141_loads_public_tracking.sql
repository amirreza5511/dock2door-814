-- Dock2Door — Public tracking links for accountless receivers
-- ==========================================================================
-- Shippers can share a shipment with a receiver who has no account. Each load
-- gets a secure, hard-to-guess track_token. A SECURITY DEFINER read returns
-- only tracking-safe fields for a given token (no prices, no account data).
--
-- Also adds receiver_email (receiver_phone already exists as recipient_phone)
-- and a helper for the shipper to update the receiver contact after posting.
--
-- Idempotent + additive. Safe to run in order after 0140.
-- ==========================================================================

-- 1) Columns ---------------------------------------------------------------
alter table public.loads add column if not exists track_token   text;
alter table public.loads add column if not exists receiver_email text not null default '';

-- Backfill a token for every existing load that lacks one.
update public.loads
   set track_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where track_token is null;

-- New loads get a token automatically.
alter table public.loads
  alter column track_token set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

create unique index if not exists idx_loads_track_token on public.loads(track_token);

-- 2) Public read -----------------------------------------------------------
-- Returns a tracking-safe view of a single load identified by its token.
-- SECURITY DEFINER so an unauthenticated receiver can call it; it only ever
-- exposes the one row whose token matches, and only the safe columns.
create or replace function public.public_track_load(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_driver_name text;
  v_driver_phone text;
begin
  if coalesce(p_token, '') = '' then return null; end if;

  select * into v_load from public.loads where track_token = p_token limit 1;
  if v_load is null then return null; end if;

  -- Resolve driver display name + phone (best-effort) so the receiver can call.
  v_driver_name := nullif(v_load.driver_name, '');
  if v_load.accepted_driver_user_id is not null then
    begin
      select nullif(u.phone, '') into v_driver_phone
      from auth.users u where u.id = v_load.accepted_driver_user_id limit 1;
    exception when others then
      v_driver_phone := null;
    end;
  end if;

  return json_build_object(
    'id',                v_load.id,
    'track_token',       v_load.track_token,
    'status',            v_load.status,
    'vehicle_type',      v_load.vehicle_type,
    'cargo_type',        v_load.cargo_type,
    'item_description',  v_load.item_description,
    'pickup_lat',        v_load.pickup_lat,
    'pickup_lng',        v_load.pickup_lng,
    'pickup_address',    v_load.pickup_address,
    'pickup_city',       v_load.pickup_city,
    'dropoff_lat',       v_load.dropoff_lat,
    'dropoff_lng',       v_load.dropoff_lng,
    'dropoff_address',   v_load.dropoff_address,
    'dropoff_city',      v_load.dropoff_city,
    'driver_lat',        v_load.driver_lat,
    'driver_lng',        v_load.driver_lng,
    'driver_location_at',v_load.driver_location_at,
    'driver_name',       v_driver_name,
    'driver_phone',      v_driver_phone,
    'distance_km',       v_load.distance_km,
    'recipient_name',    v_load.recipient_name,
    'picked_up_at',      v_load.picked_up_at,
    'delivered_at',      v_load.delivered_at,
    'receiver_name',     v_load.receiver_name
  );
end;
$$;

grant execute on function public.public_track_load(text) to anon, authenticated;

-- 3) Shipper updates the receiver contact after posting --------------------
create or replace function public.set_receiver_contact(
  p_load_id uuid,
  p_phone   text default null,
  p_email   text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  if not (v_load.poster_user_id = auth.uid()
          or (v_load.poster_company_id is not null and public.is_member_of(v_load.poster_company_id))
          or public.is_admin()) then
    raise exception 'not authorized for this load' using errcode = '42501';
  end if;

  update public.loads set
    recipient_phone = coalesce(p_phone, recipient_phone),
    receiver_email  = coalesce(p_email, receiver_email),
    updated_at = now()
  where id = p_load_id;
end;
$$;

grant execute on function public.set_receiver_contact(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
