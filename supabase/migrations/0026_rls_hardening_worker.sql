-- Dock2Door — Complete RLS hardening for all worker-facing tables
-- Idempotent: safe to run on any database state (clean or partially-migrated).
-- Run this in the Supabase SQL editor if any "new row violates row-level security policy"
-- errors appear on worker_profiles, work_photos, worker_certifications, or worker_availability.

-- =============================================================
-- 1) worker_profiles — explicit per-action policies
-- =============================================================
alter table public.worker_profiles enable row level security;

drop policy if exists "wp_read_auth"    on public.worker_profiles;
drop policy if exists "wp_self_write"   on public.worker_profiles;
drop policy if exists "wp_self_insert"  on public.worker_profiles;
drop policy if exists "wp_self_update"  on public.worker_profiles;
drop policy if exists "wp_self_delete"  on public.worker_profiles;
drop policy if exists "wp_admin_all"    on public.worker_profiles;

create policy "wp_read_auth" on public.worker_profiles
  for select using (auth.role() = 'authenticated');

create policy "wp_self_insert" on public.worker_profiles
  for insert with check (user_id = auth.uid() or public.is_admin());

create policy "wp_self_update" on public.worker_profiles
  for update
  using  (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy "wp_self_delete" on public.worker_profiles
  for delete using (user_id = auth.uid() or public.is_admin());

-- =============================================================
-- 2) work_photos — explicit per-action policies
-- =============================================================
alter table public.work_photos enable row level security;

drop policy if exists "wp_owner_all"       on public.work_photos;
drop policy if exists "wp_read_visibility" on public.work_photos;
drop policy if exists "wph_owner_insert"   on public.work_photos;
drop policy if exists "wph_owner_select"   on public.work_photos;
drop policy if exists "wph_owner_update"   on public.work_photos;
drop policy if exists "wph_owner_delete"   on public.work_photos;
drop policy if exists "wph_read_visibility" on public.work_photos;

create policy "wph_owner_insert" on public.work_photos
  for insert with check (worker_user_id = auth.uid() or public.is_admin());

create policy "wph_owner_update" on public.work_photos
  for update
  using  (worker_user_id = auth.uid() or public.is_admin())
  with check (worker_user_id = auth.uid() or public.is_admin());

create policy "wph_owner_delete" on public.work_photos
  for delete using (worker_user_id = auth.uid() or public.is_admin());

create policy "wph_read_visibility" on public.work_photos
  for select using (
    worker_user_id = auth.uid()
    or public.is_admin()
    or (visibility = 'public'  and auth.role() = 'authenticated')
    or (visibility = 'company' and public.can_employer_see_worker(worker_user_id))
  );

-- =============================================================
-- 3) worker_certifications — explicit per-action policies
-- =============================================================
alter table public.worker_certifications enable row level security;

drop policy if exists "wc_self_read"     on public.worker_certifications;
drop policy if exists "wc_self_write"    on public.worker_certifications;
drop policy if exists "wc_worker_read"   on public.worker_certifications;
drop policy if exists "wc_admin_read"    on public.worker_certifications;
drop policy if exists "wc_employer_read" on public.worker_certifications;
drop policy if exists "wc_worker_insert" on public.worker_certifications;
drop policy if exists "wc_worker_update" on public.worker_certifications;
drop policy if exists "wc_admin_delete"  on public.worker_certifications;

create policy "wc_worker_read" on public.worker_certifications
  for select using (worker_user_id = auth.uid());

create policy "wc_admin_read" on public.worker_certifications
  for select using (public.is_admin());

create policy "wc_employer_read" on public.worker_certifications
  for select using (public.can_employer_see_worker(worker_user_id));

create policy "wc_worker_insert" on public.worker_certifications
  for insert with check (worker_user_id = auth.uid());

create policy "wc_worker_update" on public.worker_certifications
  for update
  using  (worker_user_id = auth.uid())
  with check (worker_user_id = auth.uid());

