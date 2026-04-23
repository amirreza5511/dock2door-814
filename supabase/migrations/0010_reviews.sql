-- Dock2Door — Reviews & Ratings

do $$ begin
  create type review_target_kind as enum (
    'company',
    'worker'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_context_kind as enum (
    'warehouse_booking',
    'service_job',
    'shift_assignment'
  );
exception when duplicate_object then null; end $$;

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

alter table public.reviews add column if not exists reviewer_user_id uuid;
alter table public.reviews add column if not exists reviewer_company_id uuid;
alter table public.reviews add column if not exists target_kind review_target_kind;
alter table public.reviews add column if not exists target_company_id uuid;
alter table public.reviews add column if not exists target_user_id uuid;
alter table public.reviews add column if not exists context_kind review_context_kind;
alter table public.reviews add column if not exists context_id uuid;
alter table public.reviews add column if not exists rating int;
alter table public.reviews add column if not exists comment text not null default '';
alter table public.reviews add column if not exists created_at timestamptz not null default now();

do $$ begin
  alter table public.reviews
    add constraint reviews_target_valid check (
      (target_kind = 'company' and target_company_id is not null and target_user_id is null)
      or (target_kind = 'worker' and target_user_id is not null and target_company_id is null)
    );
exception when duplicate_object then null; when others then null; end $$;

do $$ begin
  alter table public.reviews
    add constraint reviews_unique_per_context
      unique (reviewer_user_id, context_kind, context_id, target_kind);
exception when duplicate_object then null; when others then null; end $$;

create index if not exists idx_reviews_target_company on public.reviews(target_company_id) where target_company_id is not null;
create index if not exists idx_reviews_target_user on public.reviews(target_user_id) where target_user_id is not null;
create index if not exists idx_reviews_context on public.reviews(context_kind, context_id);
create index if not exists idx_reviews_reviewer on public.reviews(reviewer_user_id);

alter table public.reviews enable row level security;

drop policy if exists "reviews_read_all" on public.reviews;
create policy "reviews_read_all" on public.reviews for select
  using (auth.uid() is not null);

drop policy if exists "reviews_no_direct_insert" on public.reviews;
drop policy if exists "reviews_no_direct_update" on public.reviews;
drop policy if exists "reviews_no_direct_delete" on public.reviews;

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
      raise exception 'target_company_id required';
    end if;
  else
    if p_target_user_id is null then
      raise exception 'target_user_id required';
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
end;
$$;

grant execute on function public.post_review(
  review_context_kind, uuid, review_target_kind, uuid, uuid, int, text
) to authenticated;

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