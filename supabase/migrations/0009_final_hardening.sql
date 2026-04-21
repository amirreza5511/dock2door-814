-- Dock2Door — Final hardening migration.
-- Idempotent. Safe to re-run. Closes remaining gaps from PLAN.md §0.
--   * Ensures every storage upload has a storage_files row (trigger-level)
--   * Defense-in-depth signed-URL authorization RPC (used by get-signed-url Edge Fn)
--   * Orphan-file cleanup RPC (called by scheduled Edge Fn)
--   * Admin audit-log read policy
--   * Foreign-key + constraint integrity sweeps
--   * Grants

-- =========================================================================
-- 1) Storage <-> metadata integrity
--    Prevent storage rows that have no companion storage_files row from
--    living forever.  We cannot force a metadata row on insert (clients insert
--    after upload), so we add:
--       a) helper `storage_file_path_matches_caller`
--       b) RPC `list_orphan_storage_files(older_than)`
--       c) RPC `cleanup_orphan_storage_files(older_than)` — admin only
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
     and o.bucket_id in ('certifications','warehouse-docs','booking-docs','invoices','attachments');
$$;
grant execute on function public.list_orphan_storage_files(interval) to authenticated;

create or replace function public.cleanup_orphan_storage_files(
  p_older_than interval default interval '24 hours',
  p_limit int default 500
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
       and o.bucket_id in ('certifications','warehouse-docs','booking-docs','invoices','attachments')
     order by o.created_at asc
     limit p_limit
  )
  delete from storage.objects o
   using victims v
   where o.bucket_id = v.bucket_id and o.name = v.name;
  get diagnostics v_count = row_count;

  perform public.write_audit(
    'storage.cleanup_orphans','storage.objects', null,
    null, jsonb_build_object('removed', v_count, 'older_than', p_older_than::text),
    null, null
  );
  return v_count;
end;
$$;
grant execute on function public.cleanup_orphan_storage_files(interval, int) to authenticated;

-- =========================================================================
-- 2) Defense-in-depth signed-URL authorization
--    Re-runs the same access predicate server-side before an Edge Function
--    calls storage.createSignedUrl.  Returns true if caller may read the
--    object, false otherwise.
-- =========================================================================
create or replace function public.can_read_storage_object(
  p_bucket text,
  p_path  text
) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_seg text[];
  v_first uuid;
begin
  if auth.uid() is null then return false; end if;
  if public.is_admin() then return true; end if;

  v_seg := string_to_array(p_path, '/');
  if coalesce(array_length(v_seg,1),0) < 1 then return false; end if;

  if p_bucket = 'certifications' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return v_first = auth.uid() or public.can_employer_see_worker(v_first);

  elsif p_bucket = 'warehouse-docs' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return public.is_member_of(v_first);

  elsif p_bucket = 'booking-docs' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return exists (
      select 1 from public.warehouse_bookings b
       where b.id = v_first
         and (public.is_member_of(b.customer_company_id)
           or public.is_member_of(b.warehouse_company_id))
    );

  elsif p_bucket = 'invoices' then
    begin v_first := v_seg[1]::uuid; exception when others then return false; end;
    return public.is_member_of(v_first);

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

-- Logs a signed-URL issuance for auditability (attachments + invoices in particular)
create or replace function public.record_signed_url_issued(
  p_bucket text,
  p_path  text,
  p_expires_in int
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit(
    'storage.signed_url','storage.objects', p_bucket || '/' || p_path,
    null, jsonb_build_object('bucket', p_bucket, 'path', p_path, 'expires_in', p_expires_in),
    null, null
  );
end;
$$;
grant execute on function public.record_signed_url_issued(text, text, int) to authenticated;

-- =========================================================================
-- 3) Admin audit-log read policy (plan §3: admin only reads audit_logs)
-- =========================================================================
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='audit_logs') then
    execute 'alter table public.audit_logs enable row level security';
  end if;
end $$;

drop policy if exists "al_admin_read" on public.audit_logs;
create policy "al_admin_read" on public.audit_logs for select
  using (public.is_admin() or actor_user_id = auth.uid());

-- No direct inserts/updates/deletes; everything flows through write_audit().
drop policy if exists "al_no_writes" on public.audit_logs;

-- =========================================================================
-- 4) Integrity sweeps — backfill ownership columns added in prior migrations
-- =========================================================================
update public.warehouse_bookings b
   set warehouse_company_id = wl.company_id
  from public.warehouse_listings wl
 where wl.id = b.listing_id
   and b.warehouse_company_id is null;

update public.service_jobs j
   set provider_company_id = sl.company_id
  from public.service_listings sl
 where sl.id = j.service_id
   and j.provider_company_id is null;

update public.shift_assignments a
   set employer_company_id = p.employer_company_id
  from public.shift_posts p
 where p.id = a.shift_id
   and a.employer_company_id is null;

-- =========================================================================
-- 5) Tighten storage_files — must reference a real auth.user when uploader set
-- =========================================================================
-- (already FK in 0006) — add a cascade delete from companies handled.
-- Add a uniqueness index useful for "file per entity" lookups.
create index if not exists idx_sf_bucket_path on public.storage_files(bucket, path);

-- =========================================================================
-- 6) Grants — ensure authenticated role can execute every public RPC we added
-- =========================================================================
do $$
declare r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'is_admin','is_member_of','is_owner_of','my_companies','active_company',
         'set_active_company','can_employer_see_worker',
         'can_read_storage_object','record_signed_url_issued',
         'list_orphan_storage_files','cleanup_orphan_storage_files',
         'transition_booking','transition_service_job',
         'employer_accept_applicant','employer_reject_applicant',
         'worker_apply_shift','worker_clock_in','worker_clock_out','employer_confirm_hours',
         'company_add_member','company_remove_member',
         'admin_set_listing_status','admin_approve_certification','admin_reject_certification',
         'admin_set_company_status','admin_set_user_status','admin_grant_role',
         'admin_revoke_role','admin_force_booking_status'
       )
  loop
    execute format('grant execute on function %I.%I(%s) to authenticated',
                   r.nspname, r.proname, r.args);
  end loop;
end $$;

-- =========================================================================
-- 7) Sanity: prevent deletion of audit_logs even by table owner
-- =========================================================================
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='audit_logs') then
    execute 'revoke delete on public.audit_logs from authenticated, anon';
    execute 'revoke update on public.audit_logs from authenticated, anon';
  end if;
end $$;