create policy "wc_admin_delete" on public.worker_certifications
  for delete using (public.is_admin());

-- =============================================================
-- 4) worker_availability — explicit per-action policies
-- =============================================================
alter table public.worker_availability enable row level security;

drop policy if exists "wa_owner_all"          on public.worker_availability;
drop policy if exists "wa_read_authenticated" on public.worker_availability;
drop policy if exists "wav_self_insert"       on public.worker_availability;
drop policy if exists "wav_self_select"       on public.worker_availability;
drop policy if exists "wav_self_update"       on public.worker_availability;
drop policy if exists "wav_self_delete"       on public.worker_availability;
drop policy if exists "wav_employer_select"   on public.worker_availability;

create policy "wav_self_insert" on public.worker_availability
  for insert with check (worker_user_id = auth.uid() or public.is_admin());

create policy "wav_self_update" on public.worker_availability
  for update
  using  (worker_user_id = auth.uid() or public.is_admin())
  with check (worker_user_id = auth.uid() or public.is_admin());

create policy "wav_self_delete" on public.worker_availability
  for delete using (worker_user_id = auth.uid() or public.is_admin());

-- Workers read own; authenticated employers + admins can read all (for scheduling)
create policy "wav_read_auth" on public.worker_availability
  for select using (auth.role() = 'authenticated');

