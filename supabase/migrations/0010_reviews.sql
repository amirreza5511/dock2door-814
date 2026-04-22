-- Dock2Door — Reviews & Ratings
-- Generic review table: customer<->warehouse, customer<->service-provider,
-- worker<->employer. Context-bound to a completed booking/job/assignment so
-- only real participants can review.

-- =========================================================================
-- 1) Enums
-- =========================================================================
do $$ begin
  create type review_target_kind as enum (
    'company',     -- reviewing a whole company (warehouse / customer / employer / service)
    'worker'       -- reviewing an individual worker (profile)
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_context_kind as enum (
    'warehouse_booking',
    'service_job',
    'shift_assignment'
  );
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2) Reviews table
-- =========================================================================
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_user_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_company_id uuid references public.companies(id) on delete set null,
  target_kind review_target_kind not null,
  target_company_id uuid references public.companies(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  context_kind review_context_kind not null,
  context_id uuid not null,
  rating int not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  constraint reviews_target_valid check (
    (target_kind = 'company' and target_company_id is not null and target_user_id is null)
    or (target_kind = 'worker' and target_user_id is not null and target_company_id is null)
  ),
  constraint reviews_unique_per_context
    unique (reviewer_user_id, context_kind, context_id, target_kind)
);

create index if not exists idx_reviews_target_company on public.reviews(target_company_id) where target_company_id is not null;
create index if not exists idx_reviews_target_user on public.reviews(target_user_id) where target_user_id is not null;
create index if not exists idx_reviews_context on public.reviews(context_kind, context_id);
create index if not exists idx_reviews_reviewer on public.reviews(reviewer_user_id);

alter table public.reviews enable row level security;

-- =========================================================================
-- 3) RLS — reviews are public-read for authenticated users (reputation), writes
--    happen only via post_review() RPC below
-- =========================================================================
drop policy if exists "reviews_read_all" on public.reviews;
create policy "reviews_read_all" on public.reviews for select
  using (auth.uid() is not null);

drop policy if exists "reviews_no_direct_insert" on public.reviews;
drop policy if exists "reviews_no_direct_update" on public.reviews;
drop policy if exists "reviews_no_direct_delete" on public.reviews;
-- No policies for insert/update/delete on purpose → denied by default.
-- RPC below (SECURITY DEFINER) is the only write path.

-- =========================================================================
-- 4) post_review — validates caller is a real participant of the context
-- =========================================================================
create or replace function public.post_review(
  p_context_kind review_context_kind,
  p_context_id  uuid,
  p_target_kind review_target_kind,
  p_target_company_id uuid,
  p_target_user_id uuid,
  p_rating int,
  p_comment text default ''
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reviewer_company uuid := null;
  v_customer_co uuid;
  v_warehouse_co uuid;
  v_provider_co uuid;
  v_employer_co uuid;
  v_worker uuid;
  v_booking_status text;
  v_job_status text;
  v_assignment_status text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if p_target_kind = 'company' then
    if p_target_company_id is null then
      raise exception 'target_company_id required for company review';
    end if;
  else
    if p_target_user_id is null then
      raise exception 'target_user_id required for worker review';
    end if;
  end if;

  if p_context_kind = 'warehouse_booking' then
    select customer_company_id, warehouse_company_id, status
      into v_customer_co, v_warehouse_co, v_booking_status
      from public.warehouse_bookings where id = p_context_id;
    if v_customer_co is null then
      raise exception 'Booking not found';
    end if;
    if v_booking_status <> 'Completed' then
      raise exception 'Can only review completed bookings';
    end if;
    -- Reviewer must be a member of customer OR warehouse side
    if public.is_member_of(v_customer_co) then
      v_reviewer_company := v_customer_co;
      -- Customer reviews warehouse company
      if p_target_kind <> 'company' or p_target_company_id <> v_warehouse_co then
        raise exception 'Customer may only review the warehouse company for this booking';
      end if;
    elsif public.is_member_of(v_warehouse_co) then
      v_reviewer_company := v_warehouse_co;
      if p_target_kind <> 'company' or p_target_company_id <> v_customer_co then
        raise exception 'Warehouse may only review the customer company for this booking';
      end if;
    else
      raise exception 'Not a participant of this booking';
    end if;

  elsif p_context_kind = 'service_job' then
    select customer_company_id, provider_company_id, status
      into v_customer_co, v_provider_co, v_job_status
      from public.service_jobs where id = p_context_id;
    if v_customer_co is null then
      raise exception 'Service job not found';
    end if;
    if v_job_status <> 'Completed' then
      raise exception 'Can only review completed service jobs';
    end if;
    if public.is_member_of(v_customer_co) then
      v_reviewer_company := v_customer_co;
      if p_target_kind <> 'company' or p_target_company_id <> v_provider_co then
        raise exception 'Customer may only review the service provider for this job';
      end if;
    elsif public.is_member_of(v_provider_co) then
      v_reviewer_company := v_provider_co;
      if p_target_kind <> 'company' or p_target_company_id <> v_customer_co then
        raise exception 'Provider may only review the customer for this job';
      end if;
    else
      raise exception 'Not a participant of this service job';
    end if;

  elsif p_context_kind = 'shift_assignment' then
    select a.worker_user_id, a.employer_company_id, a.status
      into v_worker, v_employer_co, v_assignment_status
      from public.shift_assignments a where a.id = p_context_id;
    if v_worker is null then
      raise exception 'Assignment not found';
    end if;
    if v_assignment_status not in ('Completed', 'HoursConfirmed', 'Confirmed') then
      raise exception 'Can only review completed assignments';
    end if;
    if v_worker = v_uid then
      -- Worker reviews employer company
      if p_target_kind <> 'company' or p_target_company_id <> v_employer_co then
        raise exception 'Worker may only review the employer company for this assignment';
      end if;
    elsif public.is_member_of(v_employer_co) then
      v_reviewer_company := v_employer_co;
      if p_target_kind <> 'worker' or p_target_user_id <> v_worker then
        raise exception 'Employer may only review the worker for this assignment';
      end if;
    else
      raise exception 'Not a participant of this assignment';
    end if;
  end if;

  insert into public.reviews (
    reviewer_user_id, reviewer_company_id,
    target_kind, target_company_id, target_user_id,
    context_kind, context_id, rating, comment
  ) values (
    v_uid, v_reviewer_company,
    p_target_kind, p_target_company_id, p_target_user_id,
    p_context_kind, p_context_id, p_rating, coalesce(p_comment, '')
  ) returning id into v_id;

  return v_id;
exception when unique_violation then
  raise exception 'You have already reviewed this';
end;
$$;

grant execute on function public.post_review(
  review_context_kind, uuid, review_target_kind, uuid, uuid, int, text
) to authenticated;

-- =========================================================================
-- 5) Aggregate view — average rating + count per target
-- =========================================================================
create or replace view public.review_summaries as
  select
    'company'::review_target_kind as target_kind,
    target_company_id as target_id,
    count(*)::int as count,
    round(avg(rating)::numeric, 2) as avg_rating
    from public.reviews
   where target_company_id is not null
   group by target_company_id
  union all
  select
    'worker'::review_target_kind as target_kind,
    target_user_id as target_id,
    count(*)::int as count,
    round(avg(rating)::numeric, 2) as avg_rating
    from public.reviews
   where target_user_id is not null
   group by target_user_id;

grant select on public.review_summaries to authenticated;
