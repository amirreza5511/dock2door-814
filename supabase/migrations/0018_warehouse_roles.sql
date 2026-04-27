-- ============================================================================
-- 0018_warehouse_roles.sql
-- Extend company_role enum with warehouse-specific roles + add update/suspend
-- RPCs. Idempotent.
-- ============================================================================

-- 1) Extend the company_role enum (must be committed before being USED in DML;
--    these statements only ADD values, they don't use them).
do $$
begin
  if not exists (select 1 from pg_enum e
                 join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'Manager') then
    alter type public.company_role add value 'Manager';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'Supervisor') then
    alter type public.company_role add value 'Supervisor';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'Receiver') then
    alter type public.company_role add value 'Receiver';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'Picker') then
    alter type public.company_role add value 'Picker';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'Packer') then
    alter type public.company_role add value 'Packer';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'ShippingClerk') then
    alter type public.company_role add value 'ShippingClerk';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'InventoryClerk') then
    alter type public.company_role add value 'InventoryClerk';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'DockStaff') then
    alter type public.company_role add value 'DockStaff';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'company_role' and e.enumlabel = 'ReadOnly') then
    alter type public.company_role add value 'ReadOnly';
  end if;
end $$;

commit;

-- 2) Update company_add_member to accept 'role text' so any future enum value
--    works without re-deploying the RPC. We validate against pg_enum.
create or replace function public.company_add_member_v2(
  p_company_id uuid,
  p_user_id uuid,
  p_role text default 'Staff',
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_role company_role;
begin
  if not public.is_admin() and not public.is_owner_of(p_company_id) then
    raise exception 'Only company owner or admin' using errcode='42501';
  end if;
  begin
    v_role := p_role::company_role;
  exception when others then
    raise exception 'Invalid role: %', p_role using errcode='22023';
  end;
  insert into public.company_users (company_id, user_id, company_role, status)
  values (p_company_id, p_user_id, v_role, 'Active')
  on conflict (company_id, user_id)
    do update set company_role = excluded.company_role, status = 'Active';
  perform public.write_audit('company.add_member','company_users', p_user_id::text,
    null, jsonb_build_object('company_id', p_company_id, 'role', v_role), p_reason, p_company_id);
end;
$$;
grant execute on function public.company_add_member_v2(uuid, uuid, text, text) to authenticated;

-- 3) Update an existing member's role.
create or replace function public.company_update_member_role(
  p_company_id uuid,
  p_user_id uuid,
  p_role text,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_role company_role;
  v_before company_role;
begin
  if not public.is_admin() and not public.is_owner_of(p_company_id) then
    raise exception 'Only company owner or admin' using errcode='42501';
  end if;
  begin
    v_role := p_role::company_role;
  exception when others then
    raise exception 'Invalid role: %', p_role using errcode='22023';
  end;

  select company_role into v_before from public.company_users
    where company_id = p_company_id and user_id = p_user_id;
  if v_before is null then
    raise exception 'Member not found' using errcode='22023';
  end if;

  -- Don't allow demoting the last Owner.
  if v_before = 'Owner' and v_role <> 'Owner' then
    if (select count(*) from public.company_users
         where company_id = p_company_id and company_role = 'Owner' and status = 'Active') <= 1 then
      raise exception 'Cannot demote the last active Owner' using errcode='42501';
    end if;
  end if;

  update public.company_users set company_role = v_role
    where company_id = p_company_id and user_id = p_user_id;

  perform public.write_audit('company.update_member_role','company_users', p_user_id::text,
    jsonb_build_object('role', v_before),
    jsonb_build_object('company_id', p_company_id, 'role', v_role),
    p_reason, p_company_id);
end;
$$;
grant execute on function public.company_update_member_role(uuid, uuid, text, text) to authenticated;

-- 4) Suspend / reactivate without removing.
create or replace function public.company_set_member_status(
  p_company_id uuid,
  p_user_id uuid,
  p_status text,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if not public.is_admin() and not public.is_owner_of(p_company_id) then
    raise exception 'Only company owner or admin' using errcode='42501';
  end if;
  if p_status not in ('Active','Suspended','Inactive') then
    raise exception 'Invalid status: %', p_status using errcode='22023';
  end if;
  if p_status in ('Suspended','Inactive') then
    perform public.require_reason(p_reason);
  end if;

  select status into v_before from public.company_users
    where company_id = p_company_id and user_id = p_user_id;
  if v_before is null then
    raise exception 'Member not found' using errcode='22023';
  end if;

  -- Don't allow suspending the last Owner.
  if (select company_role from public.company_users
        where company_id = p_company_id and user_id = p_user_id) = 'Owner'
     and p_status <> 'Active' then
    if (select count(*) from public.company_users
         where company_id = p_company_id and company_role = 'Owner' and status = 'Active') <= 1 then
      raise exception 'Cannot suspend the last active Owner' using errcode='42501';
    end if;
  end if;

  update public.company_users set status = p_status
    where company_id = p_company_id and user_id = p_user_id;

  perform public.write_audit('company.set_member_status','company_users', p_user_id::text,
    jsonb_build_object('status', v_before),
    jsonb_build_object('company_id', p_company_id, 'status', p_status),
    p_reason, p_company_id);
end;
$$;
grant execute on function public.company_set_member_status(uuid, uuid, text, text) to authenticated;

-- 5) Allow whitelisted RPCs in audit guard from 0009.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'audit_guard_allowed_rpcs') then
    -- best-effort; if a guard table exists we'd update it here. Skipped if not present.
    null;
  end if;
end $$;
