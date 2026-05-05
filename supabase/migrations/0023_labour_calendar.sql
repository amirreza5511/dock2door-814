-- Dock2Door — Labour Calendar (worker availability, conflicts, badges, work photos)
-- Builds on 0008 (shifts) and 0010 (reviews).

-- =============================================================
-- 1) Worker availability
-- =============================================================
do $$ begin
  create type availability_kind as enum ('available','unavailable','preferred');
exception when duplicate_object then null; end $$;

create table if not exists public.worker_availability (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  start_time text not null default '00:00',
  end_time   text not null default '23:59',
  kind availability_kind not null default 'available',
  preferred_area text default '',
  preferred_category shift_category,
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_worker_avail_user_date on public.worker_availability(worker_user_id, date);

alter table public.worker_availability enable row level security;
drop policy if exists wa_owner_all on public.worker_availability;
create policy wa_owner_all on public.worker_availability for all
  using (worker_user_id = auth.uid() or public.is_admin())
  with check (worker_user_id = auth.uid() or public.is_admin());

-- Authenticated employers/companies can read availability for scheduling.
drop policy if exists wa_read_authenticated on public.worker_availability;
create policy wa_read_authenticated on public.worker_availability for select
  using (auth.role() = 'authenticated');

-- =============================================================
-- 2) Worker profile extras (avatar, public photos toggle)
-- =============================================================
alter table public.worker_profiles
  add column if not exists avatar_path text default '',
  add column if not exists tagline text default '',
  add column if not exists allow_public_photos boolean not null default false;

-- =============================================================
-- 3) Work photos & documents (Instagram-style grid)
-- =============================================================
do $$ begin
  create type work_photo_visibility as enum ('private','company','public');
exception when duplicate_object then null; end $$;

create table if not exists public.work_photos (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  shift_assignment_id uuid references public.shift_assignments(id) on delete set null,
  file_path text not null,
  caption text default '',
  visibility work_photo_visibility not null default 'private',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_work_photos_user on public.work_photos(worker_user_id);

alter table public.work_photos enable row level security;
drop policy if exists wp_owner_all on public.work_photos;
create policy wp_owner_all on public.work_photos for all
  using (worker_user_id = auth.uid() or public.is_admin())
  with check (worker_user_id = auth.uid() or public.is_admin());

drop policy if exists wp_read_visibility on public.work_photos;
create policy wp_read_visibility on public.work_photos for select
  using (
    worker_user_id = auth.uid()
    or public.is_admin()
    or (visibility = 'public' and auth.role() = 'authenticated')
    or (visibility = 'company' and public.can_employer_see_worker(worker_user_id))
  );

-- =============================================================
-- 4) Worker badges (computed status flags)
-- =============================================================
create table if not exists public.worker_badges (
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  awarded_at timestamptz not null default now(),
  primary key (worker_user_id, code)
);
alter table public.worker_badges enable row level security;
drop policy if exists wb_read_all on public.worker_badges;
create policy wb_read_all on public.worker_badges for select
  using (auth.role() = 'authenticated');
drop policy if exists wb_admin_write on public.worker_badges;
create policy wb_admin_write on public.worker_badges for all
  using (public.is_admin()) with check (public.is_admin());

-- =============================================================
-- 5) No-show tracking
-- =============================================================
create table if not exists public.shift_no_shows (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shift_posts(id) on delete cascade,
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  employer_company_id uuid references public.companies(id) on delete set null,
  reason text default '',
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.shift_no_shows enable row level security;
drop policy if exists sns_read_parties on public.shift_no_shows;
create policy sns_read_parties on public.shift_no_shows for select
  using (
    public.is_admin()
    or worker_user_id = auth.uid()
    or (employer_company_id is not null and public.is_member_of(employer_company_id))
  );

-- =============================================================
-- 6) Conflict detection RPC
-- =============================================================
create or replace function public.shift_has_conflict(
  p_worker_user_id uuid,
  p_date date,
  p_start text,
  p_end text,
  p_exclude_shift_id uuid default null
) returns boolean language sql stable as $$
  select exists (
    select 1
      from public.shift_assignments a
      join public.shift_posts p on p.id = a.shift_id
     where a.worker_user_id = p_worker_user_id
       and a.status in ('Scheduled','InProgress')
       and p.date = p_date
       and (p_exclude_shift_id is null or p.id <> p_exclude_shift_id)
       and not (p.end_time <= p_start or p.start_time >= p_end)
  );
$$;
grant execute on function public.shift_has_conflict(uuid, date, text, text, uuid) to authenticated;

-- =============================================================
-- 7) Worker availability RPC (upsert by date+window)
-- =============================================================
create or replace function public.set_my_availability(
  p_date date,
  p_start text default '00:00',
  p_end text default '23:59',
  p_kind availability_kind default 'available',
  p_preferred_area text default '',
  p_preferred_category shift_category default null,
  p_notes text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.worker_availability (worker_user_id, date, start_time, end_time, kind, preferred_area, preferred_category, notes)
  values (auth.uid(), p_date, p_start, p_end, p_kind, p_preferred_area, p_preferred_category, p_notes)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.set_my_availability(date, text, text, availability_kind, text, shift_category, text) to authenticated;

create or replace function public.delete_my_availability(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.worker_availability
   where id = p_id and worker_user_id = auth.uid();
end;
$$;
grant execute on function public.delete_my_availability(uuid) to authenticated;

-- =============================================================
-- 8) No-show RPC
-- =============================================================
create or replace function public.mark_shift_no_show(
  p_shift_id uuid,
  p_worker_user_id uuid,
  p_reason text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid;
begin
  select employer_company_id into v_emp from public.shift_posts where id = p_shift_id;
  if v_emp is null then raise exception 'Shift not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_emp) then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  insert into public.shift_no_shows (shift_id, worker_user_id, employer_company_id, reason, recorded_by)
  values (p_shift_id, p_worker_user_id, v_emp, coalesce(p_reason,''), auth.uid())
  returning id into v_id;

  update public.shift_assignments
     set status = 'Cancelled'
   where shift_id = p_shift_id and worker_user_id = p_worker_user_id;

  -- auto-add at-risk badge
  insert into public.worker_badges(worker_user_id, code)
  values (p_worker_user_id, 'no_show_risk')
  on conflict do nothing;

  perform public.write_audit('shift.no_show','shift_posts', p_shift_id::text,
    null, jsonb_build_object('worker', p_worker_user_id, 'reason', p_reason),
    p_reason, v_emp);
  return v_id;
end;
$$;
grant execute on function public.mark_shift_no_show(uuid, uuid, text) to authenticated;
