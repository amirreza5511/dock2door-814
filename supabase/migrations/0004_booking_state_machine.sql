-- Dock2Door — booking state machine, transition enforcement, history, strict RLS
-- Builds on 0001 (warehouse_bookings) and 0003 (helpers). We do NOT rename the
-- existing `warehouse_bookings` table; we add a derived `warehouse_company_id`
-- column, enforce it via trigger, add a transitions table, and tighten RLS.

-- =========================================================================
-- 1) Add warehouse_company_id + created_by to warehouse_bookings
-- =========================================================================
alter table public.warehouse_bookings
  add column if not exists warehouse_company_id uuid references public.companies(id) on delete cascade,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Backfill from listing_id
update public.warehouse_bookings b
   set warehouse_company_id = wl.company_id
  from public.warehouse_listings wl
 where wl.id = b.listing_id
   and b.warehouse_company_id is null;

-- Enforce disjoint companies at row level (cannot book yourself)
do $$ begin
  alter table public.warehouse_bookings
    add constraint warehouse_bookings_disjoint_companies
    check (customer_company_id <> warehouse_company_id);
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2) Derive warehouse_company_id + validate customer membership on INSERT
-- =========================================================================
create or replace function public.booking_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_listing_company uuid;
begin
  select company_id into v_listing_company
    from public.warehouse_listings where id = new.listing_id;
  if v_listing_company is null then
    raise exception 'Listing % not found', new.listing_id using errcode = 'P0002';
  end if;

  -- Warehouse side is ALWAYS derived from the listing. Caller cannot spoof it.
  new.warehouse_company_id := v_listing_company;

  -- Record who created this booking
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  -- Customer side must be a company the caller is a member of (admins exempt)
  if not public.is_admin() then
    if not public.is_member_of(new.customer_company_id) then
      raise exception 'Not a member of customer company %', new.customer_company_id
        using errcode = '42501';
    end if;
  end if;

  -- Status must start at Requested
  if new.status is null or new.status not in ('Requested') then
    new.status := 'Requested';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_booking_before_insert on public.warehouse_bookings;
create trigger trg_booking_before_insert
  before insert on public.warehouse_bookings
  for each row execute function public.booking_before_insert();

-- =========================================================================
-- 3) Transition table + history
-- =========================================================================
create table if not exists public.booking_transitions (
  from_status booking_status not null,
  to_status booking_status not null,
  actor_side text not null check (actor_side in ('customer','warehouse','either','admin')),
  primary key (from_status, to_status)
);

insert into public.booking_transitions (from_status, to_status, actor_side) values
  ('Requested',     'Accepted',       'warehouse'),
  ('Requested',     'CounterOffered', 'warehouse'),
  ('Requested',     'Cancelled',      'customer'),
  ('Requested',     'Cancelled',      'admin'),
  ('CounterOffered','Accepted',       'customer'),
  ('CounterOffered','Requested',      'customer'),
  ('CounterOffered','Cancelled',      'customer'),
  ('Accepted',      'Confirmed',      'warehouse'),
  ('Accepted',      'Cancelled',      'customer'),
  ('Confirmed',     'InProgress',     'warehouse'),
  ('Confirmed',     'Cancelled',      'customer'),
  ('InProgress',    'Completed',      'warehouse'),
  ('InProgress',    'Cancelled',      'admin')
on conflict (from_status, to_status) do nothing;

create table if not exists public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.warehouse_bookings(id) on delete cascade,
  from_status booking_status,
  to_status booking_status not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_company_id uuid references public.companies(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_bsh_booking on public.booking_status_history(booking_id);

alter table public.booking_status_history enable row level security;

drop policy if exists "bsh_read_parties" on public.booking_status_history;
create policy "bsh_read_parties" on public.booking_status_history for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.warehouse_bookings b
       where b.id = booking_status_history.booking_id
         and (public.is_member_of(b.customer_company_id) or public.is_member_of(b.warehouse_company_id))
    )
  );

-- No direct writes — history is populated by trigger only
drop policy if exists "bsh_no_write" on public.booking_status_history;

