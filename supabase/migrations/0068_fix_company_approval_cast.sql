-- Fix: admin_set_company_approval was assigning text directly to a company_status enum
-- column without an explicit cast, causing:
--   "column 'status' is of type company_status but expression is of type text"
-- Solution: cast p_status::company_status inside the UPDATE.

create or replace function public.admin_set_company_approval(
  p_company_id uuid,
  p_status     text,   -- 'Approved' | 'Active' | 'Rejected' | 'Suspended' | 'PendingApproval'
  p_reason     text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_enum   company_status;
begin
  perform public.require_admin();

  if p_status not in ('Approved','Active','Rejected','Suspended','PendingApproval') then
    raise exception 'invalid status: %', p_status;
  end if;

  -- Explicit text → enum cast so Postgres doesn't complain.
  v_enum := p_status::company_status;

  if v_enum in ('Rejected','Suspended') then
    perform public.require_reason(p_reason);
  end if;

  select to_jsonb(c) into v_before
    from public.companies c
   where c.id = p_company_id;

  if v_before is null then
    raise exception 'company not found: %', p_company_id;
  end if;

  update public.companies set
    status                    = v_enum,
    verified_at               = case
                                  when v_enum in ('Approved','Active')
                                  then coalesce(verified_at, now())
                                  else verified_at
                                end,
    approval_rejection_reason = case
                                  when v_enum in ('Rejected','Suspended') then p_reason
                                  else null
                                end
  where id = p_company_id;

  perform public.write_audit(
    'company.approval_changed',
    'companies',
    p_company_id::text,
    v_before,
    (select to_jsonb(c) from public.companies c where c.id = p_company_id),
    coalesce(p_reason, '')
  );
end;
$$;

grant execute on function public.admin_set_company_approval(uuid, text, text) to authenticated;
