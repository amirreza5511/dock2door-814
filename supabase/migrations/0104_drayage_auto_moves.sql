-- =========================================================================
-- 0104 — Auto-generate drayage moves (work orders) when an order is claimed.
--
-- Problem this fixes: assign_drayage_order() only flipped the order to
-- 'Assigned' but never created any drayage_moves. With no moves, the dispatch
-- console + order screen showed "No moves yet" and there was nothing to
-- dispatch a driver to — the whole pickup/deliver flow was dead.
--
-- This migration adds a move-generation helper, wires it into the claim RPC,
-- and backfills any already-claimed orders that have zero moves.
-- =========================================================================

-- Build the correct leg sequence for an order based on its direction + prepull.
create or replace function public.generate_drayage_moves(p_order_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_order public.drayage_orders;
  v_count int;
  v_dest_addr text;
  v_load_addr text;
begin
  select * into v_order from public.drayage_orders where id = p_order_id;
  if v_order is null then raise exception 'order not found'; end if;

  -- Never double-generate.
  select count(*) into v_count from public.drayage_moves where order_id = p_order_id;
  if v_count > 0 then return 0; end if;

  -- Delivery address for imports (warehouse / customer door).
  v_dest_addr := coalesce(nullif(v_order.delivery_address, ''), '');
  -- Where an export container gets loaded (warehouse door).
  v_load_addr := coalesce(nullif(v_order.pickup_address, ''), '');

  if v_order.direction = 'Import' then
    if v_order.is_prepull then
      -- Prepull: pull from port to a holding yard day-before, deliver next day.
      insert into public.drayage_moves (order_id, move_type, status, sequence,
        from_terminal_id, to_terminal_id, appt_date)
      values (p_order_id, 'Prepull', 'Pending', 1,
        v_order.origin_terminal_id, v_order.prepull_yard_terminal_id, v_order.prepull_pickup_date);

      insert into public.drayage_moves (order_id, move_type, status, sequence,
        from_terminal_id, to_terminal_id, to_address)
      values (p_order_id, 'Delivery', 'Pending', 2,
        v_order.prepull_yard_terminal_id, v_order.destination_terminal_id, v_dest_addr);
    else
      -- Standard import: port/rail pickup straight to the warehouse door.
      insert into public.drayage_moves (order_id, move_type, status, sequence,
        from_terminal_id, to_terminal_id, to_address, appt_date, appt_time)
      values (p_order_id, 'Pickup', 'Pending', 1,
        v_order.origin_terminal_id, v_order.destination_terminal_id, v_dest_addr,
        v_order.port_reservation_date, coalesce(v_order.port_reservation_time, ''));
    end if;

    -- After delivery, empty gets returned to the depot/port.
    insert into public.drayage_moves (order_id, move_type, status, sequence,
      from_terminal_id, to_terminal_id, from_address)
    values (p_order_id, 'EmptyReturn', 'Pending', 3,
      v_order.destination_terminal_id, v_order.origin_terminal_id, v_dest_addr);

  else
    -- Export: grab an empty from the steamship depot, load at the warehouse,
    -- then deliver the loaded box to the port/rail.
    insert into public.drayage_moves (order_id, move_type, status, sequence,
      from_terminal_id, to_terminal_id, to_address)
    values (p_order_id, 'EmptyPickup', 'Pending', 1,
      v_order.origin_terminal_id, v_order.destination_terminal_id, v_load_addr);

    insert into public.drayage_moves (order_id, move_type, status, sequence,
      from_address, to_terminal_id, appt_date, appt_time)
    values (p_order_id, 'Delivery', 'Pending', 2,
      v_load_addr, v_order.destination_terminal_id,
      v_order.port_reservation_date, coalesce(v_order.port_reservation_time, ''));
  end if;

  select count(*) into v_count from public.drayage_moves where order_id = p_order_id;
  return v_count;
end;
$$;
grant execute on function public.generate_drayage_moves(uuid) to authenticated;

-- Re-create the claim RPC so it generates the work orders on assignment.
create or replace function public.assign_drayage_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.drayage_orders;
  v_company uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;
  if v_order.status <> 'Open' then raise exception 'order is no longer open'; end if;

  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then raise exception 'no company associated with your account'; end if;

  update public.drayage_orders
    set status = 'Assigned', drayage_company_id = v_company, assigned_at = now(), updated_at = now()
    where id = p_order_id;

  -- Generate the driver work orders (moves) for this order.
  perform public.generate_drayage_moves(p_order_id);

  -- Notify the customer
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_order.customer_user_id, 'system', 'Drayage order assigned',
    'A drayage company claimed your order ' || v_order.reference_code,
    'drayage_orders', p_order_id);

  perform public.write_audit('drayage_order.assigned', 'drayage_orders', p_order_id::text, null,
    jsonb_build_object('company', v_company), '');
end;
$$;
grant execute on function public.assign_drayage_order(uuid) to authenticated;

-- Backfill: any order already claimed (not Open) but with zero moves gets its
-- work orders generated now, so existing test orders start working immediately.
do $$
declare r record;
begin
  for r in
    select o.id from public.drayage_orders o
    where o.status <> 'Open'
      and not exists (select 1 from public.drayage_moves m where m.order_id = o.id)
  loop
    perform public.generate_drayage_moves(r.id);
  end loop;
end $$;
