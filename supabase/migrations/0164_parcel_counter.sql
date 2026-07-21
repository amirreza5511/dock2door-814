-- =========================================================================
-- 0164 — Air Courier / Parcel Counter (post-office style)
-- Idempotent & additive. Safe to run multiple times.
--
-- A customer enters parcel size + weight, picks a service level, and gets an
-- instant price (placeholder Canada Post-style rate table until real
-- Canada Post API credentials are wired in). The app then issues a shipment
-- with a scannable tracking barcode + printable label placeholder to drop off.
--
-- NOTE: rates & barcodes here are clearly-labeled PLACEHOLDERS. When Canada
-- Post API keys are provided, parcel_quote / parcel_create can be upgraded to
-- call the live rating + label endpoints without changing the app surface.
-- =========================================================================

-- ─── 1) Parcel shipments ─────────────────────────────────────────────────────
create table if not exists public.parcel_shipments (
  id uuid primary key default gen_random_uuid(),
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,

  -- Sender
  from_name text not null default '',
  from_line1 text not null default '',
  from_city text not null default '',
  from_region text not null default '',
  from_postal text not null default '',
  from_country text not null default 'CA',

  -- Recipient
  to_name text not null default '',
  to_line1 text not null default '',
  to_city text not null default '',
  to_region text not null default '',
  to_postal text not null default '',
  to_country text not null default 'CA',

  -- Parcel
  length_cm numeric not null default 0,
  width_cm numeric not null default 0,
  height_cm numeric not null default 0,
  dim_unit text not null default 'cm' check (dim_unit in ('cm','in')),
  weight numeric not null default 0,
  weight_unit text not null default 'kg' check (weight_unit in ('kg','lb')),

  service text not null default 'regular'
    check (service in ('regular','expedited','xpresspost','priority')),
  currency text not null default 'CAD',
  price numeric not null default 0,
  rate_source text not null default 'placeholder'
    check (rate_source in ('placeholder','canada_post')),

  tracking_number text not null,
  label_url text not null default '',
  is_placeholder boolean not null default true,

  status text not null default 'Created'
    check (status in ('Created','DroppedOff','InTransit','Delivered','Cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tracking_number)
);
create index if not exists idx_parcel_customer on public.parcel_shipments(customer_company_id);
create index if not exists idx_parcel_status   on public.parcel_shipments(status);

-- ─── 2) RLS ───────────────────────────────────────────────────────────────────
alter table public.parcel_shipments enable row level security;

drop policy if exists "parcel_read" on public.parcel_shipments;
create policy "parcel_read" on public.parcel_shipments for select using (
  public.is_member_of(customer_company_id) or public.is_admin()
);

drop policy if exists "parcel_insert" on public.parcel_shipments;
create policy "parcel_insert" on public.parcel_shipments for insert with check (
  created_by = auth.uid() and public.is_member_of(customer_company_id)
);

drop policy if exists "parcel_update" on public.parcel_shipments;
create policy "parcel_update" on public.parcel_shipments for update
  using (public.is_member_of(customer_company_id) or public.is_admin())
  with check (public.is_member_of(customer_company_id) or public.is_admin());

-- ─── 3) Placeholder rating (Canada Post-style tiers) ─────────────────────────
-- Chargeable weight = max(actual, volumetric). Volumetric divisor 5000 (cm³/kg),
-- the common courier air standard. Returns price in the requested currency using
-- simple static FX multipliers (replaced by live rating when API keys land).
create or replace function public.parcel_quote(
  p_length numeric,
  p_width numeric,
  p_height numeric,
  p_dim_unit text,
  p_weight numeric,
  p_weight_unit text,
  p_service text default 'regular',
  p_currency text default 'CAD'
)
returns table (
  chargeable_kg numeric,
  price numeric,
  currency text,
  rate_source text,
  is_placeholder boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_l numeric := coalesce(p_length,0);
  v_w numeric := coalesce(p_width,0);
  v_h numeric := coalesce(p_height,0);
  v_kg numeric := coalesce(p_weight,0);
  v_vol numeric;
  v_charge numeric;
  v_base numeric;
  v_per_kg numeric;
  v_price_cad numeric;
  v_fx numeric;
  v_cur text := coalesce(nullif(trim(p_currency),''),'CAD');
begin
  -- Normalise to cm / kg.
  if p_dim_unit = 'in' then
    v_l := v_l * 2.54; v_w := v_w * 2.54; v_h := v_h * 2.54;
  end if;
  if p_weight_unit = 'lb' then
    v_kg := v_kg * 0.453592;
  end if;

  v_vol := (v_l * v_w * v_h) / 5000.0;
  v_charge := greatest(v_kg, v_vol);
  if v_charge <= 0 then v_charge := 0.5; end if;
  v_charge := ceil(v_charge * 2) / 2.0; -- round up to nearest 0.5 kg

  -- Placeholder tier: base fee + per-kg by service (CAD).
  case p_service
    when 'expedited' then v_base := 14.99; v_per_kg := 3.20;
    when 'xpresspost' then v_base := 22.50; v_per_kg := 4.75;
    when 'priority'   then v_base := 34.00; v_per_kg := 6.50;
    else                   v_base := 11.99; v_per_kg := 2.40; -- regular
  end case;

  v_price_cad := v_base + v_per_kg * v_charge;

  -- Static FX from CAD (placeholder — replaced by real rating later).
  v_fx := case v_cur
    when 'USD' then 0.73 when 'EUR' then 0.68 when 'GBP' then 0.58
    when 'AED' then 2.68 when 'CNY' then 5.25 else 1.0 end;

  return query select
    v_charge,
    round(v_price_cad * v_fx, 2),
    v_cur,
    'placeholder'::text,
    true;
end;
$$;
grant execute on function public.parcel_quote(numeric, numeric, numeric, text, numeric, text, text, text) to authenticated;

-- ─── 4) Tracking number generator (placeholder barcode payload) ──────────────
-- Format: RK + 9 digits + CA — a scannable Code128 payload the label renders.
create or replace function public.parcel_gen_tracking()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_num text;
  v_tries int := 0;
