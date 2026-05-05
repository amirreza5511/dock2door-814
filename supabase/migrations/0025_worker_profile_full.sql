-- Dock2Door — Worker profile completeness + safe creation RPC
-- Fixes "new row violates row-level security policy" for worker_profiles by
-- routing creation through a SECURITY DEFINER RPC that asserts auth.uid().
-- Also adds the resume-style fields companies expect to see on a worker profile.

-- =============================================================
-- 1) Extend worker_profiles with full resume fields
-- =============================================================
alter table public.worker_profiles
  add column if not exists phone text default '',
  add column if not exists languages text[] not null default '{}',
  add column if not exists experience_years integer not null default 0,
  add column if not exists transportation text default '',
  add column if not exists emergency_contact_name text default '',
  add column if not exists emergency_contact_phone text default '',
  add column if not exists references_text text default '',
  add column if not exists work_history text default '',
  add column if not exists education text default '',
  add column if not exists preferred_shift text default '',
  add column if not exists linkedin_url text default '',
  add column if not exists website_url text default '';

-- =============================================================
-- 2) Reassert RLS with explicit per-action policies (avoids any
--    previously misapplied combined "for all" policy edge cases).
-- =============================================================
alter table public.worker_profiles enable row level security;

drop policy if exists "wp_read_auth" on public.worker_profiles;
create policy "wp_read_auth" on public.worker_profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "wp_self_write" on public.worker_profiles;
drop policy if exists "wp_self_insert" on public.worker_profiles;
create policy "wp_self_insert" on public.worker_profiles
  for insert with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "wp_self_update" on public.worker_profiles;
create policy "wp_self_update" on public.worker_profiles
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "wp_self_delete" on public.worker_profiles;
create policy "wp_self_delete" on public.worker_profiles
  for delete using (user_id = auth.uid() or public.is_admin());

-- =============================================================
-- 3) Safe creation RPC — bypasses RLS edge cases by running as
--    SECURITY DEFINER and forcing user_id = auth.uid().
-- =============================================================
create or replace function public.ensure_my_worker_profile(
  p_display_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select id into v_id from public.worker_profiles where user_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  -- Derive a sensible display name fallback from profiles
  select coalesce(nullif(p_display_name, ''), nullif(name, ''), split_part(email, '@', 1), 'Worker')
    into v_name
    from public.profiles
   where id = v_uid;
  if v_name is null then v_name := 'Worker'; end if;

  insert into public.worker_profiles (user_id, display_name, skills, coverage_cities, hourly_expectation, bio, status)
  values (v_uid, v_name, '{}'::shift_category[], '{}'::text[], 0, '', 'Active')
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.ensure_my_worker_profile(text) to authenticated;

-- =============================================================
-- 4) Worker profile update RPC — single safe write surface for
--    extended resume fields (no need to enumerate column updates
--    in the client, and avoids ambiguous client-side RLS errors).
-- =============================================================
create or replace function public.update_my_worker_profile(
  p_display_name text default null,
  p_bio text default null,
  p_tagline text default null,
  p_skills shift_category[] default null,
  p_coverage_cities text[] default null,
  p_hourly_expectation numeric default null,
  p_phone text default null,
  p_languages text[] default null,
  p_experience_years integer default null,
  p_transportation text default null,
  p_emergency_contact_name text default null,
  p_emergency_contact_phone text default null,
  p_references_text text default null,
  p_work_history text default null,
  p_education text default null,
  p_preferred_shift text default null,
  p_linkedin_url text default null,
  p_website_url text default null,
  p_allow_public_photos boolean default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Make sure a profile exists first.
  v_id := public.ensure_my_worker_profile(p_display_name);

  update public.worker_profiles set
    display_name = coalesce(p_display_name, display_name),
    bio = coalesce(p_bio, bio),
    tagline = coalesce(p_tagline, tagline),
    skills = coalesce(p_skills, skills),
    coverage_cities = coalesce(p_coverage_cities, coverage_cities),
    hourly_expectation = coalesce(p_hourly_expectation, hourly_expectation),
    phone = coalesce(p_phone, phone),
    languages = coalesce(p_languages, languages),
    experience_years = coalesce(p_experience_years, experience_years),
    transportation = coalesce(p_transportation, transportation),
    emergency_contact_name = coalesce(p_emergency_contact_name, emergency_contact_name),
    emergency_contact_phone = coalesce(p_emergency_contact_phone, emergency_contact_phone),
    references_text = coalesce(p_references_text, references_text),
    work_history = coalesce(p_work_history, work_history),
    education = coalesce(p_education, education),
    preferred_shift = coalesce(p_preferred_shift, preferred_shift),
    linkedin_url = coalesce(p_linkedin_url, linkedin_url),
    website_url = coalesce(p_website_url, website_url),
    allow_public_photos = coalesce(p_allow_public_photos, allow_public_photos)
  where user_id = v_uid;

  return v_id;
end;
$$;

grant execute on function public.update_my_worker_profile(
  text, text, text, shift_category[], text[], numeric, text, text[], integer, text,
  text, text, text, text, text, text, text, text, boolean
) to authenticated;
