-- Fix: admin_set_company_status (last defined in 0058) builds its notification
-- title with `case p_status when 'Active' then ...`. Because p_status is the
-- `company_status` enum and 'Active' is NOT a valid label
-- ('PendingApproval','Approved','Suspended'), Postgres must coerce the literal
-- 'Active' to company_status to evaluate the CASE — which throws
--   invalid input value for enum company_status: "Active"
-- on EVERY call, even when a valid status like 'Approved' is passed.
--
-- This broke every company status change routed through admin_set_company_status
-- (super-admin Controls "Approve", Compliance approve/suspend, Data Manager,
-- and the audited tRPC routes). admin_set_company_approval (0069) was unaffected
-- because it never references 'Active' as an enum.
--
-- Fix: reference only real enum labels in the CASE.

create or replace function public.admin_set_company_status(
  p_company_id uuid,
  p_status company_status,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $func$
declare
  v_before jsonb;
  v_after jsonb;
  v_name text;
  v_title text;
  v_body text;
begin
  perform public.require_admin();
  if p_status = 'Suspended' then perform public.require_reason(p_reason); end if;

  select to_jsonb(c.*), c.name into v_before, v_name
    from public.companies c where id = p_company_id;

  if v_before is null then
    raise exception 'company not found: %', p_company_id;
  end if;

  update public.companies set
    status      = p_status,
    verified_at = case
                    when p_status = 'Approved'
                    then coalesce(verified_at, now())
                    else verified_at
                  end
  where id = p_company_id;

  select to_jsonb(c.*) into v_after from public.companies c where id = p_company_id;

  v_title := case p_status
               when 'Approved'  then 'Company approved'
               when 'Suspended' then 'Company suspended'
               else 'Company status updated'
             end;
  v_body  := coalesce(v_name, 'Your company') || ' is now ' || p_status::text
             || case when p_reason is not null and length(trim(p_reason)) > 0
                     then '. ' || p_reason
                     else '' end;

  perform public.queue_notification(
    cu.user_id,
    'company',
    v_title,
    v_body,
    'companies', p_company_id::text,
    jsonb_build_object('company_id', p_company_id, 'status', p_status, 'reason', p_reason)
  )
  from public.company_users cu
  where cu.company_id = p_company_id and cu.status = 'Active';

  perform public.write_audit(
    'company.set_status','companies',p_company_id::text,
    v_before, v_after, p_reason, p_company_id
  );
end; $func$;

grant execute on function public.admin_set_company_status(uuid, company_status, text) to authenticated;
