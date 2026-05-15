-- 0032_fix_storage_rls.sql
-- Fixes:
--   1. worker-photos bucket — created in 0024 but NO storage.objects RLS policies written
--      → every profile-photo and work-photo upload fails with RLS violation
--   2. shift-attachments bucket — same gap
--   3. worker_private_info admin-read policy — still uses legacy `profiles.role IN ('Admin','SuperAdmin')`
--      instead of `is_admin()` (user_roles table, migration 0003) → admin can't see private info
--   4. can_read_storage_object() — no branch for worker-photos or shift-attachments
--      → signed URL generation returns false for these buckets
--   5. storage_files.uploader_user_id — add DEFAULT auth.uid() so the metadata
--      insert never fails even when the client omits the column
-- All idempotent (drop … if exists before create, create or replace for functions).

-- =========================================================================
-- 1) storage.objects RLS — worker-photos
--    Path format: {worker_user_id}/{photo_id}/{filename}
-- =========================================================================
do $$
begin
  for r in (
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('d2d_wphotos_insert','d2d_wphotos_select','d2d_wphotos_delete')
  ) loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- INSERT: the worker uploads under their own user-id prefix
create policy "d2d_wphotos_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'worker-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT: owner, admin, or employer with an active/completed assignment
create policy "d2d_wphotos_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'worker-photos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.can_employer_see_worker(((storage.foldername(name))[1])::uuid)
    )
  );

-- DELETE: owner or admin
create policy "d2d_wphotos_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'worker-photos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- =========================================================================
-- 2) storage.objects RLS — shift-attachments
--    Path format: {employer_company_id}/{shift_id}/{filename}
-- =========================================================================
do $$
begin
  for r in (
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('d2d_sattach_insert','d2d_sattach_select','d2d_sattach_delete')
  ) loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- INSERT: employer company member uploads under their company prefix
create policy "d2d_sattach_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shift-attachments'
    and (
      public.is_admin()
      or public.is_member_of(((storage.foldername(name))[1])::uuid)
    )
  );

-- SELECT: admin, company member, or worker assigned to that shift
create policy "d2d_sattach_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'shift-attachments' and (
      public.is_admin()
      or public.is_member_of(((storage.foldername(name))[1])::uuid)
      or exists (
        select 1 from public.shift_assignments sa
         where sa.shift_id = ((storage.foldername(name))[2])::uuid
           and sa.worker_user_id = auth.uid()
           and sa.status in ('Scheduled','InProgress','Completed')
      )
    )
  );

-- DELETE: admin or company member
create policy "d2d_sattach_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'shift-attachments' and (
      public.is_admin()
      or public.is_member_of(((storage.foldername(name))[1])::uuid)
    )
  );

-- =========================================================================
-- 3) Fix worker_private_info admin-read policy
--    Old: profiles.role IN ('Admin','SuperAdmin')  ← legacy, broken since 0003
--    New: public.is_admin()  ← reads user_roles table
-- =========================================================================
drop policy if exists "worker_private_info_admin_read" on public.worker_private_info;
create policy "worker_private_info_admin_read" on public.worker_private_info
  for select using (public.is_admin());

-- Also ensure the self-write policy covers all cases cleanly (idempotent)
drop policy if exists "worker_private_info_self" on public.worker_private_info;
create policy "worker_private_info_self" on public.worker_private_info
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =========================================================================
-- 4) Update can_read_storage_object to handle worker-photos + shift-attachments
-- =========================================================================
create or replace function public.can_read_storage_object(
  p_bucket text,
  p_path   text
) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_seg   text[];
  v_first uuid;
  v_second uuid;
