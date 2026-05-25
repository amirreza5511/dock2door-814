-- Migration 0062: Harden worker_apply_shift so workers can't apply to
-- shifts that are already Filled / Cancelled / Completed or whose date
-- has passed. Also prevents re-applying after withdrawal once the shift
-- is no longer Posted.

create or replace function public.worker_apply_shift(p_shift_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_app uuid;
  v_emp_company uuid;
  v_shift_title text;
  v_shift_status text;
  v_shift_date date;
  v_workers_needed int;
  v_accepted_count int;
  v_worker_name text;
begin
  -- Load the shift and validate it's still applyable
  select sp.employer_company_id, sp.title, sp.status::text, sp.date,
         coalesce(sp.workers_needed, 1)
    into v_emp_company, v_shift_title, v_shift_status, v_shift_date, v_workers_needed
  from public.shift_posts sp
  where sp.id = p_shift_id;

  if v_emp_company is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;

  if v_shift_status <> 'Posted' then
    raise exception 'This shift is no longer accepting applications (status: %)', v_shift_status
      using errcode = '22023';
  end if;

  if v_shift_date is not null and v_shift_date < current_date then
    raise exception 'This shift has already passed'
      using errcode = '22023';
  end if;

  -- Defensive: if assignments already fill the slot, block
  select count(*) into v_accepted_count
  from public.shift_assignments
  where shift_id = p_shift_id
    and status in ('Scheduled', 'InProgress', 'Completed', 'HoursConfirmed');

  if v_accepted_count >= v_workers_needed then
    raise exception 'This shift is already filled'
      using errcode = '22023';
  end if;

  insert into public.shift_applications (shift_id, worker_user_id, status)
  values (p_shift_id, auth.uid(), 'Applied')
  on conflict (shift_id, worker_user_id) do update set status = 'Applied'
  returning id into v_app;

  select name into v_worker_name from public.profiles where id = auth.uid();

  perform public.queue_notification(
    cu.user_id,
    'shift',
    'New applicant for ' || v_shift_title,
    coalesce(v_worker_name, 'A worker') || ' applied to your shift',
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
