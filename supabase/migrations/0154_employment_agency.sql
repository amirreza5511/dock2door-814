-- =========================================================================
-- 0154 — Employment Agencies (Domain 1)
-- Idempotent & additive. Safe to run multiple times.
--
-- Staffing agencies (e.g. Express Employment) join the Labour world as a
-- first-class company role:
--   • Own profile + team (companies/company_users — reused as-is)
--   • Own worker roster (agency_workers) and own client book (agency_clients)
--   • Claim open shifts for their roster workers, paying a HIGHER platform
--     fee (agency premium % deducted from the agency's payout)
--   • Their workers can also browse & apply to shifts themselves; the
--     resulting assignment is auto-tagged to the agency
--   • Money flows to the AGENCY (worker_payables.agency_company_id), and
--     the agency pays its workers off-ledger
-- =========================================================================

-- ─── 1) Enums ────────────────────────────────────────────────────────────────
do $$ begin alter type user_role    add value if not exists 'EmploymentAgency'; exception when others then null; end $$;
do $$ begin alter type company_type add value if not exists 'EmploymentAgency'; exception when others then null; end $$;

-- ─── 2) Platform setting: agency premium fee ─────────────────────────────────
-- Extra % (on top of the normal labour commission) the platform keeps when an
-- agency-claimed worker is paid for a shift.
alter table public.platform_settings
  add column if not exists agency_fee_premium_pct numeric not null default 5;

-- ─── 3) Column additions ─────────────────────────────────────────────────────
alter table public.shift_assignments
  add column if not exists agency_company_id uuid references public.companies(id) on delete set null;
create index if not exists idx_sa_agency on public.shift_assignments(agency_company_id);

alter table public.worker_payables
  add column if not exists agency_company_id uuid references public.companies(id) on delete set null,
  add column if not exists agency_fee numeric not null default 0;
create index if not exists idx_wp_agency on public.worker_payables(agency_company_id);

