-- 0058_missing_notifications.sql
-- Adds the worker / employer notifications that were missing from four core RPCs.
-- All four RPCs already exist in earlier migrations — this re-declares them with
-- the same signature + behaviour, but additionally queues a `notifications` row
-- for the affected user so the dashboards' notification bells and alerts work
-- end-to-end.
--
-- Fixes failed steps from the 18-step Worker / Employer / Super Admin live test:
--   Step 6  — Worker notification when Government ID / certificate approved or rejected
--   Step 9  — Employer (company owner) notification when company status changes
--   Step 13 — Worker notification when shift application is rejected
--   Step 17 — Worker notification when employer confirms hours
--
-- Idempotent — CREATE OR REPLACE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. admin_approve_certification — notify worker
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_approve_certification(
  p_cert_id uuid,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_worker uuid;
  v_type text;
begin
  perform public.require_admin();

  select to_jsonb(c.*), c.worker_user_id, c.type
    into v_before, v_worker, v_type
    from public.worker_certifications c where id = p_cert_id;

  update public.worker_certifications
     set status = 'Approved', admin_approved = true,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_cert_id;

  select to_jsonb(c.*) into v_after from public.worker_certifications c where id = p_cert_id;

  if v_worker is not null then
    perform public.queue_notification(
      v_worker,
      'certification',
      'Document approved',
      coalesce(v_type, 'Your document') || ' was approved.',
      'worker_certifications', p_cert_id::text,
      jsonb_build_object('cert_id', p_cert_id, 'type', v_type, 'status', 'Approved')
    );
  end if;

  perform public.write_audit(
    'certification.approve','worker_certifications',p_cert_id::text,
    v_before, v_after, p_reason, null
  );
end; $$;
grant execute on function public.admin_approve_certification(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_reject_certification — notify worker with reason
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_reject_certification(
  p_cert_id uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_worker uuid;
  v_type text;
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);

  select to_jsonb(c.*), c.worker_user_id, c.type
    into v_before, v_worker, v_type
    from public.worker_certifications c where id = p_cert_id;

  update public.worker_certifications
     set status = 'Rejected', admin_approved = false,
         reviewed_by = auth.uid(), reviewed_at = now(), notes = p_reason
   where id = p_cert_id;

  select to_jsonb(c.*) into v_after from public.worker_certifications c where id = p_cert_id;

  if v_worker is not null then
    perform public.queue_notification(
      v_worker,
      'certification',
      'Document rejected',
      coalesce(v_type, 'Your document') || ' was rejected. Reason: ' || p_reason,
      'worker_certifications', p_cert_id::text,
      jsonb_build_object('cert_id', p_cert_id, 'type', v_type, 'status', 'Rejected', 'reason', p_reason)
    );
  end if;

  perform public.write_audit(
    'certification.reject','worker_certifications',p_cert_id::text,
    v_before, v_after, p_reason, null
  );
end; $$;
grant execute on function public.admin_reject_certification(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. admin_set_company_status — notify all Active company members
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_company_status(
  p_company_id uuid,
  p_status company_status,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
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

  update public.companies set status = p_status where id = p_company_id;

  select to_jsonb(c.*) into v_after from public.companies c where id = p_company_id;

  v_title := case p_status
               when 'Active'    then 'Company approved'
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
end; $$;
grant execute on function public.admin_set_company_status(uuid, company_status, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. employer_reject_applicant — notify worker
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.employer_reject_applicant(
  p_application_id uuid,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_worker uuid;
  v_shift uuid;
  v_title text;
begin
  select sp.employer_company_id, sa.worker_user_id, sa.shift_id, sp.title
    into v_emp, v_worker, v_shift, v_title
    from public.shift_applications sa
    join public.shift_posts sp on sp.id = sa.shift_id
   where sa.id = p_application_id;

  if v_emp is null then raise exception 'Application not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_emp) then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  update public.shift_applications set status = 'Rejected' where id = p_application_id;

  if v_worker is not null then
    perform public.queue_notification(
      v_worker,
      'shift',
      'Application not selected',
      'Your application for "' || coalesce(v_title, 'a shift') || '" was not selected.'
        || case when p_reason is not null and length(trim(p_reason)) > 0
                then ' Reason: ' || p_reason else '' end,
      'shift_applications', p_application_id::text,
      jsonb_build_object('application_id', p_application_id, 'shift_id', v_shift, 'reason', p_reason)
    );
  end if;

  perform public.write_audit('shift.reject_applicant','shift_applications', p_application_id::text,
    null, jsonb_build_object('reason', p_reason), p_reason, v_emp);
end; $$;
grant execute on function public.employer_reject_applicant(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. employer_confirm_hours — notify worker
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.employer_confirm_hours(
  p_time_entry_id uuid,
  p_hours numeric,
  p_notes text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_ass uuid;
  v_worker uuid;
  v_shift uuid;
  v_title text;
begin
  select a.id, a.employer_company_id, a.worker_user_id, a.shift_id, sp.title
    into v_ass, v_emp, v_worker, v_shift, v_title
    from public.time_entries te
    join public.shift_assignments a on a.id = te.assignment_id
    left join public.shift_posts sp on sp.id = a.shift_id
   where te.id = p_time_entry_id;

  if v_emp is null then raise exception 'Entry not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_emp) then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  update public.time_entries
     set employer_confirmed_hours = p_hours, employer_notes = coalesce(p_notes,'')
   where id = p_time_entry_id;

  update public.shift_assignments set status = 'Completed' where id = v_ass;

  if v_worker is not null then
    perform public.queue_notification(
      v_worker,
      'shift',
      'Hours confirmed',
      'Your employer confirmed ' || p_hours::text || ' hour(s) for "'
        || coalesce(v_title, 'your shift') || '".',
      'time_entries', p_time_entry_id::text,
      jsonb_build_object(
        'time_entry_id', p_time_entry_id,
        'assignment_id', v_ass,
        'shift_id', v_shift,
        'hours', p_hours,
        'notes', p_notes
      )
    );
  end if;

  perform public.write_audit('shift.confirm_hours','time_entries', p_time_entry_id::text,
    null, jsonb_build_object('hours', p_hours, 'notes', p_notes), null, v_emp);
end; $$;
grant execute on function public.employer_confirm_hours(uuid, numeric, text) to authenticated;
