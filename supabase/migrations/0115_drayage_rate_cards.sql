-- Dock2Door — World 4: Drayage rate cards, zoning & accessorials
-- Idempotent. Gives drayage companies a place to publish their pricing so
-- freight forwarders / importers-exporters can see the rate and be charged.
--
-- Model:
--   drayage_zones       — named delivery zones a drayage company defines
--   drayage_rate_cards  — a pricing sheet owned by a drayage company. A card can
--                         be the DEFAULT (customer_company_id IS NULL) or scoped
--                         to ONE specific customer company (per-customer pricing).
--                         Accessorials (fuel %, prepull, waiting, hourly, chassis,
--                         hazmat, overweight, drop&pick) live on the card.
--   drayage_zone_rates  — the base linehaul rate for a (card, zone) pair.
--   drayage_orders.zone_id / rate_card_id — the applied zone + card for an order.
--   apply_drayage_rate() — authoritative server-side price calculation.

-- =========================================================================
-- 1) ZONES
-- =========================================================================
create table if not exists public.drayage_zones (
  id uuid primary key default gen_random_uuid(),
  drayage_company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_drayage_zones_company on public.drayage_zones(drayage_company_id);

alter table public.drayage_zones enable row level security;

-- Any authenticated user can read zones (customers need to see a company's zones
-- to understand pricing). Only the owning company (or admin) can manage them.
drop policy if exists "drayage_zones_read" on public.drayage_zones;
create policy "drayage_zones_read" on public.drayage_zones for select using (public.is_authenticated());
drop policy if exists "drayage_zones_manage" on public.drayage_zones;
create policy "drayage_zones_manage" on public.drayage_zones for all
  using (public.is_admin() or public.is_member_of(drayage_company_id))
  with check (public.is_admin() or public.is_member_of(drayage_company_id));

-- =========================================================================
-- 2) RATE CARDS (+ accessorials)
-- =========================================================================
create table if not exists public.drayage_rate_cards (
  id uuid primary key default gen_random_uuid(),
  drayage_company_id uuid not null references public.companies(id) on delete cascade,
  -- NULL => the company's default/published card, visible to everyone.
  -- Set => a private per-customer card, visible only to that customer + the company.
  customer_company_id uuid references public.companies(id) on delete cascade,
  name text not null default 'Standard rates',
  currency text not null default 'CAD',
  is_default boolean not null default false,
  is_active boolean not null default true,

  -- Accessorials
  fuel_surcharge_pct numeric not null default 0,   -- % applied to the base linehaul
  prepull_fee numeric not null default 0,          -- flat, when order.is_prepull
  drop_pick_fee numeric not null default 0,        -- flat, when handling_mode = DropPick
  chassis_per_day numeric not null default 0,      -- flat per day (1 day assumed on apply)
  waiting_free_min int not null default 120,       -- free wait before charging
  waiting_per_hour numeric not null default 0,     -- charged per hour after free time
  hourly_rate numeric not null default 0,          -- hourly work rate (info / manual add)
  hazmat_fee numeric not null default 0,           -- flat, when order.is_hazmat
  overweight_fee numeric not null default 0,       -- flat, when order.is_overweight

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_drayage_rate_cards_company on public.drayage_rate_cards(drayage_company_id);
create index if not exists idx_drayage_rate_cards_customer on public.drayage_rate_cards(customer_company_id);
-- At most one default card per company.
create unique index if not exists uq_drayage_rate_cards_default
  on public.drayage_rate_cards(drayage_company_id) where is_default;

alter table public.drayage_rate_cards enable row level security;

drop policy if exists "drayage_rate_cards_read" on public.drayage_rate_cards;
create policy "drayage_rate_cards_read" on public.drayage_rate_cards for select using (
  public.is_admin()
  or public.is_member_of(drayage_company_id)
  or customer_company_id is null
  or (customer_company_id is not null and public.is_member_of(customer_company_id))
);
drop policy if exists "drayage_rate_cards_manage" on public.drayage_rate_cards;
create policy "drayage_rate_cards_manage" on public.drayage_rate_cards for all
  using (public.is_admin() or public.is_member_of(drayage_company_id))
  with check (public.is_admin() or public.is_member_of(drayage_company_id));

-- =========================================================================
-- 3) ZONE RATES — base linehaul rate per (card, zone)
-- =========================================================================
create table if not exists public.drayage_zone_rates (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references public.drayage_rate_cards(id) on delete cascade,
  zone_id uuid not null references public.drayage_zones(id) on delete cascade,
  base_rate numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rate_card_id, zone_id)
);
create index if not exists idx_drayage_zone_rates_card on public.drayage_zone_rates(rate_card_id);
create index if not exists idx_drayage_zone_rates_zone on public.drayage_zone_rates(zone_id);

alter table public.drayage_zone_rates enable row level security;

