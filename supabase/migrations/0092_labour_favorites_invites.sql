-- 0092_labour_favorites_invites.sql
-- Labour domain growth features:
--   1. worker_favorite_employers  — a worker bookmarks good employers.
--   2. employer_favorite_workers   — an employer keeps a trusted-worker shortlist.
--   3. shift_invitations           — an employer invites a specific worker to a shift;
--                                    the worker accepts (→ assignment) or declines.
--   4. notify_matching_workers     — when a shift is Posted, ping workers whose skill +
--                                    city match, and any worker who favorited the employer.
--
-- Idempotent. Safe to re-run.

-- ---------------------------------------------------------------------------
-- enum values for notifications used here
-- ---------------------------------------------------------------------------
do $$ begin
  alter type public.notification_kind add value if not exists 'shift_invitation';
exception when others then null; end $$;
do $$ begin
  alter type public.notification_kind add value if not exists 'shift_match';
exception when others then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. worker_favorite_employers
-- ---------------------------------------------------------------------------
create table if not exists public.worker_favorite_employers (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  employer_company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (worker_user_id, employer_company_id)
);
create index if not exists idx_wfe_worker on public.worker_favorite_employers(worker_user_id);
alter table public.worker_favorite_employers enable row level security;

do $$ begin
  create policy wfe_select_own on public.worker_favorite_employers
    for select using (worker_user_id = auth.uid() or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy wfe_insert_own on public.worker_favorite_employers
    for insert with check (worker_user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy wfe_delete_own on public.worker_favorite_employers
    for delete using (worker_user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. employer_favorite_workers
-- ---------------------------------------------------------------------------
create table if not exists public.employer_favorite_workers (
  id uuid primary key default gen_random_uuid(),
  employer_company_id uuid not null references public.companies(id) on delete cascade,
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employer_company_id, worker_user_id)
);
create index if not exists idx_efw_company on public.employer_favorite_workers(employer_company_id);
alter table public.employer_favorite_workers enable row level security;

do $$ begin
  create policy efw_select on public.employer_favorite_workers
    for select using (public.is_member_of(employer_company_id) or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy efw_insert on public.employer_favorite_workers
    for insert with check (public.is_member_of(employer_company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy efw_delete on public.employer_favorite_workers
    for delete using (public.is_member_of(employer_company_id));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. shift_invitations
-- ---------------------------------------------------------------------------
create table if not exists public.shift_invitations (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shift_posts(id) on delete cascade,
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  employer_company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'Pending',  -- Pending | Accepted | Declined | Cancelled | Expired
  message text default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (shift_id, worker_user_id)
);
create index if not exists idx_si_worker on public.shift_invitations(worker_user_id);
create index if not exists idx_si_shift on public.shift_invitations(shift_id);
alter table public.shift_invitations enable row level security;

do $$ begin
  create policy si_select on public.shift_invitations
    for select using (
      worker_user_id = auth.uid()
      or public.is_member_of(employer_company_id)
      or public.is_admin()
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 4. RPC: employer invites a worker to a shift
-- ---------------------------------------------------------------------------
create or replace function public.employer_invite_worker(
  p_shift_id uuid,
  p_worker_user_id uuid,
  p_message text default ''
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.shift_posts;
  v_inv_id uuid;
  v_company_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_shift from public.shift_posts where id = p_shift_id;
  if not found then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;

  if not (public.is_member_of(v_shift.employer_company_id) or public.is_admin()) then
    raise exception 'Not authorized for this shift' using errcode = '42501';
  end if;

  if v_shift.status not in ('Posted', 'Filled') then
    raise exception 'You can only invite workers to an open shift.' using errcode = 'P0001';
  end if;

  insert into public.shift_invitations (shift_id, worker_user_id, employer_company_id, message, created_by, status)
  values (p_shift_id, p_worker_user_id, v_shift.employer_company_id, coalesce(p_message, ''), auth.uid(), 'Pending')
  on conflict (shift_id, worker_user_id) do update
    set status = 'Pending', message = coalesce(excluded.message, ''), created_by = excluded.created_by,
        created_at = now(), responded_at = null
  returning id into v_inv_id;

  select name into v_company_name from public.companies where id = v_shift.employer_company_id;

  perform public.queue_notification(
    p_worker_user_id,
    'shift_invitation',
    'You''re invited to a shift',
    coalesce(v_company_name, 'An employer') || ' invited you to "' || coalesce(nullif(v_shift.title, ''), 'a shift') || '"',
    'shift',
    p_shift_id::text,
    jsonb_build_object('invitation_id', v_inv_id, 'shift_id', p_shift_id)
  );

  return v_inv_id;
end;
$$;
grant execute on function public.employer_invite_worker(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC: worker responds to an invitation
-- ---------------------------------------------------------------------------
create or replace function public.worker_respond_invitation(
  p_invitation_id uuid,
  p_accept boolean
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.shift_invitations;
  v_shift public.shift_posts;
  v_rate numeric;
  v_assigned int;
  v_worker_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_inv from public.shift_invitations where id = p_invitation_id;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.worker_user_id <> auth.uid() then
    raise exception 'Not your invitation' using errcode = '42501';
  end if;
  if v_inv.status <> 'Pending' then
    raise exception 'This invitation has already been answered.' using errcode = 'P0001';
  end if;

  select * into v_shift from public.shift_posts where id = v_inv.shift_id;
  if not found then
    raise exception 'Shift no longer exists' using errcode = 'P0002';
  end if;

  if not p_accept then
    update public.shift_invitations set status = 'Declined', responded_at = now() where id = p_invitation_id;
    perform public.queue_notification(
      coalesce(v_inv.created_by, v_shift.created_by),
      'shift_rejected',
      'Invitation declined',
      'A worker declined your invitation to "' || coalesce(nullif(v_shift.title, ''), 'a shift') || '"',
      'shift', v_shift.id::text, jsonb_build_object('shift_id', v_shift.id)
    );
    return 'Declined';
  end if;

  -- Accepting: gate on shift still open
  if v_shift.status not in ('Posted', 'Filled') then
    raise exception 'This shift is no longer accepting workers.' using errcode = 'P0001';
  end if;

  v_rate := coalesce(v_shift.hourly_rate, v_shift.flat_rate, 0);

  -- Create the assignment if one doesn't already exist for this worker.
  if not exists (
    select 1 from public.shift_assignments
    where shift_id = v_shift.id and worker_user_id = v_inv.worker_user_id and status <> 'Cancelled'
  ) then
    insert into public.shift_assignments (shift_id, worker_user_id, confirmed_rate, status)
    values (v_shift.id, v_inv.worker_user_id, v_rate, 'Scheduled');
  end if;

  -- Keep the application table consistent if a row exists.
  update public.shift_applications
    set status = 'Accepted'
    where shift_id = v_shift.id and worker_user_id = v_inv.worker_user_id;

  update public.shift_invitations set status = 'Accepted', responded_at = now() where id = p_invitation_id;

  -- Flip shift to Filled once enough workers are scheduled.
  select count(*) into v_assigned
    from public.shift_assignments
    where shift_id = v_shift.id and status <> 'Cancelled';
  if v_assigned >= v_shift.workers_needed and v_shift.status = 'Posted' then
    update public.shift_posts set status = 'Filled' where id = v_shift.id;
  end if;

  select coalesce(display_name, 'A worker') into v_worker_name
    from public.worker_profiles where user_id = v_inv.worker_user_id;

  perform public.queue_notification(
    coalesce(v_inv.created_by, v_shift.created_by),
    'worker_assigned',
    'Invitation accepted',
    coalesce(v_worker_name, 'A worker') || ' accepted your invitation to "' || coalesce(nullif(v_shift.title, ''), 'a shift') || '"',
    'shift', v_shift.id::text, jsonb_build_object('shift_id', v_shift.id)
  );

  return 'Accepted';
end;
$$;
grant execute on function public.worker_respond_invitation(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Notify matching + favoriting workers when a shift is Posted
-- ---------------------------------------------------------------------------
create or replace function public.notify_matching_workers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_company_name text;
begin
  -- Only fire when the shift becomes Posted (insert as Posted, or transition into Posted).
  if NEW.status <> 'Posted' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.status = 'Posted' then
    return NEW;
  end if;

  select name into v_company_name from public.companies where id = NEW.employer_company_id;

  for r in
    -- skill + city match, OR the worker favorited this employer
    select distinct wp.user_id
      from public.worker_profiles wp
     where wp.status = 'Active'
       and (
         (
           NEW.category = any(wp.skills)
           and (
             coalesce(array_length(wp.coverage_cities, 1), 0) = 0
             or exists (
               select 1 from unnest(wp.coverage_cities) c
               where lower(c) = lower(coalesce(NEW.location_city, ''))
             )
           )
         )
         or exists (
           select 1 from public.worker_favorite_employers f
           where f.worker_user_id = wp.user_id
             and f.employer_company_id = NEW.employer_company_id
         )
       )
  loop
    perform public.queue_notification(
      r.user_id,
      'shift_match',
      'New shift for you',
      coalesce(v_company_name, 'An employer') || ' posted "' || coalesce(nullif(NEW.title, ''), 'a shift')
        || '" in ' || coalesce(nullif(NEW.location_city, ''), 'your area'),
      'shift', NEW.id::text,
      jsonb_build_object('shift_id', NEW.id, 'category', NEW.category)
    );
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_matching_workers on public.shift_posts;
create trigger trg_notify_matching_workers
  after insert or update of status on public.shift_posts
  for each row execute function public.notify_matching_workers();
