-- =========================================================================
-- 0157 — Warehouse shared space: rent by the square foot (SF)
-- Idempotent & additive. Safe to run multiple times.
--
-- Warehouse providers publish SPACES (floor / rack / climate / secured /
-- outdoor / hazmat) measured in square feet. Customers (and guests) rent
-- any amount of SF for a term of months — like co-working, but for
-- warehousing. Pricing is fully "measured":
--   • Base $/sqft/month per space kind
--   • VOLUME TIERS  — bigger footprints get a lower $/sqft rate
--   • TERM DISCOUNTS — 3/6/12-month commitments get % off
--   • ADD-ONS       — per-sqft/month, per-month, or one-time services
--   • Server-side quote engine returns a transparent line-by-line breakdown
--   • Platform keeps space_rental_commission_pct of each invoice
--   • Guest surcharge + prepayment apply automatically (0156 trigger)
-- =========================================================================

-- ─── 1) Platform setting: space rental commission ───────────────────────────
alter table public.platform_settings
  add column if not exists space_rental_commission_pct numeric not null default 8;

-- ─── 2) Spaces ────────────────────────────────────────────────────────────────
create table if not exists public.warehouse_spaces (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  listing_id uuid references public.warehouse_listings(id) on delete set null,
  name text not null,
  space_kind text not null default 'Floor'
    check (space_kind in ('Floor','Rack','ClimateControlled','Secured','Outdoor','Hazmat')),
  address text not null default '',
  city text not null default '',
  total_sqft numeric not null default 0 check (total_sqft >= 0),
  booked_sqft numeric not null default 0 check (booked_sqft >= 0),
  min_sqft numeric not null default 100 check (min_sqft > 0),
  max_sqft numeric,                          -- null = up to availability
  base_rate_per_sqft_month numeric not null default 0 check (base_rate_per_sqft_month >= 0),
  currency text not null default 'CAD',
  min_term_months int not null default 1 check (min_term_months >= 1),
  term_discount_3m_pct numeric not null default 0 check (term_discount_3m_pct between 0 and 100),
  term_discount_6m_pct numeric not null default 0 check (term_discount_6m_pct between 0 and 100),
  term_discount_12m_pct numeric not null default 0 check (term_discount_12m_pct between 0 and 100),
  ceiling_height_ft numeric,
  features text[] not null default '{}',     -- e.g. {'Dock access','CCTV','Sprinklers','24/7 access'}
  notes text not null default '',
  status text not null default 'Active' check (status in ('Draft','Active','Paused','Archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ws_company on public.warehouse_spaces(company_id);
create index if not exists idx_ws_status  on public.warehouse_spaces(status);

-- ─── 3) Volume tiers (lower $/sqft at higher footprints) ─────────────────────
create table if not exists public.warehouse_space_tiers (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.warehouse_spaces(id) on delete cascade,
  min_sqft numeric not null check (min_sqft > 0),
  rate_per_sqft_month numeric not null check (rate_per_sqft_month >= 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_wst_space on public.warehouse_space_tiers(space_id, min_sqft);

-- ─── 4) Add-on services ───────────────────────────────────────────────────────
create table if not exists public.warehouse_space_addons (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.warehouse_spaces(id) on delete cascade,
  name text not null,
  pricing_unit text not null default 'per_month'
    check (pricing_unit in ('per_sqft_month','per_month','one_time')),
  rate numeric not null default 0 check (rate >= 0),
  is_required boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_wsa_space on public.warehouse_space_addons(space_id);

-- ─── 5) Space bookings ────────────────────────────────────────────────────────
create table if not exists public.warehouse_space_bookings (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.warehouse_spaces(id) on delete cascade,
  provider_company_id uuid not null references public.companies(id) on delete cascade,
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  sqft numeric not null check (sqft > 0),
  term_months int not null check (term_months >= 1),
  start_date date not null,
  addon_ids uuid[] not null default '{}',
  quote jsonb not null default '{}'::jsonb,   -- frozen breakdown at request time
  monthly_total numeric not null default 0,
  one_time_total numeric not null default 0,
  contract_total numeric not null default 0,
  currency text not null default 'CAD',
  status text not null default 'Requested'
    check (status in ('Requested','Approved','Active','Declined','Cancelled','Completed')),
  customer_notes text not null default '',
  provider_notes text not null default '',
  months_billed int not null default 0,
  last_billed_at timestamptz,
  platform_fee numeric not null default 0,     -- cumulative commission recorded
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wsb_space    on public.warehouse_space_bookings(space_id);
create index if not exists idx_wsb_provider on public.warehouse_space_bookings(provider_company_id);
create index if not exists idx_wsb_customer on public.warehouse_space_bookings(customer_company_id);
create index if not exists idx_wsb_status   on public.warehouse_space_bookings(status);

-- ─── 6) RLS ───────────────────────────────────────────────────────────────────
alter table public.warehouse_spaces          enable row level security;
alter table public.warehouse_space_tiers     enable row level security;
alter table public.warehouse_space_addons    enable row level security;
alter table public.warehouse_space_bookings  enable row level security;

-- Spaces: any signed-in user can browse Active spaces; owners/admin see all.
drop policy if exists "ws_read" on public.warehouse_spaces;
create policy "ws_read" on public.warehouse_spaces
for select to authenticated
using (status = 'Active' or public.is_member_of(company_id) or public.is_admin());

drop policy if exists "ws_write" on public.warehouse_spaces;
create policy "ws_write" on public.warehouse_spaces
for all to authenticated
using (public.is_member_of(company_id) or public.is_admin())
with check (public.is_member_of(company_id) or public.is_admin());

-- Tiers / add-ons: readable when the parent space is readable; owner writes.
drop policy if exists "wst_read" on public.warehouse_space_tiers;
create policy "wst_read" on public.warehouse_space_tiers
for select to authenticated
using (exists (
  select 1 from public.warehouse_spaces s
  where s.id = space_id
    and (s.status = 'Active' or public.is_member_of(s.company_id) or public.is_admin())
));

drop policy if exists "wst_write" on public.warehouse_space_tiers;
create policy "wst_write" on public.warehouse_space_tiers
for all to authenticated
using (exists (
  select 1 from public.warehouse_spaces s
  where s.id = space_id and (public.is_member_of(s.company_id) or public.is_admin())
))
with check (exists (
  select 1 from public.warehouse_spaces s
  where s.id = space_id and (public.is_member_of(s.company_id) or public.is_admin())
));

drop policy if exists "wsa_read" on public.warehouse_space_addons;
create policy "wsa_read" on public.warehouse_space_addons
for select to authenticated
using (exists (
  select 1 from public.warehouse_spaces s
  where s.id = space_id
    and (s.status = 'Active' or public.is_member_of(s.company_id) or public.is_admin())
));

drop policy if exists "wsa_write" on public.warehouse_space_addons;
create policy "wsa_write" on public.warehouse_space_addons
for all to authenticated
using (exists (
  select 1 from public.warehouse_spaces s
  where s.id = space_id and (public.is_member_of(s.company_id) or public.is_admin())
))
with check (exists (
  select 1 from public.warehouse_spaces s
  where s.id = space_id and (public.is_member_of(s.company_id) or public.is_admin())
));

-- Bookings: only the two parties (and admin) can read. All writes via RPC.
drop policy if exists "wsb_read" on public.warehouse_space_bookings;
create policy "wsb_read" on public.warehouse_space_bookings
for select to authenticated
using (
  public.is_member_of(provider_company_id)
  or public.is_member_of(customer_company_id)
  or public.is_admin()
);

-- ─── 7) Quote engine ──────────────────────────────────────────────────────────
-- Deterministic, transparent pricing. Everything is measured:
--   rate      = best volume tier for the requested sqft (falls back to base)
--   discount  = term commitment discount (12m > 6m > 3m)
--   add-ons   = per_sqft_month / per_month monthly; one_time once
-- Returns a jsonb breakdown the UI can render line by line.
create or replace function public.warehouse_space_quote(
  p_space_id uuid,
  p_sqft numeric,
  p_term_months int,
  p_addon_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_space public.warehouse_spaces;
  v_available numeric;
  v_rate numeric;
  v_tier_min numeric;
  v_disc_pct numeric := 0;
  v_disc_label text := '';
  v_space_month numeric;
  v_addons jsonb := '[]'::jsonb;
  v_addon record;
  v_addon_month numeric;
  v_addon_once numeric;
  v_monthly numeric := 0;
  v_one_time numeric := 0;
begin
  select * into v_space from public.warehouse_spaces where id = p_space_id;
  if v_space is null then raise exception 'Space not found' using errcode='P0002'; end if;
  if v_space.status <> 'Active' and not (public.is_member_of(v_space.company_id) or public.is_admin()) then
    raise exception 'Space is not available';
  end if;

  v_available := greatest(v_space.total_sqft - v_space.booked_sqft, 0);
  if p_sqft is null or p_sqft <= 0 then raise exception 'Enter the square footage you need'; end if;
  if p_sqft < v_space.min_sqft then
    raise exception 'Minimum booking for this space is % sqft', v_space.min_sqft;
  end if;
  if v_space.max_sqft is not null and p_sqft > v_space.max_sqft then
    raise exception 'Maximum booking for this space is % sqft', v_space.max_sqft;
  end if;
  if p_sqft > v_available then
    raise exception 'Only % sqft currently available in this space', v_available;
  end if;
  if p_term_months is null or p_term_months < v_space.min_term_months then
    raise exception 'Minimum term for this space is % month(s)', v_space.min_term_months;
  end if;

  -- Volume tier: the highest tier threshold the footprint reaches.
  select t.rate_per_sqft_month, t.min_sqft into v_rate, v_tier_min
  from public.warehouse_space_tiers t
  where t.space_id = p_space_id and t.min_sqft <= p_sqft
  order by t.min_sqft desc
  limit 1;
  if v_rate is null then
    v_rate := v_space.base_rate_per_sqft_month;
    v_tier_min := null;
  end if;

  -- Term commitment discount.
  if p_term_months >= 12 and v_space.term_discount_12m_pct > 0 then
    v_disc_pct := v_space.term_discount_12m_pct; v_disc_label := '12+ month commitment';
  elsif p_term_months >= 6 and v_space.term_discount_6m_pct > 0 then
    v_disc_pct := v_space.term_discount_6m_pct; v_disc_label := '6+ month commitment';
  elsif p_term_months >= 3 and v_space.term_discount_3m_pct > 0 then
    v_disc_pct := v_space.term_discount_3m_pct; v_disc_label := '3+ month commitment';
  end if;

  v_space_month := round(p_sqft * v_rate * (1 - v_disc_pct / 100.0), 2);
  v_monthly := v_space_month;

  -- Add-ons: required ones always included; optional ones only when selected.
  for v_addon in
    select * from public.warehouse_space_addons a
    where a.space_id = p_space_id
      and (a.is_required or a.id = any(coalesce(p_addon_ids, '{}')))
  loop
    v_addon_month := 0; v_addon_once := 0;
    if v_addon.pricing_unit = 'per_sqft_month' then
      v_addon_month := round(v_addon.rate * p_sqft, 2);
    elsif v_addon.pricing_unit = 'per_month' then
      v_addon_month := round(v_addon.rate, 2);
    else
      v_addon_once := round(v_addon.rate, 2);
    end if;
    v_monthly := v_monthly + v_addon_month;
    v_one_time := v_one_time + v_addon_once;
    v_addons := v_addons || jsonb_build_object(
      'id', v_addon.id, 'name', v_addon.name, 'pricing_unit', v_addon.pricing_unit,
      'rate', v_addon.rate, 'monthly', v_addon_month, 'one_time', v_addon_once,
      'required', v_addon.is_required
    );
  end loop;

  return jsonb_build_object(
    'space_id', v_space.id,
    'space_name', v_space.name,
    'space_kind', v_space.space_kind,
    'sqft', p_sqft,
    'term_months', p_term_months,
    'base_rate', v_space.base_rate_per_sqft_month,
    'applied_rate', v_rate,
    'tier_min_sqft', v_tier_min,
    'term_discount_pct', v_disc_pct,
    'term_discount_label', v_disc_label,
    'space_monthly', v_space_month,
    'addons', v_addons,
    'monthly_total', round(v_monthly, 2),
    'one_time_total', round(v_one_time, 2),
    'contract_total', round(v_monthly * p_term_months + v_one_time, 2),
    'currency', v_space.currency,
    'available_sqft', v_available
  );
end;
$$;
grant execute on function public.warehouse_space_quote(uuid, numeric, int, uuid[]) to authenticated;

-- ─── 8) Customer requests a booking ──────────────────────────────────────────
-- Price is ALWAYS computed server-side and frozen into the booking row —
-- the client can never spoof a number.
create or replace function public.space_request_booking(
  p_space_id uuid,
  p_sqft numeric,
  p_term_months int,
  p_start_date date,
  p_addon_ids uuid[] default '{}',
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space public.warehouse_spaces;
  v_customer uuid;
  v_quote jsonb;
  v_id uuid;
  v_customer_name text;
begin
  select * into v_space from public.warehouse_spaces where id = p_space_id;
  if v_space is null then raise exception 'Space not found' using errcode='P0002'; end if;
  if v_space.status <> 'Active' then raise exception 'This space is not accepting bookings'; end if;

  select cu.company_id into v_customer
  from public.company_users cu
  where cu.user_id = auth.uid() and cu.status = 'Active'
    and cu.company_id <> v_space.company_id
  limit 1;
  if v_customer is null then
    raise exception 'You need an active company to request space' using errcode='42501';
  end if;
  if p_start_date is null or p_start_date < current_date then
    raise exception 'Start date must be today or later';
  end if;

  v_quote := public.warehouse_space_quote(p_space_id, p_sqft, p_term_months, p_addon_ids);

  insert into public.warehouse_space_bookings (
    space_id, provider_company_id, customer_company_id, requested_by,
    sqft, term_months, start_date, addon_ids, quote,
    monthly_total, one_time_total, contract_total, currency, customer_notes
  ) values (
    p_space_id, v_space.company_id, v_customer, auth.uid(),
    p_sqft, p_term_months, p_start_date, coalesce(p_addon_ids, '{}'), v_quote,
    (v_quote->>'monthly_total')::numeric,
    (v_quote->>'one_time_total')::numeric,
    (v_quote->>'contract_total')::numeric,
    v_space.currency, coalesce(p_notes, '')
  ) returning id into v_id;

  select name into v_customer_name from public.companies where id = v_customer;
  perform public.queue_notification(
    cu.user_id, 'system', 'New space rental request',
    coalesce(v_customer_name,'A company') || ' wants ' || p_sqft || ' sqft in "' || v_space.name
      || '" for ' || p_term_months || ' month(s) — '
      || (v_quote->>'monthly_total') || ' ' || v_space.currency || '/mo. Review it in Spaces.',
    'warehouse_space_bookings', v_id::text, jsonb_build_object('booking_id', v_id, 'space_id', p_space_id)
  )
  from public.company_users cu
  where cu.company_id = v_space.company_id and cu.status = 'Active';

  return v_id;
end;
$$;
grant execute on function public.space_request_booking(uuid, numeric, int, date, uuid[], text) to authenticated;

-- ─── 9) Provider approves / declines ─────────────────────────────────────────
-- Approval reserves the footprint and issues the FIRST month's invoice
-- (plus one-time fees). Guest customers automatically get the surcharge and
-- prepayment requirement via the 0156 invoice trigger.
create or replace function public.space_respond_booking(
  p_booking_id uuid,
  p_action text,          -- 'approve' | 'decline'
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.warehouse_space_bookings;
  v_space public.warehouse_spaces;
  v_available numeric;
  v_invoice uuid;
  v_number text;
  v_pct numeric := 0;
  v_first numeric;
begin
  select * into v_b from public.warehouse_space_bookings where id = p_booking_id for update;
  if v_b is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not (public.is_member_of(v_b.provider_company_id) or public.is_admin()) then
    raise exception 'Only the warehouse provider can respond' using errcode='42501';
  end if;
  if v_b.status <> 'Requested' then
    raise exception 'This request was already handled (status: %)', v_b.status;
  end if;

  if p_action = 'decline' then
    update public.warehouse_space_bookings
       set status = 'Declined', provider_notes = coalesce(p_note,''), updated_at = now()
     where id = p_booking_id;
    perform public.queue_notification(
      cu.user_id, 'system', 'Space request declined',
      'Your space rental request was declined'
        || case when coalesce(trim(p_note),'') <> '' then ' — ' || trim(p_note) else '' end || '.',
      'warehouse_space_bookings', p_booking_id::text, jsonb_build_object('booking_id', p_booking_id)
    )
    from public.company_users cu
    where cu.company_id = v_b.customer_company_id and cu.status = 'Active';
    return;
  end if;

  if p_action <> 'approve' then raise exception 'Unknown action %', p_action; end if;

  select * into v_space from public.warehouse_spaces where id = v_b.space_id for update;
  v_available := greatest(v_space.total_sqft - v_space.booked_sqft, 0);
  if v_b.sqft > v_available then
    raise exception 'Only % sqft still available — this request no longer fits', v_available;
  end if;

  update public.warehouse_spaces
     set booked_sqft = booked_sqft + v_b.sqft, updated_at = now()
   where id = v_b.space_id;

  select coalesce(space_rental_commission_pct, 0) into v_pct from public.platform_settings limit 1;
  v_first := round(v_b.monthly_total + v_b.one_time_total, 2);

  v_number := 'INV-SPC-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_b.customer_company_id, v_b.provider_company_id,
    v_number, v_first, 0, v_first,
    v_b.currency, 'Issued', current_date + 7, now()
  ) returning id into v_invoice;

  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (v_invoice,
          'Warehouse space — ' || v_space.name || ' (' || v_b.sqft || ' sqft, month 1 of ' || v_b.term_months || ')',
          1, v_b.monthly_total, v_b.monthly_total, 0);
  if v_b.one_time_total > 0 then
    insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
    values (v_invoice, 'One-time setup / services', 1, v_b.one_time_total, v_b.one_time_total, 1);
  end if;

  update public.warehouse_space_bookings
     set status = 'Active',
         provider_notes = coalesce(p_note,''),
         months_billed = 1,
         last_billed_at = now(),
         platform_fee = round(v_first * (v_pct / 100.0), 2),
         updated_at = now()
   where id = p_booking_id;

  perform public.queue_notification(
    cu.user_id, 'system', 'Space rental approved',
    v_space.name || ' approved your ' || v_b.sqft || ' sqft rental. First invoice: '
      || v_first || ' ' || v_b.currency || '.',
    'warehouse_space_bookings', p_booking_id::text,
    jsonb_build_object('booking_id', p_booking_id, 'invoice_id', v_invoice)
  )
  from public.company_users cu
  where cu.company_id = v_b.customer_company_id and cu.status = 'Active';

  perform public.write_audit('space.booking_approved','warehouse_space_bookings', p_booking_id::text, null,
    jsonb_build_object('invoice_id', v_invoice, 'sqft', v_b.sqft, 'monthly', v_b.monthly_total),
    null, v_b.customer_company_id);
end;
$$;
grant execute on function public.space_respond_booking(uuid, text, text) to authenticated;

-- ─── 10) Bill the next month ──────────────────────────────────────────────────
create or replace function public.space_bill_month(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.warehouse_space_bookings;
  v_space_name text;
  v_invoice uuid;
  v_number text;
  v_pct numeric := 0;
begin
  select * into v_b from public.warehouse_space_bookings where id = p_booking_id for update;
  if v_b is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not (public.is_member_of(v_b.provider_company_id) or public.is_admin()) then
    raise exception 'Only the warehouse provider can bill' using errcode='42501';
  end if;
  if v_b.status <> 'Active' then raise exception 'Booking is not active'; end if;
  if v_b.months_billed >= v_b.term_months then
    raise exception 'All % months of this term are already billed', v_b.term_months;
  end if;

  select name into v_space_name from public.warehouse_spaces where id = v_b.space_id;
  select coalesce(space_rental_commission_pct, 0) into v_pct from public.platform_settings limit 1;

  v_number := 'INV-SPC-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_b.customer_company_id, v_b.provider_company_id,
    v_number, v_b.monthly_total, 0, v_b.monthly_total,
    v_b.currency, 'Issued', current_date + 7, now()
  ) returning id into v_invoice;

  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (v_invoice,
          'Warehouse space — ' || coalesce(v_space_name,'space') || ' (' || v_b.sqft || ' sqft, month '
            || (v_b.months_billed + 1) || ' of ' || v_b.term_months || ')',
          1, v_b.monthly_total, v_b.monthly_total, 0);

  update public.warehouse_space_bookings
     set months_billed = months_billed + 1,
         last_billed_at = now(),
         platform_fee = platform_fee + round(v_b.monthly_total * (v_pct / 100.0), 2),
         updated_at = now()
   where id = p_booking_id;

  perform public.queue_notification(
    cu.user_id, 'system', 'Monthly space invoice issued',
    'Invoice for month ' || (v_b.months_billed + 1) || ' of your ' || v_b.sqft || ' sqft rental: '
      || v_b.monthly_total || ' ' || v_b.currency || '.',
    'warehouse_space_bookings', p_booking_id::text,
    jsonb_build_object('booking_id', p_booking_id, 'invoice_id', v_invoice)
  )
  from public.company_users cu
  where cu.company_id = v_b.customer_company_id and cu.status = 'Active';

  return v_invoice;
end;
$$;
grant execute on function public.space_bill_month(uuid) to authenticated;

-- ─── 11) End / cancel ─────────────────────────────────────────────────────────
-- Provider completes an active rental (releases the footprint);
-- customer cancels their own pending request.
create or replace function public.space_end_booking(p_booking_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.warehouse_space_bookings;
  v_is_provider boolean;
  v_is_customer boolean;
begin
  select * into v_b from public.warehouse_space_bookings where id = p_booking_id for update;
  if v_b is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  v_is_provider := public.is_member_of(v_b.provider_company_id) or public.is_admin();
  v_is_customer := public.is_member_of(v_b.customer_company_id);
  if not (v_is_provider or v_is_customer) then
    raise exception 'Not a party to this booking' using errcode='42501';
  end if;

  if v_b.status = 'Requested' then
    -- Either side can withdraw a pending request.
    update public.warehouse_space_bookings
       set status = 'Cancelled', provider_notes = coalesce(p_note, provider_notes), updated_at = now()
     where id = p_booking_id;
    return;
  end if;

  if v_b.status = 'Active' then
    if not v_is_provider then
      raise exception 'Only the warehouse provider can end an active rental' using errcode='42501';
    end if;
    update public.warehouse_space_bookings
       set status = 'Completed', provider_notes = coalesce(p_note, provider_notes), updated_at = now()
     where id = p_booking_id;
    update public.warehouse_spaces
       set booked_sqft = greatest(booked_sqft - v_b.sqft, 0), updated_at = now()
     where id = v_b.space_id;
    perform public.queue_notification(
      cu.user_id, 'system', 'Space rental ended',
      'Your ' || v_b.sqft || ' sqft rental has ended. The footprint was released.',
      'warehouse_space_bookings', p_booking_id::text, jsonb_build_object('booking_id', p_booking_id)
    )
    from public.company_users cu
    where cu.company_id = v_b.customer_company_id and cu.status = 'Active';
    return;
  end if;

  raise exception 'Booking cannot be ended from status %', v_b.status;
end;
$$;
grant execute on function public.space_end_booking(uuid, text) to authenticated;

-- ─── 12) Browse (public search across providers) ─────────────────────────────
create or replace function public.space_browse()
returns table (
  id uuid,
  name text,
  space_kind text,
  city text,
  address text,
  provider_name text,
  total_sqft numeric,
  available_sqft numeric,
  min_sqft numeric,
  max_sqft numeric,
  base_rate_per_sqft_month numeric,
  currency text,
  min_term_months int,
  term_discount_3m_pct numeric,
  term_discount_6m_pct numeric,
  term_discount_12m_pct numeric,
  ceiling_height_ft numeric,
  features text[],
  notes text,
  tiers jsonb,
  addons jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id, s.name, s.space_kind, s.city, s.address,
    c.name as provider_name,
    s.total_sqft,
    greatest(s.total_sqft - s.booked_sqft, 0) as available_sqft,
    s.min_sqft, s.max_sqft, s.base_rate_per_sqft_month, s.currency,
    s.min_term_months, s.term_discount_3m_pct, s.term_discount_6m_pct, s.term_discount_12m_pct,
    s.ceiling_height_ft, s.features, s.notes,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'min_sqft', t.min_sqft, 'rate', t.rate_per_sqft_month) order by t.min_sqft)
      from public.warehouse_space_tiers t where t.space_id = s.id
    ), '[]'::jsonb) as tiers,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'pricing_unit', a.pricing_unit, 'rate', a.rate, 'required', a.is_required) order by a.created_at)
      from public.warehouse_space_addons a where a.space_id = s.id
    ), '[]'::jsonb) as addons
  from public.warehouse_spaces s
  join public.companies c on c.id = s.company_id
  where s.status = 'Active'
    and greatest(s.total_sqft - s.booked_sqft, 0) >= s.min_sqft
  order by s.created_at desc;
