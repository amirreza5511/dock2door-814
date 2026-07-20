-- =========================================================================
-- 0160 — Fix: shift_applications.rejection_reason missing
-- Idempotent.
--
-- Bug found during automated QA:
--   expo/app/worker/my-shifts.tsx selects `rejection_reason` from
--   shift_applications, but the column never existed. PostgREST returns
--   42703 and the worker's Applications tab renders empty forever.
--   employer_reject_applicant only stored the reason inside the
--   notification payload / audit log, never on the row itself.
-- =========================================================================

alter table public.shift_applications
  add column if not exists rejection_reason text;

-- Persist the reason on the application row so the worker sees it in-app.
create or replace function public.employer_reject_applicant(p_application_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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

  update public.shift_applications
     set status = 'Rejected',
         rejection_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_application_id;

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
