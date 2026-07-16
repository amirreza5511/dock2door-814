-- Dock2Door — Driver dispatch response (accept / reject)
-- ==========================================================================
-- Completes the dispatch loop: when a dispatcher assigns a load to a driver,
-- the driver must accept or reject it. A rejection sends the load back to the
-- "waiting for driver" pool and notifies the dispatching company.
--
-- Additive + idempotent. Adds three nullable columns to loads and two RPCs:
--   * dispatch_load  (redefined)  -> sets driver_response = 'Pending'
--   * respond_dispatch(p_load_id, p_accept, p_reason)  -> driver's answer
-- ==========================================================================

alter table public.loads add column if not exists driver_response text;
alter table public.loads add column if not exists driver_response_at timestamptz;
alter table public.loads add column if not exists driver_response_reason text;

-- ── Redefine dispatch_load: assign driver AND mark response Pending ─────────
create or replace function public.dispatch_load(p_load_id uuid, p_driver_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_driver_user_id is null then raise exception 'a driver is required'; end if;

  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  if not (
    (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the carrier company can dispatch this load' using errcode = '42501';
  end if;

  if v_load.status not in ('Accepted','EnRoute','Arrived') then
    raise exception 'only active loads can be dispatched';
  end if;

  if not exists (select 1 from public.profiles where id = p_driver_user_id) then
    raise exception 'that driver is not a registered app user';
  end if;

  update public.loads
    set accepted_driver_user_id = p_driver_user_id,
        driver_response = 'Pending',
        driver_response_at = null,
        driver_response_reason = null,
        updated_at = now()
    where id = p_load_id;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (p_driver_user_id, 'system', 'New load dispatched 🚚',
    'Your dispatcher assigned you a ' || v_load.vehicle_type || ' load. Open My loads to accept or decline it.',
    'loads', p_load_id);

  perform public.write_audit('load.dispatched', 'loads', p_load_id::text, null,
    jsonb_build_object('driver', p_driver_user_id, 'company', v_load.accepted_company_id), '');
end;
$$;
grant execute on function public.dispatch_load(uuid, uuid) to authenticated;

-- ── respond_dispatch: the assigned driver accepts or rejects the load ───────
create or replace function public.respond_dispatch(p_load_id uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_driver_name text;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  -- Only the currently assigned driver may respond.
  if v_load.accepted_driver_user_id is null or v_load.accepted_driver_user_id <> auth.uid() then
    raise exception 'this load is not assigned to you' using errcode = '42501';
  end if;

  select nullif(trim(name), '') into v_driver_name from public.profiles where id = auth.uid();

  if p_accept then
    update public.loads
      set driver_response = 'Accepted', driver_response_at = now(), driver_response_reason = null, updated_at = now()
      where id = p_load_id;
  else
    -- Reject: unassign the driver so the load returns to the waiting pool.
    update public.loads
      set accepted_driver_user_id = null,
          driver_response = 'Rejected',
          driver_response_at = now(),
          driver_response_reason = nullif(trim(coalesce(p_reason, '')), ''),
          updated_at = now()
      where id = p_load_id;
  end if;

  -- Notify the dispatching company members so they can react.
  if v_load.accepted_company_id is not null then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    select cu.user_id, 'system',
      case when p_accept then 'Driver accepted a load ✅' else 'Driver declined a load ⚠️' end,
      case when p_accept
        then coalesce(v_driver_name, 'Your driver') || ' accepted the ' || v_load.vehicle_type || ' load.'
        else coalesce(v_driver_name, 'Your driver') || ' declined the ' || v_load.vehicle_type || ' load'
             || case when nullif(trim(coalesce(p_reason, '')), '') is not null then ': ' || p_reason else '.' end
             || ' It is back in the waiting pool.'
      end,
      'loads', p_load_id
    from public.company_users cu
    where cu.company_id = v_load.accepted_company_id and cu.status = 'Active';
  end if;

  perform public.write_audit('load.dispatch_' || case when p_accept then 'accepted' else 'rejected' end,
    'loads', p_load_id::text, null, jsonb_build_object('reason', p_reason), '');
end;
$$;
grant execute on function public.respond_dispatch(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
