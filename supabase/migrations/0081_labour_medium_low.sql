-- 0081_labour_medium_low.sql
-- Labour Stabilization — Medium + Low fixes for the Worker/Employer domain.
-- Idempotent and additive. No enum/RLS removals. Worker + Employer only.
--
-- Contents:
--   1) MEDIUM — configurable shift-category -> required-certification mapping
--              (replaces hardcoded Forklift/HighReach logic in worker_clock_in).
--   2) MEDIUM — employer_close_shift_post re-fire protection (no re-close / no
--              duplicate close notifications on an already-Completed shift).
--   3) LOW    — notification consistency: notify_shift_participants and
--              admin_assign_worker_to_shift route through queue_notification.
--   4) MEDIUM — post_review notifies the reviewed party (no duplicates).
--   5) MEDIUM — late-assigned workers auto-join the existing shift chat thread.

-- =========================================================================
-- 1) MEDIUM — configurable certification mapping
-- =========================================================================
-- Source of truth for "which shift category requires which certification".
-- Fallback behavior: if a category has NO row here, NO certification is
-- required (same as today for General/Driver). Seeded to preserve the current
-- Forklift/HighReach gate exactly.
create table if not exists public.shift_category_cert_requirements (
  category          shift_category primary key,
  required_cert_type text not null,
  updated_at        timestamptz not null default now()
);

insert into public.shift_category_cert_requirements (category, required_cert_type)
values ('Forklift', 'Forklift'), ('HighReach', 'HighReach')
on conflict (category) do nothing;

alter table public.shift_category_cert_requirements enable row level security;

drop policy if exists "cert_req_read_auth" on public.shift_category_cert_requirements;
create policy "cert_req_read_auth" on public.shift_category_cert_requirements
  for select using (auth.uid() is not null);

drop policy if exists "cert_req_admin_write" on public.shift_category_cert_requirements;
create policy "cert_req_admin_write" on public.shift_category_cert_requirements
  for all using (public.is_admin()) with check (public.is_admin());

