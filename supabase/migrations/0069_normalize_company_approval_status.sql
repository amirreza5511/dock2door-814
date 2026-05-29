-- Bulletproof company approval status handling.
--
-- Root cause of "invalid input value for enum company_status: \"Active\"":
-- the `company_status` enum only has ('PendingApproval','Approved','Suspended').
-- There is NO 'Active' and NO 'Rejected'. Earlier code (and the client) passed
-- those values straight into a `::company_status` cast, which throws.
--
-- Fix: normalise the incoming text to a real enum value BEFORE casting, so any
-- caller (current or stale build) sending 'Active' / 'Rejected' just works:
--   Approved | Active                 -> Approved
--   Rejected | Suspended | Declined   -> Suspended
--   PendingApproval | Pending         -> PendingApproval

create or replace function public.admin_set_company_approval(
  p_company_id uuid,
  p_status     text,
  p_reason     text default null
) returns void
language plpgsql security definer set search_path = public as $func$
declare
  v_before jsonb;
  v_enum   company_status;
  v_norm   text;
begin
  perform public.require_admin();

  -- Normalise free-text intent down to the real enum.
  v_norm := lower(coalesce(trim(p_status), ''));
  v_enum := case
    when v_norm in ('approved', 'active', 'approve', 'reinstate') then 'Approved'
    when v_norm in ('rejected', 'reject', 'suspended', 'suspend', 'declined') then 'Suspended'
    when v_norm in ('pendingapproval', 'pending') then 'PendingApproval'
    else null
  end::company_status;

  if v_enum is null then
    raise exception 'invalid status: %', p_status;
  end if;

  -- Require a reason whenever we are putting a company into a negative state.
  if v_enum = 'Suspended' then
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
                                  when v_enum = 'Approved'
                                  then coalesce(verified_at, now())
                                  else verified_at
                                end,
    approval_rejection_reason = case
                                  when v_enum = 'Suspended' then p_reason
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
$func$;

grant execute on function public.admin_set_company_approval(uuid, text, text) to authenticated;
