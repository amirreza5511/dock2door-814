-- 0134_marketplace_domain_roles.sql
-- Domain 5 (Rentals & Services) becomes a first-class world with its own signup
-- roles: equipment/crane rental companies, mobile repair providers, cargo
-- insurers, plus a standalone marketplace buyer for people who don't belong to
-- any other world. Each provider role gets a company so they can list, quote,
-- invoice, and have a public profile.
--
-- Idempotent + additive. ALTER TYPE ... ADD VALUE only extends the enums; the
-- refreshed handle_new_user() maps the new roles to their company types.

-- ─── 1) Extend the role + company-type enums ────────────────────────────────
do $$ begin alter type user_role add value if not exists 'EquipmentRentalCompany'; exception when others then null; end $$;
do $$ begin alter type user_role add value if not exists 'MobileRepairProvider';   exception when others then null; end $$;
do $$ begin alter type user_role add value if not exists 'CargoInsurer';            exception when others then null; end $$;
do $$ begin alter type user_role add value if not exists 'MarketplaceBuyer';        exception when others then null; end $$;

do $$ begin alter type company_type add value if not exists 'EquipmentRentalCompany'; exception when others then null; end $$;
do $$ begin alter type company_type add value if not exists 'MobileRepairProvider';   exception when others then null; end $$;
do $$ begin alter type company_type add value if not exists 'CargoInsurer';            exception when others then null; end $$;
do $$ begin alter type company_type add value if not exists 'MarketplaceBuyer';        exception when others then null; end $$;

-- ─── 2) Refresh handle_new_user() company-type + vertical mapping ────────────
-- Only the two CASE expressions change (new Domain 5 roles); the rest of the
-- body is preserved verbatim from 0125.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_requested_role text;
  v_name text;
  v_company_id uuid;
  v_company_name text;
  v_company_city text;
  v_company_type company_type;
  v_fleet_code text;
  v_fleet_company_id uuid;
  v_agent_code text;
  v_vertical text;
begin
  v_requested_role := new.raw_user_meta_data->>'role';

  if v_requested_role in ('Admin', 'SuperAdmin') then
    v_role := 'Customer'::user_role;
    raise warning 'handle_new_user: blocked self-assignment of privileged role % for %', v_requested_role, new.email;
  else
    v_role := coalesce(v_requested_role::user_role, 'Customer'::user_role);
  end if;

  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  v_company_name := new.raw_user_meta_data->>'company_name';
  v_company_city := coalesce(new.raw_user_meta_data->>'city', 'Vancouver');
  v_fleet_code := nullif(trim(new.raw_user_meta_data->>'fleet_code'), '');
  v_agent_code := nullif(trim(new.raw_user_meta_data->>'agent_code'), '');

  v_company_type := case v_role
    when 'Customer' then 'Customer'::company_type
    when 'WarehouseProvider' then 'WarehouseProvider'::company_type
    when 'ServiceProvider' then 'ServiceProvider'::company_type
    when 'Employer' then 'Employer'::company_type
    when 'TruckingCompany' then 'TruckingCompany'::company_type
    when 'GateStaff' then 'WarehouseProvider'::company_type
    when 'Shipper' then 'Shipper'::company_type
    when 'DrayageCompany' then 'DrayageCompany'::company_type
    when 'FreightForwarder' then 'FreightForwarder'::company_type
    when 'EquipmentRentalCompany' then 'EquipmentRentalCompany'::company_type
    when 'MobileRepairProvider' then 'MobileRepairProvider'::company_type
    when 'CargoInsurer' then 'CargoInsurer'::company_type
    when 'MarketplaceBuyer' then 'MarketplaceBuyer'::company_type
    else null
  end;

  if v_company_type is not null and coalesce(v_company_name, '') <> '' then
    insert into public.companies (name, type, city, status)
    values (v_company_name, v_company_type, v_company_city, 'PendingApproval')
    returning id into v_company_id;
  end if;

  insert into public.profiles (id, email, name, role, company_id)
  values (new.id, new.email, v_name, v_role, v_company_id);

  if v_company_id is not null then
    insert into public.company_users (company_id, user_id, company_role, status)
    values (v_company_id, new.id, 'Owner', 'Active');
  end if;

  -- Sales agent self-registration → provision an agent record + code.
  if v_role = 'SalesAgent' then
    perform public.ensure_sales_agent(new.id);
  end if;

  -- Driver self-registration → link into the fleet as a PENDING request.
  if v_role = 'Driver' and v_fleet_code is not null then
    select id into v_fleet_company_id
    from public.companies where fleet_code = upper(v_fleet_code) limit 1;

    if v_fleet_company_id is not null then
      insert into public.drivers (company_id, profile_id, name, phone, status, data)
      values (
        v_fleet_company_id, new.id, v_name, '',
        'PendingApproval',
        jsonb_build_object('userId', new.id::text, 'email', new.email, 'name', v_name, 'selfRegistered', true)
      );

      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
      select cu.user_id, 'system', 'Driver wants to join your fleet',
        v_name || ' requested to join. Approve them in Dispatch.',
        'drivers', v_fleet_company_id
      from public.company_users cu
      where cu.company_id = v_fleet_company_id and cu.status = 'Active';
    end if;
  end if;

  -- Agent-code attribution.
  if v_agent_code is not null and v_role <> 'SalesAgent' then
    v_vertical := case v_role
      when 'WarehouseProvider' then 'warehouse'
      when 'DrayageCompany' then 'drayage'
      when 'FreightForwarder' then 'freight_forwarder'
      when 'Employer' then 'employer'
      when 'TruckingCompany' then 'trucking'
      when 'Shipper' then 'shipper'
      when 'Customer' then 'customer'
      when 'ServiceProvider' then 'service'
      when 'Worker' then 'worker'
      when 'Driver' then 'driver'
      when 'EquipmentRentalCompany' then 'service'
      when 'MobileRepairProvider' then 'service'
      when 'CargoInsurer' then 'service'
      when 'MarketplaceBuyer' then 'customer'
      else 'customer'
    end;
    begin
      perform public.attribute_account_to_agent(v_agent_code, new.id, v_company_id, v_vertical, 'code');
    exception when others then
      raise warning 'handle_new_user: agent attribution failed for %: %', new.email, sqlerrm;
    end;
  end if;

  -- Legal acceptances captured at signup (Terms for everyone, NDA for agents).
  begin
    if coalesce(new.raw_user_meta_data->>'accepted_terms', '') = 'true' then
      insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
      values (new.id, 'terms',
              coalesce(nullif(new.raw_user_meta_data->>'terms_version', ''), '1.0'),
              v_name, v_role::text, coalesce(new.raw_user_meta_data->>'signup_platform', ''))
      on conflict (user_id, doc_type) do nothing;
    end if;
    if coalesce(new.raw_user_meta_data->>'accepted_nda', '') = 'true' then
      insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
      values (new.id, 'nda',
              coalesce(nullif(new.raw_user_meta_data->>'nda_version', ''), '1.0'),
              coalesce(nullif(new.raw_user_meta_data->>'nda_signed_name', ''), v_name),
              v_role::text, coalesce(new.raw_user_meta_data->>'signup_platform', ''))
      on conflict (user_id, doc_type) do nothing;
    end if;
  exception when others then
    raise warning 'handle_new_user: legal acceptance recording failed for %: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;