begin
  loop
    v_num := 'RK' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0') || 'CA';
    exit when not exists (select 1 from public.parcel_shipments where tracking_number = v_num);
    v_tries := v_tries + 1;
    if v_tries > 20 then
      v_num := 'RK' || lpad((extract(epoch from clock_timestamp())*1000)::bigint::text, 9, '0') || 'CA';
      exit;
    end if;
  end loop;
  return v_num;
end;
$$;
grant execute on function public.parcel_gen_tracking() to authenticated;

-- ─── 5) Create a parcel shipment (issues tracking + placeholder label) ───────
create or replace function public.parcel_create(
  p_from_name text, p_from_line1 text, p_from_city text, p_from_region text,
  p_from_postal text, p_from_country text,
  p_to_name text, p_to_line1 text, p_to_city text, p_to_region text,
  p_to_postal text, p_to_country text,
  p_length numeric, p_width numeric, p_height numeric, p_dim_unit text,
  p_weight numeric, p_weight_unit text,
  p_service text default 'regular',
  p_currency text default 'CAD',
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_id uuid;
  v_tracking text;
  v_quote record;
  v_dim text := case when p_dim_unit = 'in' then 'in' else 'cm' end;
  v_wu text := case when p_weight_unit = 'lb' then 'lb' else 'kg' end;
  v_svc text := case when p_service in ('regular','expedited','xpresspost','priority') then p_service else 'regular' end;
begin
  select cu.company_id into v_company
  from public.company_users cu
  where cu.user_id = auth.uid() and cu.status = 'Active'
  limit 1;
  if v_company is null then
    raise exception 'You need a company account to create a parcel' using errcode='42501';
  end if;
  if coalesce(trim(p_to_name),'') = '' or coalesce(trim(p_to_city),'') = '' then
    raise exception 'Recipient name and city are required';
  end if;
  if coalesce(p_weight,0) <= 0 then
    raise exception 'Parcel weight is required';
  end if;

  select * into v_quote from public.parcel_quote(
    p_length, p_width, p_height, v_dim, p_weight, v_wu, v_svc, p_currency
  );

  v_tracking := public.parcel_gen_tracking();

  insert into public.parcel_shipments (
    customer_company_id, created_by,
    from_name, from_line1, from_city, from_region, from_postal, from_country,
    to_name, to_line1, to_city, to_region, to_postal, to_country,
    length_cm, width_cm, height_cm, dim_unit, weight, weight_unit,
    service, currency, price, rate_source, tracking_number, is_placeholder, notes
  ) values (
    v_company, auth.uid(),
    coalesce(trim(p_from_name),''), coalesce(trim(p_from_line1),''),
    coalesce(trim(p_from_city),''), coalesce(trim(p_from_region),''),
    coalesce(trim(p_from_postal),''), coalesce(nullif(trim(p_from_country),''),'CA'),
    coalesce(trim(p_to_name),''), coalesce(trim(p_to_line1),''),
    coalesce(trim(p_to_city),''), coalesce(trim(p_to_region),''),
    coalesce(trim(p_to_postal),''), coalesce(nullif(trim(p_to_country),''),'CA'),
    coalesce(p_length,0), coalesce(p_width,0), coalesce(p_height,0), v_dim,
    coalesce(p_weight,0), v_wu,
    v_svc, v_quote.currency, v_quote.price, v_quote.rate_source, v_tracking, v_quote.is_placeholder,
    coalesce(p_notes,'')
  ) returning id into v_id;

  perform public.write_audit('parcel.created','parcel_shipments', v_id::text, null,
    jsonb_build_object('tracking', v_tracking, 'price', v_quote.price), null, v_company);
  return v_id;
end;
$$;
grant execute on function public.parcel_create(
  text, text, text, text, text, text,
  text, text, text, text, text, text,
  numeric, numeric, numeric, text, numeric, text, text, text, text
) to authenticated;

-- ─── 6) Status transitions ────────────────────────────────────────────────────
create or replace function public.parcel_set_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.parcel_shipments;
begin
  select * into v_row from public.parcel_shipments where id = p_id for update;
  if v_row is null then raise exception 'Parcel not found' using errcode='P0002'; end if;
  if not (public.is_member_of(v_row.customer_company_id) or public.is_admin()) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_status not in ('DroppedOff','InTransit','Delivered','Cancelled') then
    raise exception 'Invalid status';
  end if;
  update public.parcel_shipments set status = p_status, updated_at = now() where id = p_id;
end;
$$;
grant execute on function public.parcel_set_status(uuid, text) to authenticated;

-- ─── 7) Read RPCs ────────────────────────────────────────────────────────────
create or replace function public.parcel_list_mine()
returns setof public.parcel_shipments
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid;
begin
  select cu.company_id into v_company
  from public.company_users cu
  where cu.user_id = auth.uid() and cu.status = 'Active'
  limit 1;
  if v_company is null then
    raise exception 'Company account required' using errcode='42501';
  end if;
  return query
  select * from public.parcel_shipments
  where customer_company_id = v_company
  order by created_at desc;
end; $$;
grant execute on function public.parcel_list_mine() to authenticated;

create or replace function public.parcel_get(p_id uuid)
returns setof public.parcel_shipments
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select * from public.parcel_shipments p
  where p.id = p_id
    and (public.is_member_of(p.customer_company_id) or public.is_admin());
end; $$;
grant execute on function public.parcel_get(uuid) to authenticated;
