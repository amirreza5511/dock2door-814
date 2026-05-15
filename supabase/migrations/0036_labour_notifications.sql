-- Migration 0036: Add notifications to worker_apply_shift and employer_accept_applicant RPCs

-- Worker apply shift — notifies employer company members
create or replace function public.worker_apply_shift(p_shift_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_app uuid;
  v_emp_company uuid;
  v_shift_title text;
  v_worker_name text;
begin
  insert into public.shift_applications (shift_id, worker_user_id, status)
  values (p_shift_id, auth.uid(), 'Applied')
  on conflict (shift_id, worker_user_id) do update set status = 'Applied'
  returning id into v_app;

  select sp.employer_company_id, sp.title
  into v_emp_company, v_shift_title
  from public.shift_posts sp where id = p_shift_id;

  select name into v_worker_name from public.profiles where id = auth.uid();

  -- Notify all employer company members
  perform public.queue_notification(
    cu.user_id,
    'shift',
    'New applicant for ' || v_shift_title,
    v_worker_name || ' applied to your shift',
    'shift_posts', p_shift_id::text,
    jsonb_build_object('shift_id', p_shift_id, 'application_id', v_app)
  )
  from public.company_users cu
  where cu.company_id = v_emp_company and cu.status = 'Active';

  perform public.write_audit('shift.apply','shift_applications', v_app::text,
    null, jsonb_build_object('shift_id', p_shift_id), null, null);
  return v_app;
end;
$$;
grant execute on function public.worker_apply_shift(uuid) to authenticated;

-- Employer accept applicant — notifies worker
create or replace function public.employer_accept_applicant(
  p_application_id uuid,
  p_rate numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_shift uuid; v_worker uuid; v_emp uuid; v_rate numeric; v_ass uuid;
  v_shift_title text; v_shift_date text; v_shift_time text;
begin
  select sa.shift_id, sa.worker_user_id, sp.employer_company_id,
         coalesce(p_rate, sp.hourly_rate, sp.flat_rate, 0),
         sp.title, sp.date::text, sp.start_time
  into v_shift, v_worker, v_emp, v_rate, v_shift_title, v_shift_date, v_shift_time
  from public.shift_applications sa
  join public.shift_posts sp on sp.id = sa.shift_id
  where sa.id = p_application_id;

  if v_shift is null then raise exception 'Application not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_emp) then
    raise exception 'Not an employer member' using errcode='42501';
  end if;

  update public.shift_applications set status = 'Accepted' where id = p_application_id;

  insert into public.shift_assignments (shift_id, worker_user_id, confirmed_rate, status, employer_company_id)
  values (v_shift, v_worker, v_rate, 'Scheduled', v_emp)
  returning id into v_ass;

  update public.shift_posts set status = 'Filled' where id = v_shift;

  -- Notify worker they got the shift
  perform public.queue_notification(
    v_worker,
    'shift',
    'You got the shift!',
    v_shift_title || ' on ' || v_shift_date || ' at ' || v_shift_time,
    'shift_assignments', v_ass::text,
    jsonb_build_object('assignment_id', v_ass, 'shift_id', v_shift)
  );

  perform public.write_audit(
    'shift.accept_applicant','shift_applications', p_application_id::text,
    null, jsonb_build_object('assignment_id', v_ass, 'worker_user_id', v_worker),
    null, v_emp);
  return v_ass;
end;
$$;
grant execute on function public.employer_accept_applicant(uuid, numeric) to authenticated;
