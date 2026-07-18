-- 0156_guest_access.sql
-- Guest access: individuals without a full business account can use every
-- service on the platform (drayage orders, customs clearance, marketplace,
-- warehouse bookings…) in exchange for a HIGHER price (guest surcharge) and
-- MANDATORY prepayment on every invoice.
--
-- Design:
--   • New user_role 'Guest'. On signup, handle_new_user auto-creates an
--     auto-approved personal company of type 'Customer' flagged is_guest=true,
--     so every existing company-scoped flow (orders, clearance, bookings,
--     invoices) works unchanged for guests.
--   • platform_settings.guest_surcharge_pct (default 20%) — a generic AFTER
--     INSERT trigger on invoices adds a "Guest service surcharge" line to any
--     invoice billed to a guest company and marks it requires_prepayment.
--     One trigger covers ALL services, present and future.
--   • guest_pay_invoice() marks a prepayment-required invoice as paid.
-- Idempotent and additive.

-- ─── 1) Enum + columns ────────────────────────────────────────────────────────
do $$ begin alter type user_role add value if not exists 'Guest'; exception when others then null; end $$;

alter table public.companies add column if not exists is_guest boolean not null default false;

alter table public.platform_settings
  add column if not exists guest_surcharge_pct numeric not null default 20;

alter table public.invoices add column if not exists requires_prepayment boolean not null default false;
alter table public.invoices add column if not exists prepaid_at timestamptz;

create index if not exists idx_companies_is_guest on public.companies(is_guest) where is_guest;

-- ─── 2) Guest surcharge on EVERY invoice billed to a guest company ───────────
-- Fires after any invoice is created (shifts, drayage, clearance, marketplace,
-- provider invoicing…). Adds the surcharge as a visible line item, bumps the
-- totals, and forces prepayment.
create or replace function public.tg_invoice_guest_surcharge_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_guest boolean;
  v_pct numeric;
  v_surcharge numeric;
begin
  if new.customer_company_id is null then
    return new;
  end if;

  select c.is_guest into v_is_guest from public.companies c where c.id = new.customer_company_id;
  if not coalesce(v_is_guest, false) then
    return new;
  end if;

  select coalesce(guest_surcharge_pct, 0) into v_pct from public.platform_settings limit 1;
  v_pct := coalesce(v_pct, 0);
  v_surcharge := round(coalesce(new.subtotal_amount, 0) * v_pct / 100.0, 2);

  if v_surcharge > 0 then
    insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
    values (new.id, 'Guest service surcharge (' || v_pct::text || '%)', 1, v_surcharge, v_surcharge, 9999);

    update public.invoices
       set subtotal_amount = coalesce(subtotal_amount, 0) + v_surcharge,
           total_amount    = coalesce(total_amount, 0) + v_surcharge,
           requires_prepayment = true
     where id = new.id;
  else
    update public.invoices set requires_prepayment = true where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists tg_invoice_guest_surcharge on public.invoices;
create trigger tg_invoice_guest_surcharge
  after insert on public.invoices
  for each row execute function public.tg_invoice_guest_surcharge_fn();

-- ─── 3) Guest prepays an invoice ──────────────────────────────────────────────
-- Marks the invoice as paid immediately (prepayment). Providers are notified.
create or replace function public.guest_pay_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if v_inv.id is null then
    raise exception 'Invoice not found';
  end if;
  if not (public.is_member_of(v_inv.customer_company_id) or public.is_admin()) then
    raise exception 'Not allowed' using errcode='42501';
  end if;
  if v_inv.status::text = 'Paid' then
    return;
  end if;
  if v_inv.status::text in ('Void','Refunded') then
    raise exception 'This invoice can no longer be paid';
  end if;

  update public.invoices
     set status = 'Paid'::invoice_status,
         paid_at = now(),
         prepaid_at = coalesce(prepaid_at, now())
   where id = p_invoice_id;

  -- Notify the provider company that the guest prepaid.
  if v_inv.provider_company_id is not null then
    perform public.queue_notification(
      cu.user_id, 'system', 'Invoice prepaid',
      'Invoice ' || coalesce(v_inv.invoice_number, left(p_invoice_id::text, 8)) || ' was prepaid ($' || coalesce(v_inv.total_amount, 0)::text || ').',
      'invoices', p_invoice_id::text, jsonb_build_object('invoice_id', p_invoice_id)
    )
    from public.company_users cu
    where cu.company_id = v_inv.provider_company_id and cu.status = 'Active';
  end if;

  perform public.write_audit('guest.invoice_prepaid','invoices', p_invoice_id::text, null,
    jsonb_build_object('total', v_inv.total_amount), null, v_inv.customer_company_id);
end;
$$;
grant execute on function public.guest_pay_invoice(uuid) to authenticated;

-- ─── 4) handle_new_user — Guest signup gets an auto-approved guest company ───
-- Verbatim from 0155 with the Guest branch added.
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
    when 'EmploymentAgency' then 'EmploymentAgency'::company_type
    when 'CustomsBroker' then 'CustomsBroker'::company_type
    else null
  end;

  if v_company_type is not null and coalesce(v_company_name, '') <> '' then
    insert into public.companies (name, type, city, status)
    values (v_company_name, v_company_type, v_company_city, 'PendingApproval')
    returning id into v_company_id;
  end if;

  -- Guest signup → auto-approved personal guest company. Guests can order any
  -- service right away; every invoice gets the guest surcharge + prepayment.
  if v_role::text = 'Guest' then
    insert into public.companies (name, type, city, status, is_guest)
    values (
      coalesce(nullif(trim(coalesce(v_company_name, '')), ''), v_name || ' (Guest)'),
      'Customer'::company_type, v_company_city, 'Approved', true
    )
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

  -- Worker self-registration → auto-link to any agency roster rows that
  -- invited this email before the account existed.
  if v_role = 'Worker' then
    update public.agency_workers
       set worker_user_id = new.id, status = 'Active', updated_at = now()
     where worker_user_id is null
       and lower(email) = lower(new.email)
       and status = 'Invited';
  end if;

  -- Agent-code attribution.
  if v_agent_code is not null and v_role <> 'SalesAgent' then
    v_vertical := case v_role
      when 'WarehouseProvider' then 'warehouse'
      when 'DrayageCompany' then 'drayage'
      when 'FreightForwarder' then 'freight_forwarder'
      when 'CustomsBroker' then 'freight_forwarder'
      when 'Employer' then 'employer'
      when 'EmploymentAgency' then 'employer'
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

-- ─── 5) Refresh PostgREST schema cache ────────────────────────────────────────
notify pgrst, 'reload schema';
