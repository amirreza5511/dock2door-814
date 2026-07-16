-- =========================================================================
-- 0151  DISPATCH CAN FINALIZE/CHANGE THE HANDLING MODE
-- -------------------------------------------------------------------------
-- The customer proposes the handling mode (Live load / Live unload / Drop &
-- pick) when creating the order. The drayage company's dispatch may need to
-- finalize or change it once they know the real plan at the stop. This RPC
-- lets the owning drayage company (or admin) update handling_mode and the
-- drop-and-pick "pick-up back date". Additive + idempotent; nothing else
-- changes for orders that never touch it.
-- =========================================================================

create or replace function public.set_drayage_handling_mode(
  p_order_id uuid,
  p_handling_mode drayage_handling_mode,
  p_pickup_back_date date default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_order public.drayage_orders;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;
  perform public.assert_drayage_owner(v_order);

  update public.drayage_orders set
    handling_mode = coalesce(p_handling_mode, handling_mode),
    -- Only keep a pick-up back date when the mode is Drop & pick; clear it otherwise.
    pickup_back_date = case
      when coalesce(p_handling_mode, handling_mode) = 'DropPick' then p_pickup_back_date
      else null
    end,
    updated_at = now()
  where id = p_order_id;

  perform public.write_audit(
    'drayage_order_handling_mode', p_order_id,
    jsonb_build_object('handling', p_handling_mode, 'pickupBack', p_pickup_back_date)::text
  );
end;
$$;
grant execute on function public.set_drayage_handling_mode(uuid, drayage_handling_mode, date) to authenticated;