-- =========================================================================
-- 4) Enforce transition + log history on UPDATE
-- =========================================================================
create or replace function public.enforce_booking_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_allowed_sides text[];
  v_actor_side text;
  v_is_customer boolean;
  v_is_warehouse boolean;
  v_is_admin boolean;
begin
  if new.status is null or old.status = new.status then
    return new;
  end if;

  v_is_admin := public.is_admin();
  v_is_customer := public.is_member_of(old.customer_company_id);
  v_is_warehouse := public.is_member_of(old.warehouse_company_id);

  -- Lookup every allowed actor_side for this transition
  select array_agg(actor_side) into v_allowed_sides
    from public.booking_transitions
   where from_status = old.status and to_status = new.status;

  if v_allowed_sides is null then
    raise exception 'Invalid booking transition: % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  if v_is_admin and 'admin' = any(v_allowed_sides) then
    v_actor_side := 'admin';
  elsif v_is_customer and ('customer' = any(v_allowed_sides) or 'either' = any(v_allowed_sides)) then
    v_actor_side := 'customer';
  elsif v_is_warehouse and ('warehouse' = any(v_allowed_sides) or 'either' = any(v_allowed_sides)) then
    v_actor_side := 'warehouse';
  elsif v_is_admin then
    -- Admin can always force a documented transition, but it's audited
    v_actor_side := 'admin';
  else
    raise exception 'Not authorized to transition booking % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  insert into public.booking_status_history (booking_id, from_status, to_status, actor_user_id, actor_company_id, reason)
  values (
    old.id, old.status, new.status, auth.uid(),
    case v_actor_side
      when 'customer' then old.customer_company_id
      when 'warehouse' then old.warehouse_company_id
      else null
    end,
    nullif(current_setting('request.booking_transition_reason', true), '')
  );

  return new;
end;
$$;

drop trigger if exists trg_enforce_booking_transition on public.warehouse_bookings;
create trigger trg_enforce_booking_transition
  before update of status on public.warehouse_bookings
  for each row execute function public.enforce_booking_transition();

-- =========================================================================
-- 5) Tighten booking RLS — split by actor side
-- =========================================================================
drop policy if exists "wb_customer_insert" on public.warehouse_bookings;
create policy "wb_customer_insert" on public.warehouse_bookings for insert
  with check (
    public.is_admin()
    or public.is_member_of(customer_company_id)
  );

drop policy if exists "wb_read_parties" on public.warehouse_bookings;
create policy "wb_read_parties" on public.warehouse_bookings for select
  using (
    public.is_admin()
    or public.is_member_of(customer_company_id)
    or public.is_member_of(warehouse_company_id)
  );

drop policy if exists "wb_parties_update" on public.warehouse_bookings;
create policy "wb_parties_update" on public.warehouse_bookings for update
  using (
    public.is_admin()
    or public.is_member_of(customer_company_id)
    or public.is_member_of(warehouse_company_id)
  ) with check (
    -- Cannot change ownership columns after insert
    public.is_admin()
    or (
      customer_company_id = (select customer_company_id from public.warehouse_bookings b where b.id = warehouse_bookings.id)
      and warehouse_company_id = (select warehouse_company_id from public.warehouse_bookings b where b.id = warehouse_bookings.id)
      and listing_id = (select listing_id from public.warehouse_bookings b where b.id = warehouse_bookings.id)
    )
  );

-- =========================================================================
-- 6) Helper RPC to transition a booking with a reason string
-- =========================================================================
create or replace function public.transition_booking(
  p_booking_id uuid,
  p_next_status booking_status,
  p_reason text default null,
  p_counter_offer_price numeric default null,
  p_response_notes text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason is not null then
    perform set_config('request.booking_transition_reason', p_reason, true);
  end if;

  update public.warehouse_bookings
     set status = p_next_status,
         counter_offer_price = coalesce(p_counter_offer_price, counter_offer_price),
         provider_response_notes = coalesce(p_response_notes, provider_response_notes),
         final_price = case when p_next_status = 'Completed'
                            then coalesce(final_price, counter_offer_price, proposed_price)
                            else final_price end
   where id = p_booking_id;
end;
$$;
grant execute on function public.transition_booking(uuid, booking_status, text, numeric, text) to authenticated;
