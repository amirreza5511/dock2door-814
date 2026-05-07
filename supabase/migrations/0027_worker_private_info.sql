-- Private/sensitive worker info — visible only to the worker themselves, Admin, SuperAdmin
create table if not exists public.worker_private_info (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  date_of_birth date,
  gender text check (gender in ('Male','Female','Non-binary','Prefer not to say')),
  work_permit_status text check (work_permit_status in ('Citizen','PR','Open Work Permit','Employer-Specific Work Permit','Student Work Permit','Other')),
  sin_number text,
  bank_institution_number text,
  bank_transit_number text,
  bank_account_number text,
  bank_account_holder_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.worker_private_info enable row level security;

-- Worker can read/write their own row
create policy "worker_private_info_self" on public.worker_private_info
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin and SuperAdmin can read all rows (read-only)
create policy "worker_private_info_admin_read" on public.worker_private_info
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('Admin','SuperAdmin')
    )
  );

-- Note: worker_certifications.type is already text, so new types (DriversLicence, CriminalRecordCheck)
-- are supported without a schema change.

-- Storage bucket 'worker-identity-docs' must be created in Supabase dashboard (private, no public access).
-- Used for: driver licence, criminal record check scans.
-- RLS: worker uploads their own, admin/superadmin can download via signed URL only.
