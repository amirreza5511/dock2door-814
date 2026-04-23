-- Dock2Door - Reviews & Ratings (idempotent)

-- 1) Enums
do $$ begin
  create type review_target_kind as enum ('company', 'worker');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_context_kind as enum (
    'warehouse_booking',
    'service_job',
    'shift_assignment'
  );
exception when duplicate_object then null; end $$;

-- 2) Table
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
  created_at timestamptz not null default now()
);

-- 3) Constraints (idempotent)
do $$ begin
  alter table public.reviews
    add constraint reviews_target_valid check (
      (target_kind = 'company' and target_company_id is not null and target_user_id is null)
      or (target_kind = 'worker' and target_user_id is not null and target_company_id is null)
    );
exception
  when duplicate_object then null;
  when others then null;
end $$;

do $$ begin
  alter table public.reviews
    add constraint reviews_unique_per_context
      unique (reviewer_user_id, context_kind, context_id, target_kind);
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- 4) Indexes
create index if not exists idx_reviews_target_company
  on public.reviews(target_company_id)
  where target_company_id is not null;

create index if not exists idx_reviews_target_user
  on public.reviews(target_user_id)
  where target_user_id is not null;

create index if not exists idx_reviews_context
  on public.reviews(context_kind, context_id);

create index if not exists idx_reviews_reviewer
  on public.reviews(reviewer_user_id);

-- 5) RLS: read-only to authenticated; writes only via post_review RPC
alter table public.reviews enable row level security;

drop policy if exists "reviews_read_all" on public.reviews;
create policy "reviews_read_all" on public.reviews
  for select
  using (auth.uid() is not null);

-- Explicitly no direct insert/update/delete policies => denied by RLS
drop policy if exists "reviews_no_direct_insert" on public.reviews;
drop policy if exists "reviews_no_direct_update" on public.reviews;
drop policy if exists "reviews_no_direct_delete" on public.reviews;

-- 6) Write RPC (SECURITY DEFINER, validates participation + context completion)
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

  return v_id;
end;
$fn$;

grant execute on function public.post_review(
  review_context_kind, uuid, review_target_kind, uuid, uuid, int, text
) to authenticated;

-- 7) Aggregated summaries view
create or replace view public.review_summaries as
  select
    'company'::review_target_kind as target_kind,
    target_company_id             as target_id,
    count(*)::int                 as count,
    round(avg(rating)::numeric, 2) as avg_rating
  from public.reviews
  where target_company_id is not null
  group by target_company_id
  union all
  select
    'worker'::review_target_kind as target_kind,
    target_user_id               as target_id,
    count(*)::int                as count,
    round(avg(rating)::numeric, 2) as avg_rating
  from public.reviews
  where target_user_id is not null
  group by target_user_id;

grant select on public.review_summaries to authenticated;