-- ─── 4) Agency worker roster ─────────────────────────────────────────────────
create table if not exists public.agency_workers (
  id uuid primary key default gen_random_uuid(),
  agency_company_id uuid not null references public.companies(id) on delete cascade,
  worker_user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text not null default '',
  phone text not null default '',
  hourly_cost numeric not null default 0,          -- what the agency pays this worker
  status text not null default 'Active' check (status in ('Invited','Active','Removed')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_aw_agency on public.agency_workers(agency_company_id);
create index if not exists idx_aw_worker on public.agency_workers(worker_user_id);
-- One active roster row per (agency, linked worker).
create unique index if not exists uq_aw_agency_worker
  on public.agency_workers(agency_company_id, worker_user_id)
  where worker_user_id is not null and status <> 'Removed';

alter table public.agency_workers enable row level security;

drop policy if exists "aw_read" on public.agency_workers;
create policy "aw_read" on public.agency_workers for select using (
  public.is_member_of(agency_company_id) or worker_user_id = auth.uid() or public.is_admin()
);

drop policy if exists "aw_write" on public.agency_workers;
create policy "aw_write" on public.agency_workers for all
  using (public.is_member_of(agency_company_id) or public.is_admin())
  with check (public.is_member_of(agency_company_id) or public.is_admin());

-- ─── 5) Agency client book (their own customers) ─────────────────────────────
create table if not exists public.agency_clients (
  id uuid primary key default gen_random_uuid(),
  agency_company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ac_agency on public.agency_clients(agency_company_id);

alter table public.agency_clients enable row level security;

drop policy if exists "ac_rw" on public.agency_clients;
create policy "ac_rw" on public.agency_clients for all
  using (public.is_member_of(agency_company_id) or public.is_admin())
  with check (public.is_member_of(agency_company_id) or public.is_admin());

-- ─── 6) Helper: the caller's agency company ──────────────────────────────────
create or replace function public.agency_company_for(p_user_id uuid default null)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cu.company_id
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where cu.user_id = coalesce(p_user_id, auth.uid())
    and cu.status = 'Active'
    and c.type::text = 'EmploymentAgency'
  limit 1;
$$;
grant execute on function public.agency_company_for(uuid) to authenticated;

-- ─── 7) Add a worker to the roster (links a real account by email) ───────────
create or replace function public.agency_add_worker(
  p_name text,
  p_email text default '',
  p_phone text default '',
  p_hourly_cost numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_worker uuid;
  v_id uuid;
begin
  v_agency := public.agency_company_for();
  if v_agency is null then
    raise exception 'Only employment agency members can manage a roster' using errcode='42501';
  end if;
  if coalesce(trim(p_name),'') = '' then
    raise exception 'Worker name is required';
  end if;

  -- Link to a real Worker account when the email matches one.
  if coalesce(trim(p_email),'') <> '' then
    select id into v_worker from public.profiles
    where lower(email) = lower(trim(p_email)) and role::text = 'Worker'
    limit 1;
  end if;

  if v_worker is not null and exists (
    select 1 from public.agency_workers
    where agency_company_id = v_agency and worker_user_id = v_worker and status <> 'Removed'
  ) then
    raise exception 'This worker is already on your roster';
  end if;

  insert into public.agency_workers (agency_company_id, worker_user_id, name, email, phone, hourly_cost, status)
  values (v_agency, v_worker, trim(p_name), coalesce(trim(p_email),''), coalesce(trim(p_phone),''),
          coalesce(p_hourly_cost, 0), case when v_worker is null then 'Invited' else 'Active' end)
  returning id into v_id;

  if v_worker is not null then
    perform public.queue_notification(
      v_worker, 'system', 'You were added to an agency roster',
      (select name from public.companies where id = v_agency) || ' added you to their worker roster.',
      'agency_workers', v_id::text, jsonb_build_object('agency_company_id', v_agency)
    );
  end if;

  perform public.write_audit('agency.worker_added','agency_workers', v_id::text, null,
    jsonb_build_object('worker_user_id', v_worker, 'name', trim(p_name)), null, v_agency);
  return v_id;
end;
$$;
grant execute on function public.agency_add_worker(text, text, text, numeric) to authenticated;

-- ─── 8) Auto-tag assignments made for roster workers ─────────────────────────
-- When an agency worker applies themselves (or an employer accepts them), the
-- assignment is tagged with their agency so pay routes to the agency.
create or replace function public.tg_assignment_agency_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agency_company_id is null then
    select agency_company_id into new.agency_company_id
    from public.agency_workers
    where worker_user_id = new.worker_user_id and status = 'Active'
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assignment_agency_tag on public.shift_assignments;
create trigger trg_assignment_agency_tag
  before insert on public.shift_assignments
  for each row execute function public.tg_assignment_agency_tag();