$$;
grant execute on function public.space_browse() to authenticated;

-- ─── 13) List bookings (provider or customer side) ───────────────────────────
create or replace function public.space_list_bookings(p_scope text default 'customer')
returns table (
  id uuid,
  space_id uuid,
  space_name text,
  space_kind text,
  provider_name text,
  customer_name text,
  sqft numeric,
  term_months int,
  start_date date,
  monthly_total numeric,
  one_time_total numeric,
  contract_total numeric,
  currency text,
  status text,
  quote jsonb,
  customer_notes text,
  provider_notes text,
  months_billed int,
  last_billed_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.space_id, s.name as space_name, s.space_kind,
    pc.name as provider_name, cc.name as customer_name,
    b.sqft, b.term_months, b.start_date,
    b.monthly_total, b.one_time_total, b.contract_total, b.currency,
    b.status, b.quote, b.customer_notes, b.provider_notes,
    b.months_billed, b.last_billed_at, b.created_at
  from public.warehouse_space_bookings b
  join public.warehouse_spaces s on s.id = b.space_id
  join public.companies pc on pc.id = b.provider_company_id
  join public.companies cc on cc.id = b.customer_company_id
  where case
    when p_scope = 'provider' then public.is_member_of(b.provider_company_id) or public.is_admin()
    else public.is_member_of(b.customer_company_id) or public.is_admin()
  end
  order by b.created_at desc;
$$;
grant execute on function public.space_list_bookings(text) to authenticated;
