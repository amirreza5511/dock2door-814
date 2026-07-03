-- =========================================================================
-- Drayage move proof of pickup / delivery
-- Adds pickup/delivery photo capture, receiver name, and driver-captured
-- container number to drayage moves, and extends advance_drayage_move to
-- accept and store this proof when the driver advances a leg.
-- =========================================================================

alter table public.drayage_moves
  add column if not exists pickup_photo_path text not null default '',
  add column if not exists delivery_photo_path text not null default '',
  add column if not exists receiver_name text not null default '',
  add column if not exists captured_container_number text not null default '';

-- Replace advance function with a version that accepts optional proof.
drop function if exists public.advance_drayage_move(uuid, drayage_move_status);

create or replace function public.advance_drayage_move(
  p_move_id uuid,
  p_next_status drayage_move_status,
  p_photo_path text default null,
  p_receiver_name text default null,
  p_container_number text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_move public.drayage_moves;
  v_order public.drayage_orders;
  v_ok boolean := false;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_move from public.drayage_moves where id = p_move_id for update;
  if v_move is null then raise exception 'move not found'; end if;

  select * into v_order from public.drayage_orders where id = v_move.order_id;

  if not (
    v_move.driver_user_id = auth.uid()
    or (v_order.drayage_company_id is not null and public.is_member_of(v_order.drayage_company_id))
    or public.is_admin()
  ) then
    raise exception 'not authorized for this move' using errcode = '42501';
  end if;

  v_ok := case
    when v_move.status = 'Pending'    and p_next_status = 'Assigned'    then true
    when v_move.status = 'Assigned'   and p_next_status = 'EnRoute'     then true
    when v_move.status = 'EnRoute'    and p_next_status = 'AtOrigin'    then true
    when v_move.status = 'AtOrigin'   and p_next_status = 'Loaded'      then true
    when v_move.status = 'Loaded'     and p_next_status = 'InTransit'   then true
    when v_move.status = 'InTransit'  and p_next_status = 'AtDestination' then true
    when v_move.status = 'AtDestination' and p_next_status = 'Unloaded' then true
    when v_move.status = 'Unloaded'   and p_next_status = 'Completed'   then true
    when v_move.status in ('Pending','Assigned','EnRoute','AtOrigin','Loaded','InTransit','AtDestination','Unloaded')
         and p_next_status = 'Cancelled' then true
    else false
  end;
  if not v_ok then raise exception 'invalid move transition % -> %', v_move.status, p_next_status; end if;

  update public.drayage_moves set status = p_next_status, updated_at = now(),
    started_at = case when p_next_status = 'EnRoute' then now() else started_at end,
    picked_up_at = case when p_next_status = 'Loaded' then now() else picked_up_at end,
    delivered_at = case when p_next_status = 'AtDestination' then now() else delivered_at end,
    completed_at = case when p_next_status = 'Completed' then now() else completed_at end,
    -- pickup proof captured when the container is loaded
    pickup_photo_path = case when p_next_status = 'Loaded' and coalesce(p_photo_path,'') <> '' then p_photo_path else pickup_photo_path end,
    captured_container_number = case when p_next_status = 'Loaded' and coalesce(p_container_number,'') <> '' then p_container_number else captured_container_number end,
    -- delivery proof captured at destination
    delivery_photo_path = case when p_next_status = 'AtDestination' and coalesce(p_photo_path,'') <> '' then p_photo_path else delivery_photo_path end,
    receiver_name = case when p_next_status = 'AtDestination' and coalesce(p_receiver_name,'') <> '' then p_receiver_name else receiver_name end
    where id = p_move_id;

  -- If the driver captured a container number and the order has none, backfill it.
  if p_next_status = 'Loaded' and coalesce(p_container_number,'') <> '' and coalesce(v_order.container_number,'') = '' then
    update public.drayage_orders set container_number = p_container_number, updated_at = now() where id = v_order.id;
  end if;

  -- Update parent order status based on move progression
  if p_next_status = 'EnRoute' then
    update public.drayage_orders set status = 'EnRoute', updated_at = now() where id = v_order.id and status = 'Dispatched';
  elsif p_next_status = 'Loaded' then
    update public.drayage_orders set status = 'PickedUp', updated_at = now() where id = v_order.id;
  elsif p_next_status = 'InTransit' then
    update public.drayage_orders set status = 'InTransit', updated_at = now() where id = v_order.id;
  elsif p_next_status = 'Completed' then
    if not exists (select 1 from public.drayage_moves where order_id = v_order.id and status not in ('Completed','Cancelled')) then
      update public.drayage_orders set status = 'Delivered', delivered_at = now(), updated_at = now() where id = v_order.id;
    end if;
  end if;

  -- Notify customer of progress
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_order.customer_user_id, 'system', 'Container update',
    'Your container ' || coalesce(p_container_number, v_order.container_number,'') || ' is now: ' || p_next_status::text,
    'drayage_orders', v_order.id);

  perform public.write_audit('drayage_move.' || lower(p_next_status::text), 'drayage_moves', p_move_id::text, null,
    jsonb_build_object('from', v_move.status, 'to', p_next_status), '');
end;
$$;
grant execute on function public.advance_drayage_move(uuid, drayage_move_status, text, text, text) to authenticated;
