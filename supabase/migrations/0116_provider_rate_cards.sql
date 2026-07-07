-- Dock2Door — Universal provider rate cards, zoning & accessorials.
-- Generalizes the drayage rate-card system (migration 0115) to EVERY provider
-- vertical: warehouse, trucking, labor (employer), service providers and
-- freight forwarders. Idempotent.
--
-- Model (all keyed by a `vertical` text so one company can price several ways):
--   provider_zones       — named zones/lanes/coverage areas a company defines.
--   provider_rate_cards  — a pricing sheet owned by a company for one vertical.
--                          DEFAULT card (customer_company_id IS NULL, is_default)
--                          is public; a card scoped to a customer company is a
--                          private negotiated card. Accessorials (fuel %, add-on
--                          fees, hourly, waiting, etc.) live in `accessorials`
--                          jsonb as an ordered array of line items.
--   provider_zone_rates  — the base rate for a (card, zone) pair.
--   provider_compute_quote() — authoritative server-side price calculation.
--
-- accessorials item shape (jsonb array):
--   { "key": "fuel", "label": "Fuel surcharge", "amount": 15, "type": "pct" }
--   type ∈ 'flat' | 'perUnit' | 'perHour' | 'pct'  (pct is % of the base rate)

-- =========================================================================
-- 1) ZONES
-- =========================================================================
create table if not exists public.provider_zones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vertical text not null,
  name text not null,
  description text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_provider_zones_company on public.provider_zones(company_id, vertical);

alter table public.provider_zones enable row level security;

drop policy if exists "provider_zones_read" on public.provider_zones;
create policy "provider_zones_read" on public.provider_zones for select using (public.is_authenticated());
drop policy if exists "provider_zones_manage" on public.provider_zones;
create policy "provider_zones_manage" on public.provider_zones for all
  using (public.is_admin() or public.is_member_of(company_id))
  with check (public.is_admin() or public.is_member_of(company_id));

-- =========================================================================
-- 2) RATE CARDS (+ accessorials)
-- =========================================================================
create table if not exists public.provider_rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vertical text not null,
  -- NULL => the company's public card for this vertical, visible to everyone.
  -- Set => a private per-customer card, visible only to that customer + owner.
  customer_company_id uuid references public.companies(id) on delete cascade,
  name text not null default 'Standard rates',
  currency text not null default 'CAD',
  -- Unit label describing what the base rate is measured in (e.g. 'per pallet/day',
  -- 'per mile', 'per hour', 'per load'). Purely descriptive for the UI.
  base_unit text not null default '',
  is_default boolean not null default false,
  is_active boolean not null default true,
  accessorials jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_provider_rate_cards_company on public.provider_rate_cards(company_id, vertical);
create index if not exists idx_provider_rate_cards_customer on public.provider_rate_cards(customer_company_id);
-- At most one default card per (company, vertical).
create unique index if not exists uq_provider_rate_cards_default
  on public.provider_rate_cards(company_id, vertical) where is_default;

alter table public.provider_rate_cards enable row level security;

drop policy if exists "provider_rate_cards_read" on public.provider_rate_cards;
create policy "provider_rate_cards_read" on public.provider_rate_cards for select using (
  public.is_admin()
  or public.is_member_of(company_id)
  or customer_company_id is null
  or (customer_company_id is not null and public.is_member_of(customer_company_id))
);
drop policy if exists "provider_rate_cards_manage" on public.provider_rate_cards;
create policy "provider_rate_cards_manage" on public.provider_rate_cards for all
  using (public.is_admin() or public.is_member_of(company_id))
  with check (public.is_admin() or public.is_member_of(company_id));

-- =========================================================================
-- 3) ZONE RATES — base rate per (card, zone)
-- =========================================================================
create table if not exists public.provider_zone_rates (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references public.provider_rate_cards(id) on delete cascade,
  zone_id uuid not null references public.provider_zones(id) on delete cascade,
  base_rate numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rate_card_id, zone_id)
);
create index if not exists idx_provider_zone_rates_card on public.provider_zone_rates(rate_card_id);
create index if not exists idx_provider_zone_rates_zone on public.provider_zone_rates(zone_id);

alter table public.provider_zone_rates enable row level security;