drop policy if exists "drayage_zone_rates_read" on public.drayage_zone_rates;
create policy "drayage_zone_rates_read" on public.drayage_zone_rates for select using (
  exists (
    select 1 from public.drayage_rate_cards c
    where c.id = drayage_zone_rates.rate_card_id
    and (
      public.is_admin()
      or public.is_member_of(c.drayage_company_id)
      or c.customer_company_id is null
      or (c.customer_company_id is not null and public.is_member_of(c.customer_company_id))
    )
  )
);
drop policy if exists "drayage_zone_rates_manage" on public.drayage_zone_rates;
create policy "drayage_zone_rates_manage" on public.drayage_zone_rates for all
  using (
    exists (
      select 1 from public.drayage_rate_cards c
      where c.id = drayage_zone_rates.rate_card_id
      and (public.is_admin() or public.is_member_of(c.drayage_company_id))
    )
  )
  with check (
    exists (
      select 1 from public.drayage_rate_cards c
      where c.id = drayage_zone_rates.rate_card_id
      and (public.is_admin() or public.is_member_of(c.drayage_company_id))
    )
  );

-- =========================================================================
-- 4) ORDER: applied zone + card
-- =========================================================================
alter table public.drayage_orders
  add column if not exists zone_id uuid references public.drayage_zones(id) on delete set null;
alter table public.drayage_orders
  add column if not exists rate_card_id uuid references public.drayage_rate_cards(id) on delete set null;

-- =========================================================================
-- 5) Resolve the applicable card for a (company, customer) pair
-- =========================================================================
create or replace function public.drayage_applicable_card(
  p_company_id uuid,
  p_customer_company_id uuid
) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.drayage_rate_cards
  where drayage_company_id = p_company_id and is_active
    and p_customer_company_id is not null
    and customer_company_id = p_customer_company_id
  order by updated_at desc
  limit 1
$$;
-- Note: falls back to the default card in apply_drayage_rate below.

-- =========================================================================
-- 6) apply_drayage_rate — authoritative price calc, writes it onto the order
-- =========================================================================
create or replace function public.apply_drayage_rate(
  p_order_id uuid,
  p_zone_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.drayage_orders;
  v_company uuid;
  v_card public.drayage_rate_cards;
  v_base numeric := 0;
  v_fuel numeric := 0;
  v_accessorials numeric := 0;
  v_total numeric := 0;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;

  -- The company whose rates apply: the assigned/target drayage company.
  v_company := coalesce(v_order.drayage_company_id, v_order.target_drayage_company_id);
  if v_company is null then raise exception 'no drayage company associated with this order'; end if;

  -- Only the ordering customer, the drayage company, or admin can price it.
  if not (
    public.is_admin()
    or public.is_member_of(v_company)
    or v_order.customer_user_id = auth.uid()
    or (v_order.customer_company_id is not null and public.is_member_of(v_order.customer_company_id))
  ) then
    raise exception 'not authorized to price this order' using errcode = '42501';
  end if;

  -- Pick the customer-specific card, else the company default.
  select * into v_card from public.drayage_rate_cards
  where id = public.drayage_applicable_card(v_company, v_order.customer_company_id);
  if v_card is null then
    select * into v_card from public.drayage_rate_cards
    where drayage_company_id = v_company and is_active and is_default
    order by updated_at desc limit 1;
  end if;
  if v_card is null then raise exception 'this drayage company has not published rates yet'; end if;

  -- Base linehaul for the chosen zone on that card.
  select coalesce(base_rate, 0) into v_base from public.drayage_zone_rates
  where rate_card_id = v_card.id and zone_id = p_zone_id;
  if v_base is null then v_base := 0; end if;

  v_fuel := round(v_base * coalesce(v_card.fuel_surcharge_pct, 0) / 100.0, 2);
  v_accessorials :=
      (case when v_order.is_prepull then coalesce(v_card.prepull_fee, 0) else 0 end)
    + (case when v_order.handling_mode = 'DropPick' then coalesce(v_card.drop_pick_fee, 0) else 0 end)
    + (case when v_order.is_hazmat then coalesce(v_card.hazmat_fee, 0) else 0 end)
    + (case when v_order.is_overweight then coalesce(v_card.overweight_fee, 0) else 0 end)
    + coalesce(v_card.chassis_per_day, 0);
  v_total := v_base + v_fuel + v_accessorials;

  update public.drayage_orders set
    zone_id = p_zone_id,
    rate_card_id = v_card.id,
    quoted_price = v_base,
    fuel_surcharge = v_fuel,
    drayage_fee = v_accessorials,
    total_price = v_total,
    currency = v_card.currency,
    updated_at = now()
  where id = p_order_id;

  perform public.write_audit('drayage_order.priced', 'drayage_orders', p_order_id::text, null,
    jsonb_build_object('zone', p_zone_id, 'card', v_card.id, 'total', v_total), '');
end;
$$;
grant execute on function public.apply_drayage_rate(uuid, uuid) to authenticated;
grant execute on function public.drayage_applicable_card(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
