-- Dock2Door — Storage buckets + per-bucket policies
-- Buckets are private. All access via signed URLs (Edge Function enforces).
-- Path conventions (first segment determines ownership):
--   certifications/{worker_user_id}/{certification_id}/{filename}
--   warehouse-docs/{warehouse_company_id}/{listing_id}/{filename}
--   booking-docs/{booking_id}/{uploader_company_id}/{filename}
--   invoices/{billed_company_id}/{invoice_id}/{filename}
--   attachments/{entity_type}/{entity_id}/{filename}

-- =========================================================================
-- 1) Buckets
-- =========================================================================
insert into storage.buckets (id, name, public) values
  ('certifications','certifications',false),
  ('warehouse-docs','warehouse-docs',false),
  ('booking-docs','booking-docs',false),
  ('invoices','invoices',false),
  ('attachments','attachments',false)
on conflict (id) do nothing;

-- =========================================================================
-- 2) storage_files metadata table (every upload has a DB row)
-- =========================================================================
create table if not exists public.storage_files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  entity_type text not null,
  entity_id uuid,
  company_id uuid references public.companies(id) on delete set null,
  uploader_user_id uuid references auth.users(id) on delete set null,
  mime text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);
create index if not exists idx_sf_entity on public.storage_files(entity_type, entity_id);
create index if not exists idx_sf_company on public.storage_files(company_id);

alter table public.storage_files enable row level security;

drop policy if exists "sf_read_scoped" on public.storage_files;
create policy "sf_read_scoped" on public.storage_files for select
  using (
    public.is_admin()
    or uploader_user_id = auth.uid()
    or (company_id is not null and public.is_member_of(company_id))
  );

drop policy if exists "sf_insert_self" on public.storage_files;
create policy "sf_insert_self" on public.storage_files for insert
  with check (
    public.is_admin()
    or uploader_user_id = auth.uid()
  );

drop policy if exists "sf_delete_self" on public.storage_files;
create policy "sf_delete_self" on public.storage_files for delete
  using (
    public.is_admin()
    or uploader_user_id = auth.uid()
  );

-- =========================================================================
-- 3) storage.objects policies — path-prefix + membership
--    storage.foldername(name)[1] returns first path segment.
-- =========================================================================

-- Drop any pre-existing Dock2Door policies (idempotent)
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'd2d_%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- --------------------- certifications -----------------------------------
-- INSERT: uploader must be the worker (first segment = auth.uid())
create policy "d2d_certs_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT: worker themself, admin, or employer with active assignment
create policy "d2d_certs_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'certifications' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.can_employer_see_worker(((storage.foldername(name))[1])::uuid)
    )
  );

create policy "d2d_certs_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'certifications' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- --------------------- warehouse-docs -----------------------------------
-- INSERT: uploader belongs to the warehouse_company_id (segment 1)
create policy "d2d_whdocs_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'warehouse-docs'
    and public.is_member_of(((storage.foldername(name))[1])::uuid)
  );

create policy "d2d_whdocs_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'warehouse-docs' and (
      public.is_admin()
      or public.is_member_of(((storage.foldername(name))[1])::uuid)
    )
  );

create policy "d2d_whdocs_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'warehouse-docs' and (
      public.is_admin()
      or public.is_member_of(((storage.foldername(name))[1])::uuid)
    )
  );

-- --------------------- booking-docs -------------------------------------
-- Path: booking-docs/{booking_id}/{uploader_company_id}/{filename}
-- INSERT: uploader_company_id (segment 2) must be caller's company AND they must
--         be a party to the booking (customer or warehouse).
create policy "d2d_bkdocs_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'booking-docs'
    and public.is_member_of(((storage.foldername(name))[2])::uuid)
    and exists (
      select 1 from public.warehouse_bookings b
       where b.id = ((storage.foldername(name))[1])::uuid
         and (public.is_member_of(b.customer_company_id) or public.is_member_of(b.warehouse_company_id))
    )
  );

create policy "d2d_bkdocs_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'booking-docs' and (
      public.is_admin()
      or exists (
        select 1 from public.warehouse_bookings b
         where b.id = ((storage.foldername(name))[1])::uuid
           and (public.is_member_of(b.customer_company_id) or public.is_member_of(b.warehouse_company_id))
      )
    )
  );

create policy "d2d_bkdocs_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'booking-docs' and (
      public.is_admin()
      or public.is_member_of(((storage.foldername(name))[2])::uuid)
    )
  );

-- --------------------- invoices -----------------------------------------
-- Path: invoices/{billed_company_id}/{invoice_id}/{filename}
create policy "d2d_invoices_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'invoices'
    and (public.is_admin() or public.is_member_of(((storage.foldername(name))[1])::uuid))
  );

create policy "d2d_invoices_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'invoices' and (
      public.is_admin()
      or public.is_member_of(((storage.foldername(name))[1])::uuid)
    )
  );

create policy "d2d_invoices_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'invoices' and public.is_admin()
  );

-- --------------------- attachments --------------------------------------
-- Path: attachments/{entity_type}/{entity_id}/{filename}
-- Policy: authenticated users may upload; read is gated by storage_files DB row.
create policy "d2d_att_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');

create policy "d2d_att_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments' and (
      public.is_admin()
      or exists (
        select 1 from public.storage_files f
         where f.bucket = 'attachments'
           and f.path = storage.objects.name
           and (f.uploader_user_id = auth.uid()
                or (f.company_id is not null and public.is_member_of(f.company_id)))
      )
    )
  );

create policy "d2d_att_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments' and (
      public.is_admin()
      or exists (
        select 1 from public.storage_files f
         where f.bucket = 'attachments'
           and f.path = storage.objects.name
           and f.uploader_user_id = auth.uid()
      )
    )
  );