-- =============================================================
-- 5) ensure_my_worker_profile — SECURITY DEFINER (bypasses RLS)
-- =============================================================
create or replace function public.ensure_my_worker_profile(
  p_display_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select id into v_id from public.worker_profiles where user_id = v_uid;
  if v_id is not null then return v_id; end if;

  select coalesce(
           nullif(trim(p_display_name), ''),
           nullif(trim(name), ''),
           split_part(email, '@', 1),
           'Worker'
         )
    into v_name
    from public.profiles
   where id = v_uid;

  if v_name is null then v_name := 'Worker'; end if;

  insert into public.worker_profiles
    (user_id, display_name, skills, coverage_cities, hourly_expectation, bio, status)
  values
    (v_uid, v_name, '{}'::shift_category[], '{}'::text[], 0, '', 'Active')
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.ensure_my_worker_profile(text) to authenticated;

-- =============================================================
-- 6) update_my_worker_profile — SECURITY DEFINER (single safe write)
-- =============================================================
create or replace function public.update_my_worker_profile(
  p_display_name           text    default null,
  p_bio                    text    default null,
  p_tagline                text    default null,
  p_skills                 shift_category[] default null,
  p_coverage_cities        text[]  default null,
  p_hourly_expectation     numeric default null,
  p_phone                  text    default null,
  p_languages              text[]  default null,
  p_experience_years       integer default null,
  p_transportation         text    default null,
  p_emergency_contact_name text    default null,
  p_emergency_contact_phone text   default null,
  p_references_text        text    default null,
  p_work_history           text    default null,
  p_education              text    default null,
  p_preferred_shift        text    default null,
  p_linkedin_url           text    default null,
  p_website_url            text    default null,
  p_allow_public_photos    boolean default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_id := public.ensure_my_worker_profile(p_display_name);

  update public.worker_profiles set
    display_name             = coalesce(p_display_name,            display_name),
    bio                      = coalesce(p_bio,                     bio),
    tagline                  = coalesce(p_tagline,                 tagline),
    skills                   = coalesce(p_skills,                  skills),
    coverage_cities          = coalesce(p_coverage_cities,         coverage_cities),
    hourly_expectation       = coalesce(p_hourly_expectation,      hourly_expectation),
    phone                    = coalesce(p_phone,                   phone),
    languages                = coalesce(p_languages,               languages),
    experience_years         = coalesce(p_experience_years,        experience_years),
    transportation           = coalesce(p_transportation,          transportation),
    emergency_contact_name   = coalesce(p_emergency_contact_name,  emergency_contact_name),
    emergency_contact_phone  = coalesce(p_emergency_contact_phone, emergency_contact_phone),
    references_text          = coalesce(p_references_text,         references_text),
    work_history             = coalesce(p_work_history,            work_history),
    education                = coalesce(p_education,               education),
    preferred_shift          = coalesce(p_preferred_shift,         preferred_shift),
    linkedin_url             = coalesce(p_linkedin_url,            linkedin_url),
    website_url              = coalesce(p_website_url,             website_url),
    allow_public_photos      = coalesce(p_allow_public_photos,     allow_public_photos)
  where user_id = v_uid;

  return v_id;
end;
$$;

grant execute on function public.update_my_worker_profile(
  text, text, text, shift_category[], text[], numeric, text, text[], integer, text,
  text, text, text, text, text, text, text, text, boolean
) to authenticated;

-- =============================================================
-- 7) set_my_availability — SECURITY DEFINER (upsert via RPC)
-- =============================================================
drop function if exists public.set_my_availability(date, text, text, availability_kind, text, shift_category, text);
create or replace function public.set_my_availability(
  p_date               date,
  p_start              text,
  p_end                text,
  p_kind               availability_kind default 'available',
  p_preferred_area     text              default '',
  p_preferred_category shift_category    default null,
  p_notes              text              default ''
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Upsert: one row per worker+date+start (replace if same slot)
  insert into public.worker_availability
    (worker_user_id, date, start_time, end_time, kind, preferred_area, preferred_category, notes)
  values
    (v_uid, p_date, p_start, p_end, p_kind, coalesce(p_preferred_area,''), p_preferred_category, coalesce(p_notes,''))
  on conflict (worker_user_id, date, start_time)
  do update set
    end_time           = excluded.end_time,
    kind               = excluded.kind,
    preferred_area     = excluded.preferred_area,
    preferred_category = excluded.preferred_category,
    notes              = excluded.notes
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.set_my_availability(date, text, text, availability_kind, text, shift_category, text) to authenticated;

-- Unique constraint needed for the ON CONFLICT clause above
do $$ begin
  alter table public.worker_availability
    add constraint uq_worker_avail_slot unique (worker_user_id, date, start_time);
exception when duplicate_table then null;
         when duplicate_object  then null;
         when sqlstate '42P07'  then null;
end $$;

-- =============================================================
-- 8) delete_my_availability — SECURITY DEFINER
-- =============================================================
create or replace function public.delete_my_availability(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from public.worker_availability
   where id = p_id
     and (worker_user_id = v_uid or public.is_admin());
end;
$$;

grant execute on function public.delete_my_availability(uuid) to authenticated;

-- =============================================================
-- 9) Ensure columns added by earlier migrations exist
--    (safe to run even if already present)
-- =============================================================
alter table public.worker_profiles
  add column if not exists avatar_path               text    default '',
  add column if not exists tagline                   text    default '',
  add column if not exists allow_public_photos       boolean not null default false,
  add column if not exists profile_photo_path        text    default '',
  add column if not exists completed_shift_count     integer not null default 0,
  add column if not exists rating_average            numeric(3,2) not null default 0,
  add column if not exists phone                     text    default '',
  add column if not exists languages                 text[]  not null default '{}',
  add column if not exists experience_years          integer not null default 0,
  add column if not exists transportation            text    default '',
  add column if not exists emergency_contact_name    text    default '',
  add column if not exists emergency_contact_phone   text    default '',
  add column if not exists references_text           text    default '',
  add column if not exists work_history              text    default '',
  add column if not exists education                 text    default '',
  add column if not exists preferred_shift           text    default '',
  add column if not exists linkedin_url              text    default '',
  add column if not exists website_url               text    default '';

alter table public.work_photos
  add column if not exists moderation_status text not null default 'pending'
    check (moderation_status in ('pending','approved','rejected')),
  add column if not exists rejection_reason text default '';
