-- Dock2Door — Fleet dispatch for the loads marketplace.
-- Lets a carrier (trucking) company that has ACCEPTED a load assign it to one of
-- its own drivers (a registered Driver-role app user). The driver then sees the
-- load under "My loads" (loads.listAccepted filters on accepted_driver_user_id),
-- while the company keeps visibility via accepted_company_id.
-- Idempotent.

create or replace function public.dispatch_load(p_load_id uuid, p_driver_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_driver_user_id is null then raise exception 'a driver is required'; end if;

  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  -- Only a member of the carrier company that accepted the load (or an admin)
  -- may dispatch it.
  if not (
    (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the carrier company can dispatch this load' using errcode = '42501';
  end if;

  if v_load.status not in ('Accepted','EnRoute','Arrived') then
    raise exception 'only active loads can be dispatched';
  end if;

  -- The target must be a real profile (Driver-role app user).
  if not exists (select 1 from public.profiles where id = p_driver_user_id) then
    raise exception 'that driver is not a registered app user';
  end if;

  update public.loads
    set accepted_driver_user_id = p_driver_user_id, updated_at = now()
    where id = p_load_id;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (p_driver_user_id, 'system', 'New load dispatched 🚚',
    'Your dispatcher assigned you a ' || v_load.vehicle_type || ' load. Open My loads to run it.',
    'loads', p_load_id);

  perform public.write_audit('load.dispatched', 'loads', p_load_id::text, null,
    jsonb_build_object('driver', p_driver_user_id, 'company', v_load.accepted_company_id), '');
end;
$$;
grant execute on function public.dispatch_load(uuid, uuid) to authenticated;
