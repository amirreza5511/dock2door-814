-- Dock2Door — Fixes for 0064 company profile completion + trust logic.
-- Idempotent. Addresses:
--   1) separate profile / billing / posting helpers
--   2) profile_completed_at must reset when profile becomes incomplete
--   3) trust-critical field edits revoke verified state
--   4) public contact visibility flags
--   5) logo_url documented as public URL only
--   6) re-submission moves Active/Approved back to PendingApproval on changed trust

-- =========================================================================
-- 1) PUBLIC-CONTACT VISIBILITY FLAGS
-- =========================================================================
alter table public.companies
  add column if not exists show_public_contact_email boolean not null default false;
alter table public.companies
  add column if not exists show_public_contact_phone boolean not null default false;

-- Document logo_url contract: public URL only (no private storage path).
comment on column public.companies.logo_url is
  'Public HTTPS URL of the company logo (never a private storage path). Exposed via companies_public.';

-- =========================================================================
-- 2) SEPARATE COMPLETION / READINESS HELPERS
-- =========================================================================
-- profile-only: trust + public + private fields. Does NOT require billing.
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
  );
$$;
grant execute on function public.company_profile_is_complete(uuid) to authenticated;

-- billing-only: billing setup landed.
create or replace function public.company_billing_is_complete(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.companies c
     where c.id = p_company_id
       and c.billing_setup_completed_at is not null
       and coalesce(nullif(trim(c.billing_contact_name), ''), '') <> ''
       and coalesce(nullif(trim(c.billing_email), ''), '') <> ''
       and c.billing_mode in ('ManualInvoice','CardOnFile','StripeCheckout')
  );
$$;
grant execute on function public.company_billing_is_complete(uuid) to authenticated;

-- posting gate: profile + billing complete AND status is not Rejected/Suspended.
create or replace function public.company_can_post_paid_shifts(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.company_profile_is_complete(p_company_id)
     and public.company_billing_is_complete(p_company_id)
     and exists (
       select 1 from public.companies c
        where c.id = p_company_id
          and coalesce(c.status, '') not in ('Rejected','Suspended')
     );
$$;
grant execute on function public.company_can_post_paid_shifts(uuid) to authenticated;

-- =========================================================================
-- 3) UPDATE PROFILE — resets profile_completed_at + revokes verified on trust change
-- =========================================================================
-- Trust-critical fields (changing any of these after approval requires re-approval):
--   name, display_name, industry, city, public_bio,
--   legal_business_name, business_number, business_address, admin_contact_email
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
declare
  v_before    public.companies%rowtype;
  v_after     public.companies%rowtype;
  v_trust_changed boolean := false;
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_before from public.companies where id = p_company_id;
  if not found then raise exception 'company not found'; end if;

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
  where id = p_company_id
  returning * into v_after;

  -- Detect trust-critical changes
  v_trust_changed :=
       coalesce(v_before.display_name,'')        is distinct from coalesce(v_after.display_name,'')
    or coalesce(v_before.name,'')                is distinct from coalesce(v_after.name,'')
    or coalesce(v_before.industry,'')            is distinct from coalesce(v_after.industry,'')
    or coalesce(v_before.city,'')                is distinct from coalesce(v_after.city,'')
    or coalesce(v_before.public_bio,'')          is distinct from coalesce(v_after.public_bio,'')
    or coalesce(v_before.legal_business_name,'') is distinct from coalesce(v_after.legal_business_name,'')
    or coalesce(v_before.business_number,'')     is distinct from coalesce(v_after.business_number,'')
    or coalesce(v_before.business_address,'')    is distinct from coalesce(v_after.business_address,'')
    or coalesce(v_before.admin_contact_email,'') is distinct from coalesce(v_after.admin_contact_email,'');

  -- If trust-critical fields changed AND company was previously approved/active,
  -- revoke verified state and send back to PendingApproval. Admin must re-approve.
  if v_trust_changed
     and coalesce(v_before.status,'') in ('Approved','Active')
     and not public.is_admin()
  then
    update public.companies
       set status      = 'PendingApproval',
           verified_at = null,
           submitted_for_approval_at = now()
     where id = p_company_id;
  end if;

  -- Reset profile_completed_at to reflect the CURRENT state (not stale history).
  update public.companies
     set profile_completed_at = case
           when public.company_profile_is_complete(p_company_id) then now()
           else null
         end
   where id = p_company_id;

  perform public.write_audit(
    case when v_trust_changed then 'company.profile_updated_trust' else 'company.profile_updated' end,
    'companies', p_company_id::text,
    to_jsonb(v_before),
    (select to_jsonb(c) from public.companies c where c.id = p_company_id),
    case when v_trust_changed then 'trust-critical fields changed; re-approval required' else '' end
  );
end; $$;
grant execute on function public.company_update_profile(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

-- =========================================================================
-- 4) SUBMIT FOR APPROVAL — always move non-admin re-submission to PendingApproval
-- =========================================================================
create or replace function public.company_submit_for_approval(p_company_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.company_profile_is_complete(p_company_id) then
    raise exception 'profile incomplete — fill all required profile fields first';
  end if;

  -- A re-submission always lands as PendingApproval (only admin_set_company_approval
  -- can restore Approved/Active).
  update public.companies
     set status                    = 'PendingApproval',
         verified_at               = null,
         submitted_for_approval_at = now(),
         approval_rejection_reason = null
   where id = p_company_id;

  perform public.write_audit('company.submitted_for_approval', 'companies', p_company_id::text, null,
    jsonb_build_object('submitted_at', now()), '');
end; $$;
grant execute on function public.company_submit_for_approval(uuid) to authenticated;

-- =========================================================================
-- 5) PUBLIC VIEW — honour contact visibility flags, only safe fields
-- =========================================================================
drop view if exists public.companies_public;
create view public.companies_public as
select c.id,
       coalesce(nullif(trim(c.display_name), ''), c.name) as display_name,
       c.industry,
       c.city,
       c.public_bio,
       c.logo_url,
       c.website,
       case when c.show_public_contact_email then c.public_contact_email else null end as public_contact_email,
       case when c.show_public_contact_phone then c.public_contact_phone else null end as public_contact_phone,
       c.status,
       c.verified_at,
       c.created_at
  from public.companies c;

grant select on public.companies_public to authenticated, anon;