drop policy if exists "provider_zone_rates_read" on public.provider_zone_rates;
create policy "provider_zone_rates_read" on public.provider_zone_rates for select using (
  exists (
    select 1 from public.provider_rate_cards c
    where c.id = provider_zone_rates.rate_card_id
    and (
      public.is_admin()
      or public.is_member_of(c.company_id)
      or c.customer_company_id is null
      or (c.customer_company_id is not null and public.is_member_of(c.customer_company_id))
    )
  )
);
drop policy if exists "provider_zone_rates_manage" on public.provider_zone_rates;
create policy "provider_zone_rates_manage" on public.provider_zone_rates for all
  using (
    exists (
      select 1 from public.provider_rate_cards c
      where c.id = provider_zone_rates.rate_card_id
      and (public.is_admin() or public.is_member_of(c.company_id))
    )
  )
  with check (
    exists (
      select 1 from public.provider_rate_cards c
      where c.id = provider_zone_rates.rate_card_id
      and (public.is_admin() or public.is_member_of(c.company_id))
    )
  );

-- =========================================================================
-- 4) Resolve the applicable card for a (company, vertical, customer) triple
-- =========================================================================
create or replace function public.provider_applicable_card(
  p_company_id uuid,
  p_vertical text,
  p_customer_company_id uuid
) returns uuid language sql stable security definer set search_path = public as $$
  -- Prefer a customer-specific card, else fall back to the default/public card.
  select id from (
    select id, 1 as pref, updated_at from public.provider_rate_cards
      where company_id = p_company_id and vertical = p_vertical and is_active
        and p_customer_company_id is not null and customer_company_id = p_customer_company_id
    union all
    select id, 2 as pref, updated_at from public.provider_rate_cards
      where company_id = p_company_id and vertical = p_vertical and is_active and is_default
    union all
    select id, 3 as pref, updated_at from public.provider_rate_cards
      where company_id = p_company_id and vertical = p_vertical and is_active and customer_company_id is null
  ) s
  order by pref asc, updated_at desc
  limit 1
$$;
grant execute on function public.provider_applicable_card(uuid, text, uuid) to authenticated;

-- =========================================================================
-- 5) provider_compute_quote — authoritative itemized price for a card/zone
--    p_selected: jsonb object mapping accessorial key -> quantity, e.g.
--      { "labour": 3, "gate": 1, "fuel": 1 }.  A key that is absent is excluded.
--    Returns { currency, base, lines:[{key,label,amount}], total }.
-- =========================================================================
create or replace function public.provider_compute_quote(
  p_card_id uuid,
  p_zone_id uuid,
  p_selected jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_card public.provider_rate_cards;
  v_base numeric := 0;
  v_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_item jsonb;
  v_key text;
  v_type text;
  v_amount numeric;
  v_qty numeric;
  v_line numeric;
begin
  select * into v_card from public.provider_rate_cards where id = p_card_id;
  if v_card is null then raise exception 'rate card not found'; end if;

  if p_zone_id is not null then
    select coalesce(base_rate, 0) into v_base from public.provider_zone_rates
      where rate_card_id = p_card_id and zone_id = p_zone_id;
  end if;
  v_base := coalesce(v_base, 0);
  v_total := v_base;
  v_lines := jsonb_build_array(jsonb_build_object('key', 'base', 'label', 'Base rate', 'amount', v_base));

  for v_item in select * from jsonb_array_elements(coalesce(v_card.accessorials, '[]'::jsonb))
  loop
    v_key := v_item->>'key';
    v_type := coalesce(v_item->>'type', 'flat');
    v_amount := coalesce((v_item->>'amount')::numeric, 0);
    -- quantity from the selection map; absent key => item excluded.
    if p_selected ? v_key then
      v_qty := coalesce((p_selected->>v_key)::numeric, 1);
    else
      continue;
    end if;

    if v_type = 'pct' then
      v_line := round(v_base * v_amount / 100.0, 2);
    elsif v_type in ('perUnit', 'perHour') then
      v_line := round(v_amount * v_qty, 2);
    else -- flat
      v_line := v_amount;
    end if;

    if v_line <> 0 then
      v_total := v_total + v_line;
      v_lines := v_lines || jsonb_build_object('key', v_key, 'label', coalesce(v_item->>'label', v_key), 'amount', v_line);
    end if;
  end loop;

  return jsonb_build_object('currency', v_card.currency, 'base', v_base, 'lines', v_lines, 'total', v_total);
end;
$$;
grant execute on function public.provider_compute_quote(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