-- ─── 9) Agency claims an open shift for one of its workers ───────────────────
create or replace function public.agency_claim_shift(
  p_shift_id uuid,
  p_agency_worker_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_roster public.agency_workers;
  v_shift public.shift_posts;
  v_accepted int;
  v_app uuid;
  v_ass uuid;
  v_agency_name text;
begin
  v_agency := public.agency_company_for();
  if v_agency is null then
    raise exception 'Only employment agency members can claim shifts' using errcode='42501';
  end if;

  select * into v_roster from public.agency_workers where id = p_agency_worker_id;
  if v_roster is null or v_roster.agency_company_id <> v_agency then
    raise exception 'Worker not found on your roster' using errcode='P0002';
  end if;
  if v_roster.status <> 'Active' or v_roster.worker_user_id is null then
    raise exception 'This worker has no linked Dock2Door account yet — they must sign up as a Worker with the same email first';
  end if;

  select * into v_shift from public.shift_posts where id = p_shift_id;
  if v_shift is null then raise exception 'Shift not found' using errcode='P0002'; end if;
  if v_shift.status::text <> 'Posted' then
    raise exception 'This shift is no longer open (status: %)', v_shift.status using errcode='22023';
  end if;
  if v_shift.date is not null and v_shift.date < current_date then
    raise exception 'This shift has already passed' using errcode='22023';
  end if;

  select count(*) into v_accepted
  from public.shift_assignments
  where shift_id = p_shift_id
    and status in ('Scheduled','InProgress','Completed');
  if v_accepted >= coalesce(v_shift.workers_needed, 1) then
    raise exception 'This shift is already filled' using errcode='22023';
  end if;

  if exists (
    select 1 from public.shift_assignments
    where shift_id = p_shift_id and worker_user_id = v_roster.worker_user_id
      and status in ('Scheduled','InProgress','Completed')
  ) then
    raise exception 'This worker is already assigned to this shift';
  end if;

  if public.shift_has_conflict(v_roster.worker_user_id, v_shift.date, v_shift.start_time, v_shift.end_time, p_shift_id) then
    raise exception 'This worker has an overlapping shift' using errcode='23514';
  end if;

  -- Application record (Accepted immediately — agency placement).
  insert into public.shift_applications (shift_id, worker_user_id, status)
  values (p_shift_id, v_roster.worker_user_id, 'Accepted')
  on conflict (shift_id, worker_user_id) do update set status = 'Accepted'
  returning id into v_app;

  insert into public.shift_assignments (shift_id, worker_user_id, employer_company_id, confirmed_rate, status, agency_company_id)
  values (p_shift_id, v_roster.worker_user_id, v_shift.employer_company_id,
          coalesce(v_shift.hourly_rate, v_shift.flat_rate, 0), 'Scheduled', v_agency)
  returning id into v_ass;

  update public.shift_posts
     set status = case
       when (select count(*) from public.shift_assignments
              where shift_id = p_shift_id and status = 'Scheduled') >= workers_needed
       then 'Filled'::shift_status else status end
   where id = p_shift_id;

  select name into v_agency_name from public.companies where id = v_agency;

  -- Notify the worker.
  perform public.queue_notification(
    v_roster.worker_user_id, 'shift', 'Your agency booked you a shift',
    coalesce(v_agency_name,'Your agency') || ' assigned you: ' || v_shift.title || ' on ' || v_shift.date::text,
    'shift_assignments', v_ass::text, jsonb_build_object('assignment_id', v_ass, 'shift_id', p_shift_id)
  );

  -- Notify the employer.
  perform public.queue_notification(
    cu.user_id, 'shift', 'Shift staffed by an agency',
    coalesce(v_agency_name,'An employment agency') || ' placed ' || v_roster.name || ' on ' || v_shift.title,
    'shift_posts', p_shift_id::text, jsonb_build_object('shift_id', p_shift_id, 'assignment_id', v_ass)
  )
  from public.company_users cu
  where cu.company_id = v_shift.employer_company_id and cu.status = 'Active';

  -- Add the worker to any existing shift chat thread.
  perform public.add_worker_to_shift_threads(p_shift_id, v_roster.worker_user_id);

  perform public.write_audit('shift.agency_claim','shift_assignments', v_ass::text, null,
    jsonb_build_object('shift_id', p_shift_id, 'worker_user_id', v_roster.worker_user_id, 'agency_company_id', v_agency),
    null, v_shift.employer_company_id);
  return v_ass;
end;
$$;
grant execute on function public.agency_claim_shift(uuid, uuid) to authenticated;

-- ─── 10) issue_invoice_for_shift — route agency pay + premium fee ─────────────
-- Recreates 0063's function preserving behavior, adding:
--   • worker_payables.agency_company_id copied from the assignment
--   • agency_fee = agency premium % of gross (the platform keeps it from the
--     agency's payout — this is the "higher fee" agencies pay for placements)
create or replace function public.issue_invoice_for_shift(p_shift_id uuid, p_due_days int default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shift_posts;
  v_company public.companies;
  v_invoice_id uuid;
  v_existing uuid;
  v_number text;
  v_subtotal numeric := 0;
  v_commission_pct numeric := 0;
  v_commission numeric := 0;
  v_agency_premium_pct numeric := 0;
  v_due int;
  r record;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_shift from public.shift_posts where id = p_shift_id;
  if v_shift is null then raise exception 'shift not found'; end if;
  if not (public.is_member_of(v_shift.employer_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  select id into v_existing
    from public.invoices
   where customer_company_id = v_shift.employer_company_id
     and (subtotal_amount > 0)
     and exists (
       select 1 from public.worker_payables wp where wp.invoice_id = invoices.id and wp.shift_id = p_shift_id
     )
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_company from public.companies where id = v_shift.employer_company_id;
  v_due := coalesce(p_due_days, coalesce(v_company.payment_terms_days, 14));

  for r in
    select sa.id as assignment_id,
           sa.worker_user_id,
           coalesce(sum(coalesce(te.employer_confirmed_hours, 0)), 0) as hours,
           coalesce(sa.hourly_rate, v_shift.hourly_rate, 0) as rate
      from public.shift_assignments sa
      left join public.time_entries te on te.assignment_id = sa.id
     where sa.shift_id = p_shift_id
       and sa.status in ('Completed','HoursConfirmed')
     group by sa.id, sa.worker_user_id, sa.hourly_rate
  loop
    if r.hours > 0 then
      v_subtotal := v_subtotal + (r.hours * r.rate);
    end if;
  end loop;

  if v_subtotal <= 0 then raise exception 'no confirmed hours to invoice'; end if;

  select coalesce(labour_commission_percentage, 0), coalesce(agency_fee_premium_pct, 0)
    into v_commission_pct, v_agency_premium_pct
  from public.platform_settings limit 1;
  v_commission := round(v_subtotal * (v_commission_pct / 100.0), 2);

  v_number := 'INV-SHF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_shift.employer_company_id, null,
    v_number, v_subtotal, 0, v_subtotal + v_commission,
    'CAD', 'Issued', (current_date + make_interval(days => v_due)), now()
  ) returning id into v_invoice_id;

  for r in
    select sa.id as assignment_id,
           sa.worker_user_id,
           sa.agency_company_id,
           coalesce(sum(coalesce(te.employer_confirmed_hours, 0)), 0) as hours,
           coalesce(sa.hourly_rate, v_shift.hourly_rate, 0) as rate,
           coalesce(p.full_name, 'Worker') as worker_name
      from public.shift_assignments sa
      left join public.time_entries te on te.assignment_id = sa.id
      left join public.profiles p on p.id = sa.worker_user_id
     where sa.shift_id = p_shift_id
       and sa.status in ('Completed','HoursConfirmed')
     group by sa.id, sa.worker_user_id, sa.agency_company_id, sa.hourly_rate, p.full_name
  loop
    if r.hours > 0 then
      insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
      values (v_invoice_id,
              r.worker_name || ' — ' || r.hours || 'h @ $' || r.rate
                || case when r.agency_company_id is not null then ' (agency placement)' else '' end,
              r.hours, r.rate, round(r.hours * r.rate, 2), 0);

      insert into public.worker_payables (
        assignment_id, shift_id, worker_user_id, employer_company_id,
        invoice_id, confirmed_hours, hourly_rate, gross_pay, status,
        agency_company_id, agency_fee
      ) values (
        r.assignment_id, p_shift_id, r.worker_user_id, v_shift.employer_company_id,
        v_invoice_id, r.hours, r.rate, round(r.hours * r.rate, 2), 'Approved',
        r.agency_company_id,
        case when r.agency_company_id is not null
             then round(r.hours * r.rate * (v_agency_premium_pct / 100.0), 2)
             else 0 end
      )
      on conflict (assignment_id) do update set
        invoice_id = excluded.invoice_id,
        confirmed_hours = excluded.confirmed_hours,
        hourly_rate = excluded.hourly_rate,
        gross_pay = excluded.gross_pay,
        agency_company_id = excluded.agency_company_id,
        agency_fee = excluded.agency_fee,
        status = case when worker_payables.status = 'Paid' then 'Paid'::worker_payable_status else 'Approved'::worker_payable_status end,
        updated_at = now();
    end if;
  end loop;

  if v_commission > 0 then
    insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
    values (v_invoice_id, 'Platform fee (' || v_commission_pct || '%)', 1, v_commission, v_commission, 99);
  end if;

  update public.shift_posts set status = 'Completed' where id = p_shift_id and status not in ('Cancelled','Completed');

  perform public.write_audit('invoice_issued_shift', 'invoices', v_invoice_id::text, null,
    jsonb_build_object('shift_id', p_shift_id, 'subtotal', v_subtotal, 'commission', v_commission, 'total', v_subtotal + v_commission), '');

  return v_invoice_id;
end; $$;
grant execute on function public.issue_invoice_for_shift(uuid, int) to authenticated;

-- ─── 11) RLS: agencies read their tagged assignments & payables ──────────────
drop policy if exists "sa_read_agency" on public.shift_assignments;
create policy "sa_read_agency" on public.shift_assignments for select using (
  agency_company_id is not null and public.is_member_of(agency_company_id)
);

drop policy if exists "wp_read_agency" on public.worker_payables;
create policy "wp_read_agency" on public.worker_payables for select using (
  agency_company_id is not null and public.is_member_of(agency_company_id)
);

-- ─── 12) Agency read RPCs (joined data without loosening base-table RLS) ─────
create or replace function public.agency_list_assignments()
returns table (
  assignment_id uuid, shift_id uuid, shift_title text, shift_date date,
  start_time text, end_time text, location_city text, employer_name text,
  worker_user_id uuid, worker_name text, rate numeric, status text
)
language plpgsql stable security definer set search_path = public as $$
declare v_agency uuid;
begin
  v_agency := public.agency_company_for();
  if v_agency is null then
    raise exception 'Only employment agency members can view this' using errcode='42501';
  end if;
  return query
  select sa.id, sp.id, sp.title, sp.date, sp.start_time, sp.end_time, sp.location_city,
         c.name, sa.worker_user_id,
         coalesce(aw.name, pr.name, 'Worker'),
         coalesce(sa.hourly_rate, sp.hourly_rate, 0), sa.status::text
  from public.shift_assignments sa
  join public.shift_posts sp on sp.id = sa.shift_id
  left join public.companies c on c.id = sp.employer_company_id
  left join public.profiles pr on pr.id = sa.worker_user_id
  left join public.agency_workers aw
    on aw.agency_company_id = v_agency and aw.worker_user_id = sa.worker_user_id and aw.status <> 'Removed'
  where sa.agency_company_id = v_agency
  order by sp.date desc, sp.start_time;
end; $$;
grant execute on function public.agency_list_assignments() to authenticated;

create or replace function public.agency_list_payables()
returns table (
  payable_id uuid, shift_id uuid, shift_title text, shift_date date,
  worker_user_id uuid, worker_name text, confirmed_hours numeric, hourly_rate numeric,
  gross_pay numeric, agency_fee numeric, net_to_agency numeric,
  status text, invoice_status text, paid_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_agency uuid;
begin
  v_agency := public.agency_company_for();
  if v_agency is null then
    raise exception 'Only employment agency members can view this' using errcode='42501';
  end if;
  return query
  select wp.id, wp.shift_id, sp.title, sp.date,
         wp.worker_user_id, coalesce(aw.name, pr.name, 'Worker'),
         wp.confirmed_hours, wp.hourly_rate,
         wp.gross_pay, wp.agency_fee, round(wp.gross_pay - wp.agency_fee, 2),
         wp.status::text, coalesce(i.status::text, ''), wp.paid_at
  from public.worker_payables wp
  join public.shift_posts sp on sp.id = wp.shift_id
  left join public.invoices i on i.id = wp.invoice_id
  left join public.profiles pr on pr.id = wp.worker_user_id
  left join public.agency_workers aw
    on aw.agency_company_id = v_agency and aw.worker_user_id = wp.worker_user_id and aw.status <> 'Removed'
  where wp.agency_company_id = v_agency
  order by wp.created_at desc;
end; $$;
grant execute on function public.agency_list_payables() to authenticated;

-- ─── 13) handle_new_user — EmploymentAgency signup with company ──────────────
-- Verbatim from 0134 with the EmploymentAgency mapping added.
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

-- ─── 14) Refresh PostgREST schema cache ──────────────────────────────────────
notify pgrst, 'reload schema';
