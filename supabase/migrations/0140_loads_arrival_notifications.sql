-- Dock2Door — Arrival notifications for shipper & receiver
-- ==========================================================================
-- When the owner-operator / fleet driver arrives at the pickup or the drop-off,
-- both the shipper (load poster) and the receiver (consignee) should be told.
--
-- The receiver is stored on the load as free text (recipient_name +
-- recipient_phone). If that phone matches a registered app user we also drop an
-- in-app notification into their bell; otherwise only the shipper is notified.
--
-- This migration redefines advance_load (same 5-arg signature as 0139) to send
-- clear, targeted arrival messages instead of the generic "Your load is now: X".
-- ==========================================================================

create or replace function public.advance_load(
  p_load_id uuid,
  p_next_status load_status,
  p_proof_photo_path text default null,
  p_receiver_name text default null,
  p_signature_path text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_ok boolean := false;
  v_receiver_uid uuid;
  v_phone_key text;
  v_route text;
  v_ship_title text;
  v_ship_body text;
  v_recv_title text;
  v_recv_body text;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  if not (v_load.accepted_driver_user_id = auth.uid()
          or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
          or public.is_admin()) then
    raise exception 'not authorized for this load' using errcode = '42501';
  end if;

  v_ok := case
    when v_load.status = 'Accepted' and p_next_status = 'EnRoute'  then true
    when v_load.status = 'EnRoute'  and p_next_status = 'Arrived'  then true
    when v_load.status = 'Arrived'  and p_next_status = 'Delivered' then true
    when v_load.status in ('Accepted','EnRoute','Arrived') and p_next_status = 'Cancelled' then true
    else false
  end;
  if not v_ok then raise exception 'invalid load transition % -> %', v_load.status, p_next_status; end if;

  -- Proof gates: a pickup photo is required to go EnRoute; a delivery photo +
  -- receiver name are required to mark Delivered.
  if p_next_status = 'EnRoute' then
    if coalesce(p_proof_photo_path, '') = '' then
      raise exception 'a pickup photo is required before starting the trip';
    end if;
    update public.loads set
      status = p_next_status,
      pickup_photo_path = p_proof_photo_path,
      picked_up_at = now(),
      updated_at = now()
    where id = p_load_id;
  elsif p_next_status = 'Delivered' then
    if coalesce(p_proof_photo_path, '') = '' then
      raise exception 'a delivery photo is required to mark this delivered';
    end if;
    if coalesce(p_receiver_name, '') = '' then
      raise exception 'the receiver name is required to mark this delivered';
    end if;
    update public.loads set
      status = p_next_status,
      delivery_photo_path = p_proof_photo_path,
      receiver_name = p_receiver_name,
      signature_path = coalesce(nullif(p_signature_path, ''), signature_path),
      delivered_at = now(),
      updated_at = now()
    where id = p_load_id;
  else
    update public.loads set status = p_next_status, updated_at = now() where id = p_load_id;
  end if;

  -- Resolve a registered receiver by matching the consignee phone (last 10
  -- digits) against a known app user. Best-effort — null when no account exists.
  v_phone_key := nullif(right(regexp_replace(coalesce(v_load.recipient_phone, ''), '\D', '', 'g'), 10), '');
  if v_phone_key is not null and length(v_phone_key) >= 7 then
    begin
      select u.id into v_receiver_uid
      from auth.users u
      where right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) = v_phone_key
      limit 1;
    exception when others then
      v_receiver_uid := null;
    end;
  end if;

  v_route := coalesce(nullif(v_load.pickup_city, ''), nullif(v_load.pickup_address, ''), 'pickup')
             || ' → '
             || coalesce(nullif(v_load.dropoff_city, ''), nullif(v_load.dropoff_address, ''), 'drop-off');

  -- Build stage-specific copy for shipper + receiver.
  if p_next_status = 'EnRoute' then
    v_ship_title := 'Driver arrived at pickup 📦';
    v_ship_body  := 'The driver reached the pickup and loaded your freight (' || v_route || '). It is now on the way.';
    v_recv_title := 'Your shipment is on the way 🚚';
    v_recv_body  := 'The driver picked up your shipment and is heading to you (' || v_route || ').';
  elsif p_next_status = 'Arrived' then
    v_ship_title := 'Driver arrived at drop-off 📍';
    v_ship_body  := 'The driver has arrived at the delivery location (' || v_route || ').';
    v_recv_title := 'Your driver has arrived 📍';
    v_recv_body  := 'The driver is at the drop-off with your shipment. Please be ready to receive it.';
  elsif p_next_status = 'Delivered' then
    v_ship_title := 'Load delivered ✅';
    v_ship_body  := 'Your load was delivered' || case when coalesce(v_load.receiver_name, p_receiver_name, '') <> ''
                      then ' and signed for by ' || coalesce(nullif(p_receiver_name,''), v_load.receiver_name) else '' end || '.';
    v_recv_title := 'Shipment delivered ✅';
    v_recv_body  := 'Your shipment has been delivered.';
  else
    v_ship_title := 'Load update';
    v_ship_body  := 'Your load is now: ' || p_next_status;
    v_recv_title := null;
    v_recv_body  := null;
  end if;

  -- Notify the shipper (load poster).
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_load.poster_user_id, 'system', v_ship_title, v_ship_body, 'loads', p_load_id);

  -- Notify the receiver if they are a registered app user.
  if v_receiver_uid is not null and v_receiver_uid <> v_load.poster_user_id and v_recv_title is not null then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    values (v_receiver_uid, 'system', v_recv_title, v_recv_body, 'loads', p_load_id);
  end if;

  perform public.write_audit('load.' || lower(p_next_status::text), 'loads', p_load_id::text, null,
    jsonb_build_object('from', v_load.status, 'to', p_next_status), '');
end;
$$;
grant execute on function public.advance_load(uuid, load_status, text, text, text) to authenticated;

notify pgrst, 'reload schema';
