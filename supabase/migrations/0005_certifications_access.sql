-- Dock2Door — worker certification access model
-- Worker: manages own (cannot change status)
-- Admin:  approves/rejects via RPCs (audited)
-- Employer: SELECT only when worker is ACTIVELY assigned to their shift

-- =========================================================================
-- 1) Extend worker_certifications to match the model
-- =========================================================================
do $$ begin
  create type certification_status as enum ('Pending','Approved','Rejected','Expired');
exception when duplicate_object then null; end $$;

alter table public.worker_certifications
  add column if not exists status certification_status,
  add column if not exists file_path text,
  add column if not exists notes text default '',
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

-- Backfill status from admin_approved legacy column
update public.worker_certifications
   set status = case when admin_approved then 'Approved'::certification_status
                     else 'Pending'::certification_status end
 where status is null;

alter table public.worker_certifications
  alter column status set not null,
  alter column status set default 'Pending';

-- Keep `certificate_file` + `file_path` in sync (legacy UI writes certificate_file)
update public.worker_certifications
   set file_path = certificate_file
 where file_path is null and certificate_file is not null;

-- =========================================================================
-- 2) can_employer_see_worker helper
-- =========================================================================
create or replace function public.can_employer_see_worker(p_worker_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.shift_assignments a
      join public.shift_posts p on p.id = a.shift_id
     where a.worker_user_id = p_worker_user_id
       and a.status in ('Scheduled','InProgress','Completed')
       and public.is_member_of(p.employer_company_id)
  );
$$;

-- =========================================================================
-- 3) Tighten RLS
-- =========================================================================
drop policy if exists "wc_self_read" on public.worker_certifications;
drop policy if exists "wc_self_write" on public.worker_certifications;

-- Worker can read own
create policy "wc_worker_read" on public.worker_certifications for select
  using (worker_user_id = auth.uid());

-- Admin read all
create policy "wc_admin_read" on public.worker_certifications for select
  using (public.is_admin());

-- Employer read via active assignment
create policy "wc_employer_read" on public.worker_certifications for select
  using (public.can_employer_see_worker(worker_user_id));

-- Worker can insert own (always Pending; trigger enforces)
create policy "wc_worker_insert" on public.worker_certifications for insert
  with check (worker_user_id = auth.uid());

-- Worker can update own file/expiry/notes but NOT status
create policy "wc_worker_update" on public.worker_certifications for update
  using (worker_user_id = auth.uid())
  with check (worker_user_id = auth.uid());

-- Worker cannot delete — only admin via RPC
create policy "wc_admin_delete" on public.worker_certifications for delete
  using (public.is_admin());

-- =========================================================================
-- 4) Enforce: workers can't change status; force Pending on insert
-- =========================================================================
create or replace function public.wc_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.status := 'Pending';
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.admin_approved := false;
    end if;
  elsif tg_op = 'UPDATE' then
    if not public.is_admin() then
      -- Status / approval / reviewer fields are locked for non-admins
      new.status := old.status;
      new.admin_approved := old.admin_approved;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wc_guard_ins on public.worker_certifications;
create trigger trg_wc_guard_ins before insert on public.worker_certifications
  for each row execute function public.wc_guard();

drop trigger if exists trg_wc_guard_upd on public.worker_certifications;
create trigger trg_wc_guard_upd before update on public.worker_certifications
  for each row execute function public.wc_guard();
