-- Dock2Door — Company profile completion + trust + approval context.
-- Idempotent. Adds real Create / Edit Company Profile fields, posting gates,
-- and Super Admin approval context on top of the existing companies table.

-- =========================================================================
-- 1) PROFILE FIELDS (public worker-facing + private business + trust)
-- =========================================================================
alter table public.companies add column if not exists display_name text;
alter table public.companies add column if not exists industry text;            -- e.g. "Logistics", "Warehousing"
alter table public.companies add column if not exists public_bio text;
alter table public.companies add column if not exists logo_url text;            -- storage path or external url
alter table public.companies add column if not exists website text;
alter table public.companies add column if not exists public_contact_email text;
alter table public.companies add column if not exists public_contact_phone text;

-- Private business info
alter table public.companies add column if not exists legal_business_name text;
alter table public.companies add column if not exists business_number text;
alter table public.companies add column if not exists business_address text;
alter table public.companies add column if not exists admin_contact_name text;
alter table public.companies add column if not exists admin_contact_email text;
alter table public.companies add column if not exists admin_contact_phone text;

-- Trust / approval workflow
alter table public.companies add column if not exists profile_completed_at timestamptz;
alter table public.companies add column if not exists submitted_for_approval_at timestamptz;
alter table public.companies add column if not exists approval_rejection_reason text;
alter table public.companies add column if not exists verified_at timestamptz;

-- =========================================================================
-- 2) PROFILE COMPLETENESS HELPER
-- =========================================================================
-- A company is considered "profile complete" once these core public + private
-- + billing fields are filled. Used by both the posting gate and the dashboard
-- completion checklist.
create or replace function public.company_profile_is_complete(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.companies c
     where c.id = p_company_id
       and coalesce(nullif(trim(c.name), ''), nullif(trim(c.display_name), '')) is not null
       and coalesce(nullif(trim(c.city), ''), '') <> ''
       and coalesce(nullif(trim(c.industry), ''), '') <> ''
       and coalesce(nullif(trim(c.public_bio), ''), '') <> ''
       and coalesce(nullif(trim(c.legal_business_name), ''), '') <> ''
       and coalesce(nullif(trim(c.admin_contact_name), ''), '') <> ''
       and coalesce(nullif(trim(c.admin_contact_email), ''), '') <> ''
       and c.billing_setup_completed_at is not null
  );
$$;
grant execute on function public.company_profile_is_complete(uuid) to authenticated;

-- =========================================================================
-- 3) UPDATE PROFILE (owner / admin of the company)
-- =========================================================================
create or replace function public.company_update_profile(
  p_company_id uuid,
  p_display_name text,
  p_industry text,
  p_city text,
  p_public_bio text,
  p_logo_url text,
  p_website text,
  p_public_contact_email text,
  p_public_contact_phone text,
  p_legal_business_name text,
  p_business_number text,
  p_business_address text,
  p_admin_contact_name text,
  p_admin_contact_email text,
  p_admin_contact_phone text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select to_jsonb(c) into v_before from public.companies c where c.id = p_company_id;
  if v_before is null then raise exception 'company not found'; end if;

  update public.companies set
    display_name           = coalesce(nullif(trim(p_display_name), ''), display_name),
    industry               = coalesce(nullif(trim(p_industry), ''), industry),
    city                   = coalesce(nullif(trim(p_city), ''), city),
    public_bio             = nullif(trim(coalesce(p_public_bio, '')), ''),
    logo_url               = nullif(trim(coalesce(p_logo_url, '')), ''),
    website                = nullif(trim(coalesce(p_website, '')), ''),
    public_contact_email   = nullif(trim(coalesce(p_public_contact_email, '')), ''),
    public_contact_phone   = nullif(trim(coalesce(p_public_contact_phone, '')), ''),
    legal_business_name    = nullif(trim(coalesce(p_legal_business_name, '')), ''),
    business_number        = nullif(trim(coalesce(p_business_number, '')), ''),
    business_address       = nullif(trim(coalesce(p_business_address, '')), ''),
    admin_contact_name     = nullif(trim(coalesce(p_admin_contact_name, '')), ''),
    admin_contact_email    = nullif(trim(coalesce(p_admin_contact_email, '')), ''),
    admin_contact_phone    = nullif(trim(coalesce(p_admin_contact_phone, '')), '')
  where id = p_company_id;

  -- Stamp completion when all required pieces land.
  if public.company_profile_is_complete(p_company_id) then
    update public.companies
       set profile_completed_at = coalesce(profile_completed_at, now())
     where id = p_company_id;
  end if;

  perform public.write_audit('company.profile_updated', 'companies', p_company_id::text, v_before,
    (select to_jsonb(c) from public.companies c where c.id = p_company_id), '');
end; $$;
grant execute on function public.company_update_profile(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

-- =========================================================================
-- 4) SUBMIT FOR APPROVAL (owner/admin of company)
-- =========================================================================
create or replace function public.company_submit_for_approval(p_company_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.company_profile_is_complete(p_company_id) then
    raise exception 'profile incomplete — fill all required fields and billing first';
  end if;
  update public.companies
     set status = case
                    when status in ('Active','Approved') then status
                    else 'PendingApproval'
                  end,
         submitted_for_approval_at = coalesce(submitted_for_approval_at, now())
   where id = p_company_id;
  perform public.write_audit('company.submitted_for_approval', 'companies', p_company_id::text, null,
    jsonb_build_object('submitted_at', now()), '');
end; $$;
grant execute on function public.company_submit_for_approval(uuid) to authenticated;

-- =========================================================================
-- 5) ADMIN: SET APPROVAL STATUS WITH REASON
-- =========================================================================
-- Approve / reject / suspend with reason captured. Stamps verified_at on
-- Approved/Active so the worker-facing verified badge is honest.
create or replace function public.admin_set_company_approval(
  p_company_id uuid,
  p_status text,             -- 'Approved' | 'Active' | 'Rejected' | 'Suspended' | 'PendingApproval'
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform public.require_admin();
  if p_status not in ('Approved','Active','Rejected','Suspended','PendingApproval') then
    raise exception 'invalid status';
  end if;
  if p_status in ('Rejected','Suspended') then
    perform public.require_reason(p_reason);
  end if;
  select to_jsonb(c) into v_before from public.companies c where c.id = p_company_id;
  if v_before is null then raise exception 'company not found'; end if;

  update public.companies set
    status = p_status,
    verified_at = case when p_status in ('Approved','Active') then coalesce(verified_at, now()) else verified_at end,
    approval_rejection_reason = case when p_status in ('Rejected','Suspended') then p_reason else null end
  where id = p_company_id;

  perform public.write_audit('company.approval_changed', 'companies', p_company_id::text, v_before,
    (select to_jsonb(c) from public.companies c where c.id = p_company_id), coalesce(p_reason, ''));
end; $$;
grant execute on function public.admin_set_company_approval(uuid, text, text) to authenticated;

-- =========================================================================
-- 6) WORKER-FACING PUBLIC VIEW (safe columns only)
-- =========================================================================
-- Selectable by any authenticated user — exposes ONLY public-safe fields.
create or replace view public.companies_public as
select c.id,
       coalesce(nullif(trim(c.display_name), ''), c.name) as display_name,
       c.industry,
       c.city,
       c.public_bio,
       c.logo_url,
       c.website,
       c.public_contact_email,
       c.public_contact_phone,
       c.status,
       c.verified_at,
       c.created_at
  from public.companies c;

grant select on public.companies_public to authenticated, anon;
