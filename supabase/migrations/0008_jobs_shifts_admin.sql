-- Dock2Door — Service jobs state machine, shift/labour RPCs, admin user/company
-- status with audit. Builds on prior migrations.

-- =========================================================================
-- 1) service_jobs — derive provider company, lock ownership, enforce transitions
-- =========================================================================
alter table public.service_jobs
  add column if not exists provider_company_id uuid references public.companies(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

update public.service_jobs j
   set provider_company_id = sl.company_id
  from public.service_listings sl
 where sl.id = j.service_id
   and j.provider_company_id is null;

create or replace function public.service_job_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_provider uuid;
begin
  select company_id into v_provider from public.service_listings where id = new.service_id;
  if v_provider is null then
    raise exception 'Service listing % not found', new.service_id using errcode = 'P0002';
  end if;
  new.provider_company_id := v_provider;
  if new.created_by is null then new.created_by := auth.uid(); end if;

  if not public.is_admin() then
    if not public.is_member_of(new.customer_company_id) then
      raise exception 'Not a member of customer company %', new.customer_company_id using errcode = '42501';
    end if;
  end if;

  if new.status is null or new.status <> 'Requested' then
    new.status := 'Requested';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_service_job_before_insert on public.service_jobs;
create trigger trg_service_job_before_insert
  before insert on public.service_jobs
  for each row execute function public.service_job_before_insert();

-- State machine
create table if not exists public.service_job_transitions (
  from_status job_status not null,
  to_status job_status not null,
  actor_side text not null check (actor_side in ('customer','provider','either','admin')),
  primary key (from_status, to_status)
);
alter table public.service_job_transitions enable row level security;
drop policy if exists "sjt_read" on public.service_job_transitions;
create policy "sjt_read" on public.service_job_transitions for select
  using (auth.role() = 'authenticated');

insert into public.service_job_transitions values
  ('Requested', 'Accepted',   'provider'),
  ('Requested', 'Cancelled',  'customer'),
  ('Requested', 'Cancelled',  'provider'),
  ('Requested', 'Cancelled',  'admin'),
  ('Accepted',  'Scheduled',  'provider'),
  ('Accepted',  'InProgress', 'provider'),
  ('Accepted',  'Cancelled',  'customer'),
  ('Accepted',  'Cancelled',  'admin'),
  ('Scheduled', 'InProgress', 'provider'),
  ('Scheduled', 'Cancelled',  'either'),
  ('InProgress','Completed',  'provider'),
  ('InProgress','Cancelled',  'admin')
on conflict do nothing;

create table if not exists public.service_job_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  from_status job_status,
  to_status job_status not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_company_id uuid references public.companies(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.service_job_history enable row level security;
drop policy if exists "sjh_read_parties" on public.service_job_history;
create policy "sjh_read_parties" on public.service_job_history for select
  using (
    public.is_admin() or exists (
      select 1 from public.service_jobs j
       where j.id = service_job_history.job_id
         and (public.is_member_of(j.customer_company_id) or public.is_member_of(j.provider_company_id))
    )
  );

create or replace function public.enforce_service_job_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sides text[];
  v_side text;
  v_is_cust boolean; v_is_prov boolean; v_is_admin boolean;
begin
  if new.status is null or old.status = new.status then
    return new;
  end if;
  v_is_admin := public.is_admin();
  v_is_cust := public.is_member_of(old.customer_company_id);
  v_is_prov := public.is_member_of(old.provider_company_id);

  select array_agg(actor_side) into v_sides
    from public.service_job_transitions
   where from_status = old.status and to_status = new.status;

  if v_sides is null then
    raise exception 'Invalid service job transition: % -> %', old.status, new.status using errcode='42501';
  end if;

  if v_is_admin and 'admin' = any(v_sides) then v_side := 'admin';
  elsif v_is_cust and ('customer' = any(v_sides) or 'either' = any(v_sides)) then v_side := 'customer';
  elsif v_is_prov and ('provider' = any(v_sides) or 'either' = any(v_sides)) then v_side := 'provider';
  elsif v_is_admin then v_side := 'admin';
  else
    raise exception 'Not authorized to transition job % -> %', old.status, new.status using errcode='42501';
  end if;

  insert into public.service_job_history (job_id, from_status, to_status, actor_user_id, actor_company_id, reason)
  values (
    old.id, old.status, new.status, auth.uid(),
    case v_side when 'customer' then old.customer_company_id
                when 'provider' then old.provider_company_id
                else null end,
    nullif(current_setting('request.job_transition_reason', true), '')
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_service_job_transition on public.service_jobs;
create trigger trg_enforce_service_job_transition
  before update of status on public.service_jobs
  for each row execute function public.enforce_service_job_transition();

-- Tighten RLS (drop old, add strict)
drop policy if exists "sj_parties_update" on public.service_jobs;
create policy "sj_parties_update" on public.service_jobs for update
  using (
    public.is_admin()
    or public.is_member_of(customer_company_id)
    or public.is_member_of(provider_company_id)
  ) with check (
    public.is_admin()
    or (
      customer_company_id = (select customer_company_id from public.service_jobs j where j.id = service_jobs.id)
      and provider_company_id = (select provider_company_id from public.service_jobs j where j.id = service_jobs.id)
      and service_id = (select service_id from public.service_jobs j where j.id = service_jobs.id)
    )
  );

drop policy if exists "sj_read_parties" on public.service_jobs;
create policy "sj_read_parties" on public.service_jobs for select
  using (
    public.is_admin()
    or public.is_member_of(customer_company_id)
    or public.is_member_of(provider_company_id)
  );

create or replace function public.transition_service_job(
  p_job_id uuid,
  p_next_status job_status,
  p_reason text default null,
  p_check_in boolean default false,
  p_check_out boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason is not null then
    perform set_config('request.job_transition_reason', p_reason, true);
  end if;
  update public.service_jobs
     set status = p_next_status,
         check_in_ts  = case when p_check_in  then coalesce(check_in_ts, now())  else check_in_ts  end,
         check_out_ts = case when p_check_out then coalesce(check_out_ts, now()) else check_out_ts end
   where id = p_job_id;
end;
$$;
grant execute on function public.transition_service_job(uuid, job_status, text, boolean, boolean) to authenticated;

-- =========================================================================
-- 2) Shift post: derive employer, enforce workflow via RPCs
-- =========================================================================
alter table public.shift_posts
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create or replace function public.shift_post_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if not public.is_admin() then
    if not public.is_member_of(new.employer_company_id) then
      raise exception 'Not a member of employer company %', new.employer_company_id using errcode='42501';
    end if;
  end if;
  if new.status is null then new.status := 'Posted'; end if;
  return new;
end;
$$;

drop trigger if exists trg_shift_post_before_insert on public.shift_posts;
create trigger trg_shift_post_before_insert
  before insert on public.shift_posts
  for each row execute function public.shift_post_before_insert();

alter table public.shift_assignments
  add column if not exists employer_company_id uuid references public.companies(id) on delete set null;

update public.shift_assignments a
   set employer_company_id = p.employer_company_id
  from public.shift_posts p
 where p.id = a.shift_id
   and a.employer_company_id is null;

create or replace function public.shift_assignment_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select employer_company_id into v_emp from public.shift_posts where id = new.shift_id;
  new.employer_company_id := v_emp;
  return new;
end;
$$;

drop trigger if exists trg_shift_assignment_before_insert on public.shift_assignments;
create trigger trg_shift_assignment_before_insert
  before insert on public.shift_assignments
  for each row execute function public.shift_assignment_before_insert();

-- RPC: employer accepts an applicant (creates assignment, updates app + shift)
create or replace function public.employer_accept_applicant(
  p_application_id uuid,
  p_rate numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_shift uuid; v_worker uuid; v_emp uuid; v_rate numeric; v_ass uuid;
begin
  select sa.shift_id, sa.worker_user_id, sp.employer_company_id,
         coalesce(p_rate, sp.hourly_rate, sp.flat_rate, 0)
    into v_shift, v_worker, v_emp, v_rate
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

  perform public.write_audit(
    'shift.accept_applicant','shift_applications', p_application_id::text,
    null, jsonb_build_object('assignment_id', v_ass, 'worker_user_id', v_worker),
    null, v_emp
  );
  return v_ass;
end;
$$;
grant execute on function public.employer_accept_applicant(uuid, numeric) to authenticated;

-- RPC: employer rejects
create or replace function public.employer_reject_applicant(
  p_application_id uuid,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select sp.employer_company_id into v_emp
    from public.shift_applications sa join public.shift_posts sp on sp.id = sa.shift_id
   where sa.id = p_application_id;
  if v_emp is null then raise exception 'Application not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_emp) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  update public.shift_applications set status = 'Rejected' where id = p_application_id;
  perform public.write_audit('shift.reject_applicant','shift_applications', p_application_id::text,
    null, jsonb_build_object('reason', p_reason), p_reason, v_emp);
end;
$$;
grant execute on function public.employer_reject_applicant(uuid, text) to authenticated;

-- RPC: worker clock in/out with certification enforcement when shift requires it
create or replace function public.worker_clock_in(p_assignment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_worker uuid; v_shift uuid; v_cat shift_category; v_te uuid;
begin
  select a.worker_user_id, a.shift_id, p.category
    into v_worker, v_shift, v_cat
    from public.shift_assignments a join public.shift_posts p on p.id = a.shift_id
   where a.id = p_assignment_id;
  if v_worker is null then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if v_worker <> auth.uid() and not public.is_admin() then
    raise exception 'Not your assignment' using errcode='42501';
  end if;

  -- If the shift requires a specific cert, ensure worker has approved one
  if v_cat in ('Forklift','HighReach') then
    if not exists (
      select 1 from public.worker_certifications c
       where c.worker_user_id = v_worker
         and c.type = v_cat::text
         and c.status = 'Approved'
         and (c.expiry_date is null or c.expiry_date > current_date)
    ) then
      raise exception 'Approved % certification required to start this shift', v_cat using errcode='42501';
    end if;
  end if;

  insert into public.time_entries (assignment_id, start_timestamp)
  values (p_assignment_id, now())
  returning id into v_te;

  update public.shift_assignments set status = 'InProgress' where id = p_assignment_id;
  perform public.write_audit('shift.clock_in','shift_assignments', p_assignment_id::text,
    null, jsonb_build_object('time_entry_id', v_te), null, null);
  return v_te;
end;
$$;
grant execute on function public.worker_clock_in(uuid) to authenticated;

create or replace function public.worker_clock_out(p_assignment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_worker uuid; v_te uuid;
begin
  select worker_user_id into v_worker from public.shift_assignments where id = p_assignment_id;
  if v_worker is null then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if v_worker <> auth.uid() and not public.is_admin() then
    raise exception 'Not your assignment' using errcode='42501';
  end if;
  select id into v_te from public.time_entries
   where assignment_id = p_assignment_id and end_timestamp is null
   order by start_timestamp desc limit 1;
  if v_te is null then raise exception 'No open time entry' using errcode='P0002'; end if;
  update public.time_entries set end_timestamp = now() where id = v_te;
  update public.shift_assignments set status = 'Completed' where id = p_assignment_id;
  perform public.write_audit('shift.clock_out','shift_assignments', p_assignment_id::text,
    null, jsonb_build_object('time_entry_id', v_te), null, null);
end;
$$;
grant execute on function public.worker_clock_out(uuid) to authenticated;

create or replace function public.employer_confirm_hours(
  p_time_entry_id uuid,
  p_hours numeric,
  p_notes text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_ass uuid;
begin
  select a.id, a.employer_company_id into v_ass, v_emp
    from public.time_entries te
    join public.shift_assignments a on a.id = te.assignment_id
   where te.id = p_time_entry_id;
  if v_emp is null then raise exception 'Entry not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_emp) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  update public.time_entries
     set employer_confirmed_hours = p_hours, employer_notes = coalesce(p_notes,'')
   where id = p_time_entry_id;
  update public.shift_assignments set status = 'Completed' where id = v_ass;
  perform public.write_audit('shift.confirm_hours','time_entries', p_time_entry_id::text,
    null, jsonb_build_object('hours', p_hours, 'notes', p_notes), null, v_emp);
end;
$$;
grant execute on function public.employer_confirm_hours(uuid, numeric, text) to authenticated;

-- Worker apply RPC (ensures worker = self)
create or replace function public.worker_apply_shift(p_shift_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_app uuid;
begin
  insert into public.shift_applications (shift_id, worker_user_id, status)
  values (p_shift_id, auth.uid(), 'Applied')
  on conflict (shift_id, worker_user_id) do update set status = 'Applied'
  returning id into v_app;
  perform public.write_audit('shift.apply','shift_applications', v_app::text,
    null, jsonb_build_object('shift_id', p_shift_id), null, null);
  return v_app;
end;
$$;
grant execute on function public.worker_apply_shift(uuid) to authenticated;

-- =========================================================================
-- 3) Admin company staff management (owner or admin)
-- =========================================================================
create or replace function public.company_add_member(
  p_company_id uuid,
  p_user_id uuid,
  p_role company_role default 'Staff'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and not public.is_owner_of(p_company_id) then
    raise exception 'Only company owner or admin' using errcode='42501';
  end if;
  insert into public.company_users (company_id, user_id, company_role, status)
  values (p_company_id, p_user_id, p_role, 'Active')
  on conflict (company_id, user_id) do update set company_role = excluded.company_role, status = 'Active';
  perform public.write_audit('company.add_member','company_users', p_user_id::text,
    null, jsonb_build_object('company_id', p_company_id, 'role', p_role), null, p_company_id);
end;
$$;
grant execute on function public.company_add_member(uuid, uuid, company_role) to authenticated;

create or replace function public.company_remove_member(
  p_company_id uuid,
  p_user_id uuid,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and not public.is_owner_of(p_company_id) then
    raise exception 'Only company owner or admin' using errcode='42501';
  end if;
  perform public.require_reason(p_reason);
  update public.company_users set status = 'Inactive'
    where company_id = p_company_id and user_id = p_user_id;
  perform public.write_audit('company.remove_member','company_users', p_user_id::text,
    null, jsonb_build_object('company_id', p_company_id), p_reason, p_company_id);
end;
$$;
grant execute on function public.company_remove_member(uuid, uuid, text) to authenticated;