-- Recreate worker_clock_in (keeps the 0080 signature + GPS capture + open-entry
-- guard) but resolves the required certification from the mapping table.
create or replace function public.worker_clock_in(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_worker uuid; v_shift uuid; v_cat shift_category; v_te uuid;
  v_required_cert text;
begin
  select a.worker_user_id, a.shift_id, p.category
    into v_worker, v_shift, v_cat
    from public.shift_assignments a join public.shift_posts p on p.id = a.shift_id
   where a.id = p_assignment_id;
  if v_worker is null then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if v_worker <> auth.uid() then
    raise exception 'Not your assignment' using errcode='42501';
  end if;

  -- Configurable certification gate. Fallback: no mapping row -> no cert required.
  select required_cert_type into v_required_cert
    from public.shift_category_cert_requirements
   where category = v_cat;

  if v_required_cert is not null then
    if not exists (
      select 1 from public.worker_certifications c
       where c.worker_user_id = v_worker
         and c.type = v_required_cert
         and c.status = 'Approved'
         and (c.expiry_date is null or c.expiry_date > current_date)
    ) then
      raise exception 'Approved % certification required to start this shift', v_required_cert using errcode='42501';
    end if;
  end if;

  -- Open-entry guard: block a second clock-in while one is still open.
  if exists (
    select 1 from public.time_entries
     where assignment_id = p_assignment_id and end_timestamp is null
  ) then
    raise exception 'You are already clocked in for this shift' using errcode='P0001';
  end if;

  insert into public.time_entries (assignment_id, start_timestamp, clock_in_lat, clock_in_lng, clock_in_accuracy)
  values (p_assignment_id, now(), p_lat, p_lng, p_accuracy)
  returning id into v_te;

  update public.shift_assignments set status = 'InProgress' where id = p_assignment_id;
  return v_te;
end; $$;
grant execute on function public.worker_clock_in(uuid, numeric, numeric, numeric) to authenticated;

-- =========================================================================
-- 2) MEDIUM — employer_close_shift_post re-fire protection
-- =========================================================================
-- Previously an already-Completed shift could be "closed" again, re-firing the
-- close notifications to every applicant/assignee. Now an already-Completed
-- shift is a no-op (no status write, no notifications, no audit churn).
create or replace function public.employer_close_shift_post(
  p_shift_id uuid,
  p_reason   text default 'Shift closed by employer'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift     public.shift_posts;
  v_before    jsonb;
  v_after     jsonb;
  v_open_cnt  int;
  v_title     text;
  v_body      text;
begin
  select * into v_shift from public.shift_posts where id = p_shift_id;
  if not found then
    raise exception 'shift_post % not found', p_shift_id using errcode = 'P0002';
  end if;

  -- Must be employer company member or admin
  if not (public.is_admin() or public.is_member_of(v_shift.employer_company_id)) then
    raise exception 'Access denied: not a member of the employer company' using errcode = '42501';
  end if;

  -- Re-fire protection: already closed -> no-op (no duplicate notifications).
  if v_shift.status = 'Completed' then
    return;
  end if;

  -- Only Posted / Filled / InProgress shifts can be closed.
  if v_shift.status not in ('Posted', 'Filled', 'InProgress') then
    raise exception 'Cannot close a shift with status %', v_shift.status;
  end if;

  -- Check for still-active assignments
  select count(*) into v_open_cnt
  from public.shift_assignments
  where shift_id = p_shift_id
    and status not in ('Completed', 'NoShow', 'Cancelled', 'Disputed');

  if v_open_cnt > 0 then
    raise exception '% assignment(s) are still active; confirm or mark no-show before closing',
      v_open_cnt;
  end if;

  v_before := to_jsonb(v_shift);

  update public.shift_posts
  set status = 'Completed'
  where id = p_shift_id;

  select to_jsonb(s.*) into v_after
  from public.shift_posts s
  where id = p_shift_id;

  -- Notify affected workers (applicants + assignees), deduped per user.
  v_title := 'Shift closed';
  v_body  := 'The shift "' || coalesce(v_shift.title, 'a shift') || '" has been closed.'
             || case when p_reason is not null and length(trim(p_reason)) > 0
                     then ' Reason: ' || p_reason
                     else '' end;

  perform public.queue_notification(
    aff.user_id,
    'shift',
    v_title,
    v_body,
    'shift_posts', p_shift_id::text,
    jsonb_build_object(
      'shift_id', p_shift_id,
      'shift_title', v_shift.title,
      'reason', p_reason,
      'source', aff.source
    )
  )
  from (
    select distinct sa.worker_user_id as user_id, 'application'::text as source
      from public.shift_applications sa
     where sa.shift_id = p_shift_id
       and sa.status in ('Applied', 'Withdrawn')
       and sa.worker_user_id is not null
    union
    select distinct asg.worker_user_id as user_id, 'assignment'::text as source
      from public.shift_assignments asg
     where asg.shift_id = p_shift_id
       and asg.worker_user_id is not null
  ) aff;

  perform public.write_audit(
    'shift.close', 'shift_posts', p_shift_id::text,
    v_before, v_after, p_reason,
    v_shift.employer_company_id
  );
end;
$$;
grant execute on function public.employer_close_shift_post(uuid, text) to authenticated;

-- =========================================================================
-- 3) LOW — notification consistency (route through queue_notification)
-- =========================================================================
-- Behavior is unchanged (same recipients, kind, title, body, entity, payload);
-- only the insert path is standardized onto queue_notification.
create or replace function public.notify_shift_participants(
  p_shift_id uuid, p_kind text, p_title text, p_body text
) returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct worker_user_id from public.shift_assignments where shift_id = p_shift_id
           union select distinct worker_user_id from public.shift_applications where shift_id = p_shift_id loop
    perform public.queue_notification(
      r.worker_user_id, p_kind, p_title, p_body,
      'shift', p_shift_id::text, jsonb_build_object('shift_id', p_shift_id)
    );
  end loop;
end; $$;
grant execute on function public.notify_shift_participants(uuid,text,text,text) to authenticated;