begin
  if auth.uid() is null then return false; end if;
  if public.is_admin() then return true; end if;

  v_seg := string_to_array(p_path, '/');
  if coalesce(array_length(v_seg, 1), 0) < 1 then return false; end if;

  -- ── certifications/{worker_user_id}/... ──────────────────────────────
  if p_bucket = 'certifications' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return v_first = auth.uid() or public.can_employer_see_worker(v_first);

  -- ── worker-photos/{worker_user_id}/... ───────────────────────────────
  elsif p_bucket = 'worker-photos' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return v_first = auth.uid() or public.can_employer_see_worker(v_first);

  -- ── shift-attachments/{company_id}/{shift_id}/... ────────────────────
  elsif p_bucket = 'shift-attachments' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    if public.is_member_of(v_first) then return true; end if;
    -- Worker assigned to that shift can also read
    if coalesce(array_length(v_seg, 1), 0) >= 2 then
      begin v_second := v_seg[2]::uuid; exception when others then return false; end;
      return exists (
        select 1 from public.shift_assignments sa
         where sa.shift_id = v_second
           and sa.worker_user_id = auth.uid()
           and sa.status in ('Scheduled','InProgress','Completed')
      );
    end if;
    return false;

  -- ── warehouse-docs/{company_id}/... ──────────────────────────────────
  elsif p_bucket = 'warehouse-docs' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return public.is_member_of(v_first);

  -- ── booking-docs/{booking_id}/... ────────────────────────────────────
  elsif p_bucket = 'booking-docs' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return exists (
      select 1 from public.warehouse_bookings b
       where b.id = v_first
         and (public.is_member_of(b.customer_company_id)
           or public.is_member_of(b.warehouse_company_id))
    );

  -- ── invoices/{company_id}/... ────────────────────────────────────────
  elsif p_bucket = 'invoices' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return public.is_member_of(v_first);

  -- ── attachments/{entity_type}/{entity_id}/... ────────────────────────
  elsif p_bucket = 'attachments' then
    return exists (
      select 1 from public.storage_files f
       where f.bucket = p_bucket and f.path = p_path
         and (f.uploader_user_id = auth.uid()
           or (f.company_id is not null and public.is_member_of(f.company_id)))
    );
  end if;

  return false;
end;
$$;

grant execute on function public.can_read_storage_object(text, text) to authenticated;

-- =========================================================================
-- 5) storage_files.uploader_user_id — add DEFAULT auth.uid()
--    Belt-and-suspenders: even if client omits the column, DB fills it in.
--    The sf_insert_self policy (uploader_user_id = auth.uid()) is always satisfied.
-- =========================================================================
alter table public.storage_files
  alter column uploader_user_id set default auth.uid();

-- =========================================================================
-- 6) Update orphan-cleanup helpers to include the two new buckets
--    (replaces the 0009 versions — CREATE OR REPLACE is idempotent)
-- =========================================================================
create or replace function public.list_orphan_storage_files(
  p_older_than interval default interval '24 hours'
) returns table (bucket_id text, name text, created_at timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id, o.name, o.created_at
    from storage.objects o
    left join public.storage_files f
           on f.bucket = o.bucket_id and f.path = o.name
   where f.id is null
     and o.created_at < now() - p_older_than
     and o.bucket_id in (
       'certifications','warehouse-docs','booking-docs','invoices',
       'attachments','worker-photos','shift-attachments'
     );
$$;

create or replace function public.cleanup_orphan_storage_files(
  p_older_than interval default interval '24 hours',
  p_limit      int      default 500
) returns int language plpgsql security definer set search_path = public, storage as $$
declare
  v_count int := 0;
begin
  perform public.require_admin();
  with victims as (
    select o.bucket_id, o.name
      from storage.objects o
      left join public.storage_files f
             on f.bucket = o.bucket_id and f.path = o.name
     where f.id is null
       and o.created_at < now() - p_older_than
       and o.bucket_id in (
         'certifications','warehouse-docs','booking-docs','invoices',
         'attachments','worker-photos','shift-attachments'
       )
     order by o.created_at asc
     limit p_limit
  )
  delete from storage.objects o
   using victims v
   where o.bucket_id = v.bucket_id and o.name = v.name;
  get diagnostics v_count = row_count;

  perform public.write_audit(
    'storage.cleanup_orphans', 'storage.objects', null,
    null, jsonb_build_object('removed', v_count, 'older_than', p_older_than::text),
    null, null
  );
  return v_count;
end;
$$;

grant execute on function public.list_orphan_storage_files(interval) to authenticated;
grant execute on function public.cleanup_orphan_storage_files(interval, int) to authenticated;

-- =========================================================================
-- 7) Re-assert storage_files INSERT policy
--    With DEFAULT auth.uid() on the column, clients that omit uploader_user_id
--    get it filled in automatically. The policy check is always satisfied.
--    Remove explicit null check — that was a security hole.
-- =========================================================================
drop policy if exists "sf_insert_self" on public.storage_files;
create policy "sf_insert_self" on public.storage_files for insert
  with check (
    public.is_admin()
    or uploader_user_id = auth.uid()
  );
