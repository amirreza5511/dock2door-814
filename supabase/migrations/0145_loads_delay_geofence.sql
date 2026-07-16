-- Dock2Door — Smart live view: delivery deadline + geofence auto-arrive
-- ==========================================================================
-- Adds a delivery deadline (for delay alerts), a drop-off arrival timestamp and
-- an on-site wait clock. Geofencing runs client-side (the driver app watches
-- GPS); when the driver enters the drop-off radius while EnRoute, it calls
-- geofence_arrive() which flips the load to Arrived, stamps arrived_at, and
-- fires the same arrival notifications as a manual advance. Additive.
-- ==========================================================================

alter table public.loads add column if not exists deadline_at timestamptz;
alter table public.loads add column if not exists arrived_at timestamptz;
alter table public.loads add column if not exists wait_started_at timestamptz;
alter table public.loads add column if not exists wait_minutes numeric;

-- Carrier / poster sets (or clears) the delivery deadline used for delay alerts.
create or replace function public.set_load_deadline(p_load_id uuid, p_deadline timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;
  if not (
    v_load.poster_user_id = auth.uid()
    or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or (v_load.poster_company_id is not null and public.is_member_of(v_load.poster_company_id))
    or public.is_admin()
  ) then
    raise exception 'not authorized to set the deadline' using errcode = '42501';
  end if;
  update public.loads set deadline_at = p_deadline, updated_at = now() where id = p_load_id;
end;
$$;
grant execute on function public.set_load_deadline(uuid, timestamptz) to authenticated;

-- Geofence auto-arrive: driver crossed into the drop-off radius while EnRoute.
-- Idempotent — a second call while already Arrived just no-ops.
create or replace function public.geofence_arrive(p_load_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_route text;
  v_receiver_uid uuid;
  v_phone_key text;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  if v_load.accepted_driver_user_id <> auth.uid() then
    raise exception 'not your load' using errcode = '42501';
  end if;

  -- Only auto-advance from EnRoute; ignore otherwise.
  if v_load.status <> 'EnRoute' then
    return false;
  end if;

  update public.loads
    set status = 'Arrived', arrived_at = now(), wait_started_at = now(), updated_at = now()
    where id = p_load_id;

  v_route := coalesce(nullif(v_load.pickup_city, ''), nullif(v_load.pickup_address, ''), 'pickup')
             || ' → '
             || coalesce(nullif(v_load.dropoff_city, ''), nullif(v_load.dropoff_address, ''), 'drop-off');

  -- Notify shipper.
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_load.poster_user_id, 'system', 'Driver arrived at drop-off 📍',
    'The driver auto-checked-in at the delivery location (' || v_route || ').', 'loads', p_load_id);

  -- Notify a registered receiver, matched by phone.
  v_phone_key := nullif(right(regexp_replace(coalesce(v_load.recipient_phone, ''), '\D', '', 'g'), 10), '');
  if v_phone_key is not null and length(v_phone_key) >= 7 then
    begin
      select u.id into v_receiver_uid from auth.users u
      where right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) = v_phone_key limit 1;
    exception when others then v_receiver_uid := null;
    end;
  end if;
  if v_receiver_uid is not null and v_receiver_uid <> v_load.poster_user_id then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    values (v_receiver_uid, 'system', 'Your driver has arrived 📍',
      'The driver is at the drop-off with your shipment.', 'loads', p_load_id);
  end if;

  perform public.write_audit('load.geofence_arrived', 'loads', p_load_id::text, null, '{}'::jsonb, '');
  return true;
end;
$$;
grant execute on function public.geofence_arrive(uuid) to authenticated;

notify pgrst, 'reload schema';