-- =========================================================================
-- 5) MEDIUM — late-assigned workers auto-join the shift chat thread
-- =========================================================================
-- open_shift_thread (0073) only syncs participants when the thread is opened.
-- If a worker is assigned AFTER the thread already exists, they were never added.
-- This helper (SECURITY DEFINER, so it bypasses the tp_self RLS limitation) adds
-- the worker to every existing thread linked to the shift. Idempotent.
create or replace function public.add_worker_to_shift_threads(p_shift_id uuid, p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_worker is null then return; end if;
  insert into public.thread_participants (thread_id, user_id)
  select t.id, p_worker
    from public.chat_threads t
   where t.shift_id = p_shift_id
  on conflict (thread_id, user_id) do nothing;
end; $$;
grant execute on function public.add_worker_to_shift_threads(uuid, uuid) to authenticated;

-- Recreate employer_accept_applicant (latest = 0036) adding the thread-join.
-- Notification behavior is preserved exactly.
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

  -- Add the newly assigned worker to any existing shift chat thread.
  perform public.add_worker_to_shift_threads(v_shift, v_worker);

  perform public.write_audit(
    'shift.accept_applicant','shift_applications', p_application_id::text,
    null, jsonb_build_object('assignment_id', v_ass, 'worker_user_id', v_worker),
    null, v_emp);
  return v_ass;
end;
$$;
grant execute on function public.employer_accept_applicant(uuid, numeric) to authenticated;

-- Recreate admin_assign_worker_to_shift (latest = 0024) with queue_notification
-- consistency + thread-join. Notification recipient/kind/payload unchanged.
create or replace function public.admin_assign_worker_to_shift(
  p_shift_id uuid, p_worker_user_id uuid, p_rate numeric default null,
  p_replace_assignment_id uuid default null, p_reason text default 'Admin assignment'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_shift public.shift_posts%rowtype; v_id uuid;
begin
  perform public.require_admin();
  select * into v_shift from public.shift_posts where id=p_shift_id;
  if not found then raise exception 'Shift not found' using errcode='P0002'; end if;
  if public.shift_has_conflict(p_worker_user_id, v_shift.date, v_shift.start_time, v_shift.end_time, p_shift_id) then
    raise exception 'Worker has overlapping assigned shift' using errcode='23514';
  end if;
  if p_replace_assignment_id is not null then update public.shift_assignments set status='Cancelled' where id=p_replace_assignment_id; end if;
  insert into public.shift_assignments(shift_id, worker_user_id, employer_company_id, confirmed_rate, status)
  values(p_shift_id, p_worker_user_id, v_shift.employer_company_id, coalesce(p_rate, v_shift.hourly_rate), 'Scheduled') returning id into v_id;
  update public.shift_posts set status = case when (select count(*) from public.shift_assignments where shift_id=p_shift_id and status='Scheduled') >= workers_needed then 'Filled' else status end where id=p_shift_id;

  perform public.queue_notification(
    p_worker_user_id, 'worker_assigned', 'You were assigned to a shift', v_shift.title,
    'shift_assignment', v_id::text, jsonb_build_object('shift_id', p_shift_id)
  );

  -- Add the newly assigned worker to any existing shift chat thread.
  perform public.add_worker_to_shift_threads(p_shift_id, p_worker_user_id);

  perform public.write_audit('shift.admin_assign','shift_assignments',v_id::text,null,jsonb_build_object('shift_id',p_shift_id,'worker_user_id',p_worker_user_id),p_reason,v_shift.employer_company_id);
  return v_id;
end; $$;
grant execute on function public.admin_assign_worker_to_shift(uuid,uuid,numeric,uuid,text) to authenticated;

-- =========================================================================
-- 4) MEDIUM — post_review notifies the reviewed party (no duplicates)
-- =========================================================================
-- The reviews_unique_per_context constraint makes a duplicate review raise and
-- abort before the notification runs, so each successful review notifies once.
create or replace function public.post_review(
  p_context_kind      review_context_kind,
  p_context_id        uuid,
  p_target_kind       review_target_kind,
  p_target_company_id uuid,
  p_target_user_id    uuid,
  p_rating            int,
  p_comment           text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid              uuid := auth.uid();
  v_reviewer_company uuid := null;
  v_customer_co      uuid;
  v_warehouse_co     uuid;
  v_provider_co      uuid;
  v_employer_co      uuid;
  v_worker           uuid;
  v_status           text;
  v_id               uuid;
  v_reviewer_name    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  if p_target_kind = 'company' then
    if p_target_company_id is null then
      raise exception 'target_company_id is required for company reviews';
    end if;
  else
    if p_target_user_id is null then
      raise exception 'target_user_id is required for worker reviews';
    end if;
  end if;

  -- Validate context + participation
  if p_context_kind = 'warehouse_booking' then
    select customer_company_id, warehouse_company_id, status::text
      into v_customer_co, v_warehouse_co, v_status
      from public.warehouse_bookings
     where id = p_context_id;

    if v_customer_co is null then
      raise exception 'Booking not found';
    end if;
    if lower(v_status) <> 'completed' then
      raise exception 'Can only review a completed booking';
    end if;
    if not (public.is_member_of(v_customer_co) or public.is_member_of(v_warehouse_co)) then
      raise exception 'Not a participant of this booking';
    end if;

    if public.is_member_of(v_customer_co) then
      v_reviewer_company := v_customer_co;
      if p_target_kind <> 'company' or p_target_company_id <> v_warehouse_co then
        raise exception 'Customer can only review the warehouse company';
      end if;
    else
      v_reviewer_company := v_warehouse_co;
      if p_target_kind <> 'company' or p_target_company_id <> v_customer_co then
        raise exception 'Warehouse can only review the customer company';
      end if;
    end if;

  elsif p_context_kind = 'service_job' then
    select customer_company_id, provider_company_id, status::text
      into v_customer_co, v_provider_co, v_status
      from public.service_jobs
     where id = p_context_id;

    if v_customer_co is null then
      raise exception 'Service job not found';
    end if;
    if lower(v_status) <> 'completed' then
      raise exception 'Can only review a completed service job';
    end if;
    if not (public.is_member_of(v_customer_co) or public.is_member_of(v_provider_co)) then
      raise exception 'Not a participant of this job';
    end if;

    if public.is_member_of(v_customer_co) then
      v_reviewer_company := v_customer_co;
      if p_target_kind <> 'company' or p_target_company_id <> v_provider_co then
        raise exception 'Customer can only review the service provider company';
      end if;
    else
      v_reviewer_company := v_provider_co;
      if p_target_kind <> 'company' or p_target_company_id <> v_customer_co then
        raise exception 'Service provider can only review the customer company';
      end if;
    end if;

  elsif p_context_kind = 'shift_assignment' then
    select employer_company_id, worker_user_id, status::text
      into v_employer_co, v_worker, v_status
      from public.shift_assignments
     where id = p_context_id;

    if v_employer_co is null then
      raise exception 'Shift assignment not found';
    end if;
    if lower(v_status) <> 'completed' then
      raise exception 'Can only review a completed shift';
    end if;

    if v_uid = v_worker then
      v_reviewer_company := null;
      if p_target_kind <> 'company' or p_target_company_id <> v_employer_co then
        raise exception 'Worker can only review the employer company';
      end if;
    elsif public.is_member_of(v_employer_co) then
      v_reviewer_company := v_employer_co;
      if p_target_kind <> 'worker' or p_target_user_id <> v_worker then
        raise exception 'Employer can only review the assigned worker';
      end if;
    else
      raise exception 'Not a participant of this shift';
    end if;
  else
    raise exception 'Unknown context kind';
  end if;

  insert into public.reviews (
    reviewer_user_id, reviewer_company_id,
    target_kind, target_company_id, target_user_id,
    context_kind, context_id, rating, comment
  ) values (
    v_uid, v_reviewer_company,
    p_target_kind, p_target_company_id, p_target_user_id,
    p_context_kind, p_context_id, p_rating, coalesce(p_comment, '')
  )
  returning id into v_id;

  -- Notify the reviewed party. Runs only on a fresh insert (the unique
  -- constraint aborts duplicates before reaching here), so no double-notify.
  select coalesce(nullif(name, ''), 'Someone') into v_reviewer_name
    from public.profiles where id = v_uid;

  if p_target_kind = 'company' then
    perform public.queue_notification(
      cu.user_id,
      'review',
      'New review received',
      v_reviewer_name || ' left a ' || p_rating || '-star review',
      'reviews', v_id::text,
      jsonb_build_object('review_id', v_id, 'rating', p_rating, 'context_kind', p_context_kind, 'context_id', p_context_id)
    )
    from public.company_users cu
    where cu.company_id = p_target_company_id and cu.status = 'Active';
  else
    perform public.queue_notification(
      p_target_user_id,
      'review',
      'New review received',
      v_reviewer_name || ' left you a ' || p_rating || '-star review',
      'reviews', v_id::text,
      jsonb_build_object('review_id', v_id, 'rating', p_rating, 'context_kind', p_context_kind, 'context_id', p_context_id)
    );
  end if;

  return v_id;
end;
$fn$;

grant execute on function public.post_review(
  review_context_kind, uuid, review_target_kind, uuid, uuid, int, text
) to authenticated;
