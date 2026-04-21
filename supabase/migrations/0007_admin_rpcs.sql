-- Dock2Door — Admin RPCs with before/after audit.
-- Admins cannot silently mutate; every destructive action requires a `reason`.

-- =========================================================================
-- Audit helper
-- =========================================================================
create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb,
  p_reason text default null,
  p_company_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs
    (actor_user_id, company_id, action, entity, entity_type, entity_id, previous_value, new_value, reason)
  values
    (auth.uid(), p_company_id, p_action, p_entity_type, p_entity_type, p_entity_id, p_before, p_after, p_reason);
end;
$$;

create or replace function public.require_reason(p_reason text)
returns void language plpgsql immutable as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for this action' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admin privilege required' using errcode = '42501';
  end if;
end;
$$;

-- =========================================================================
-- Admin: approve / reject warehouse listing
-- =========================================================================
create or replace function public.admin_set_listing_status(
  p_listing_id uuid,
  p_status listing_status,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.require_admin();
  if p_status in ('Suspended','Hidden') then perform public.require_reason(p_reason); end if;

  select to_jsonb(w.*) into v_before from public.warehouse_listings w where id = p_listing_id;
  update public.warehouse_listings set status = p_status where id = p_listing_id;
  select to_jsonb(w.*) into v_after from public.warehouse_listings w where id = p_listing_id;

  perform public.write_audit(
    'listing.set_status','warehouse_listings',p_listing_id::text,
    v_before, v_after, p_reason, (v_after->>'company_id')::uuid
  );
end; $$;
grant execute on function public.admin_set_listing_status(uuid, listing_status, text) to authenticated;

-- =========================================================================
-- Admin: approve / reject certification
-- =========================================================================
create or replace function public.admin_approve_certification(
  p_cert_id uuid,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.require_admin();

  select to_jsonb(c.*) into v_before from public.worker_certifications c where id = p_cert_id;
  update public.worker_certifications
     set status = 'Approved', admin_approved = true,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_cert_id;
  select to_jsonb(c.*) into v_after from public.worker_certifications c where id = p_cert_id;

  perform public.write_audit(
    'certification.approve','worker_certifications',p_cert_id::text,
    v_before, v_after, p_reason, null
  );
end; $$;
grant execute on function public.admin_approve_certification(uuid, text) to authenticated;

create or replace function public.admin_reject_certification(
  p_cert_id uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);

  select to_jsonb(c.*) into v_before from public.worker_certifications c where id = p_cert_id;
  update public.worker_certifications
     set status = 'Rejected', admin_approved = false,
         reviewed_by = auth.uid(), reviewed_at = now(), notes = p_reason
   where id = p_cert_id;
  select to_jsonb(c.*) into v_after from public.worker_certifications c where id = p_cert_id;

  perform public.write_audit(
    'certification.reject','worker_certifications',p_cert_id::text,
    v_before, v_after, p_reason, null
  );
end; $$;
grant execute on function public.admin_reject_certification(uuid, text) to authenticated;

-- =========================================================================
-- Admin: suspend / activate company
-- =========================================================================
create or replace function public.admin_set_company_status(
  p_company_id uuid,
  p_status company_status,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.require_admin();
  if p_status = 'Suspended' then perform public.require_reason(p_reason); end if;

  select to_jsonb(c.*) into v_before from public.companies c where id = p_company_id;
  update public.companies set status = p_status where id = p_company_id;
  select to_jsonb(c.*) into v_after from public.companies c where id = p_company_id;

  perform public.write_audit(
    'company.set_status','companies',p_company_id::text,
    v_before, v_after, p_reason, p_company_id
  );
end; $$;
grant execute on function public.admin_set_company_status(uuid, company_status, text) to authenticated;

-- =========================================================================
-- Admin: suspend / activate user
-- =========================================================================
create or replace function public.admin_set_user_status(
  p_user_id uuid,
  p_status active_status,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.require_admin();
  if p_status = 'Suspended' then perform public.require_reason(p_reason); end if;

  select to_jsonb(p.*) into v_before from public.profiles p where id = p_user_id;
  update public.profiles set status = p_status where id = p_user_id;
  select to_jsonb(p.*) into v_after from public.profiles p where id = p_user_id;

  perform public.write_audit(
    'user.set_status','profiles',p_user_id::text,
    v_before, v_after, p_reason, (v_after->>'company_id')::uuid
  );
end; $$;
grant execute on function public.admin_set_user_status(uuid, active_status, text) to authenticated;

-- =========================================================================
-- Admin: grant / revoke platform role
-- =========================================================================
create or replace function public.admin_grant_role(
  p_user_id uuid,
  p_role platform_role,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);
  insert into public.user_roles(user_id, role, granted_by) values (p_user_id, p_role, auth.uid())
    on conflict do nothing;
  perform public.write_audit(
    'role.grant','user_roles',p_user_id::text,
    null, jsonb_build_object('role', p_role), p_reason, null
  );
end; $$;
grant execute on function public.admin_grant_role(uuid, platform_role, text) to authenticated;

create or replace function public.admin_revoke_role(
  p_user_id uuid,
  p_role platform_role,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);
  delete from public.user_roles where user_id = p_user_id and role = p_role;
  perform public.write_audit(
    'role.revoke','user_roles',p_user_id::text,
    jsonb_build_object('role', p_role), null, p_reason, null
  );
end; $$;
grant execute on function public.admin_revoke_role(uuid, platform_role, text) to authenticated;

-- =========================================================================
-- Admin: force-transition booking (with audit + reason)
-- =========================================================================
create or replace function public.admin_force_booking_status(
  p_booking_id uuid,
  p_status booking_status,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);

  select to_jsonb(b.*) into v_before from public.warehouse_bookings b where id = p_booking_id;
  perform set_config('request.booking_transition_reason', p_reason, true);
  update public.warehouse_bookings set status = p_status where id = p_booking_id;
  select to_jsonb(b.*) into v_after from public.warehouse_bookings b where id = p_booking_id;

  perform public.write_audit(
    'booking.force_status','warehouse_bookings',p_booking_id::text,
    v_before, v_after, p_reason, (v_after->>'warehouse_company_id')::uuid
  );
end; $$;
grant execute on function public.admin_force_booking_status(uuid, booking_status, text) to authenticated;
