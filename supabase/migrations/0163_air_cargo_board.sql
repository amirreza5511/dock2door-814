-- =========================================================================
-- 0163 — Air Cargo Board (personal & commercial air freight)
-- Idempotent & additive. Safe to run multiple times.
--
-- Same bid model as the ocean board (0162): a customer posts an air-freight
-- request (photos of the goods, dimensions, weight, origin/dest airports or
-- cities). An instant AI estimate is stored as a rough guide. Member Freight
-- Forwarders then submit competing OFFERS; the customer ACCEPTS one, the
-- winning forwarder is booked, other offers auto-reject, and a shared chat
-- opens. Personal vs. commercial: commercial adds commodity / value / HS-code.
-- Reuses forwarder_company_for(), is_member_of(), queue_notification(),
-- write_audit(), is_admin() from earlier migrations.
-- =========================================================================

-- ─── 1) Air requests ─────────────────────────────────────────────────────────
create table if not exists public.air_requests (
  id uuid primary key default gen_random_uuid(),
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  awarded_company_id uuid references public.companies(id) on delete set null,
  awarded_offer_id uuid,
  title text not null,
  shipment_kind text not null default 'personal'
    check (shipment_kind in ('personal','commercial')),
  origin_country text not null default '',
  origin_city text not null default '',
  origin_airport text not null default '',
  dest_country text not null default '',
  dest_city text not null default '',
  dest_airport text not null default '',
  cargo_type text not null default '',
  photos jsonb not null default '[]'::jsonb,
  length_cm numeric not null default 0,
  width_cm numeric not null default 0,
  height_cm numeric not null default 0,
  dim_unit text not null default 'cm' check (dim_unit in ('cm','in')),
  weight numeric not null default 0,
  weight_unit text not null default 'kg' check (weight_unit in ('kg','lb')),
  pieces int not null default 1,
  ready_date date,
  -- commercial-only fields
  commodity text not null default '',
  declared_value numeric not null default 0,
  hs_code text not null default '',
  currency text not null default 'CAD',
  notes text not null default '',
  -- AI estimate (rough guide, not binding)
  estimate_low numeric not null default 0,
  estimate_high numeric not null default 0,
  estimate_currency text not null default 'CAD',
  estimate_note text not null default '',
  estimated_at timestamptz,
  status text not null default 'Open'
    check (status in ('Open','Booked','InTransit','Completed','Cancelled')),
  awarded_amount numeric not null default 0,
  booked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_air_req_customer on public.air_requests(customer_company_id);
create index if not exists idx_air_req_awarded  on public.air_requests(awarded_company_id);
create index if not exists idx_air_req_status   on public.air_requests(status);

-- ─── 2) Air offers (one row per forwarder bid) ───────────────────────────────
create table if not exists public.air_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.air_requests(id) on delete cascade,
  forwarder_company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  amount numeric not null default 0,
  currency text not null default 'CAD',
  transit_days int not null default 0,
  departure_date date,
  note text not null default '',
  status text not null default 'Pending'
    check (status in ('Pending','Accepted','Rejected','Withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, forwarder_company_id)
);
create index if not exists idx_air_off_request on public.air_offers(request_id);
create index if not exists idx_air_off_fwd     on public.air_offers(forwarder_company_id);

-- ─── 3) Air messages (customer ↔ winning forwarder) ──────────────────────────
create table if not exists public.air_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.air_requests(id) on delete cascade,
  sender_user_id uuid references public.profiles(id) on delete set null,
  sender_name text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_air_msg_request on public.air_messages(request_id, created_at);

-- ─── 4) Party helper ──────────────────────────────────────────────────────────
create or replace function public.is_air_party(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.air_requests r
    where r.id = p_request_id
      and (
        public.is_member_of(r.customer_company_id)
        or (r.awarded_company_id is not null and public.is_member_of(r.awarded_company_id))
        or public.is_admin()
      )
  );
$$;
grant execute on function public.is_air_party(uuid) to authenticated;

-- ─── 5) RLS ───────────────────────────────────────────────────────────────────
alter table public.air_requests enable row level security;

drop policy if exists "air_req_read" on public.air_requests;
create policy "air_req_read" on public.air_requests for select using (
  public.is_member_of(customer_company_id)
  or (awarded_company_id is not null and public.is_member_of(awarded_company_id))
  or (status = 'Open' and public.forwarder_company_for() is not null)
  or exists (
    select 1 from public.air_offers o
    where o.request_id = air_requests.id
      and public.is_member_of(o.forwarder_company_id)
  )
  or public.is_admin()
);

drop policy if exists "air_req_insert" on public.air_requests;
create policy "air_req_insert" on public.air_requests for insert with check (
  created_by = auth.uid() and public.is_member_of(customer_company_id)
);

drop policy if exists "air_req_update" on public.air_requests;
create policy "air_req_update" on public.air_requests for update
  using (public.is_air_party(id))
  with check (public.is_air_party(id));

alter table public.air_offers enable row level security;

drop policy if exists "air_off_read" on public.air_offers;
create policy "air_off_read" on public.air_offers for select using (
  public.is_member_of(forwarder_company_id)
  or exists (
    select 1 from public.air_requests r
    where r.id = air_offers.request_id
      and (public.is_member_of(r.customer_company_id) or public.is_admin())
  )
);

drop policy if exists "air_off_write" on public.air_offers;
create policy "air_off_write" on public.air_offers for all
  using (public.is_member_of(forwarder_company_id) or public.is_admin())
  with check (public.is_member_of(forwarder_company_id) or public.is_admin());

alter table public.air_messages enable row level security;

drop policy if exists "air_msg_read" on public.air_messages;
create policy "air_msg_read" on public.air_messages for select using (
  public.is_air_party(request_id)
);

-- ─── 6) Customer posts an air request ─────────────────────────────────────────
create or replace function public.air_create_request(
  p_title text,
  p_shipment_kind text default 'personal',
  p_origin_country text default '',
  p_origin_city text default '',
  p_origin_airport text default '',
  p_dest_country text default '',
  p_dest_city text default '',
  p_dest_airport text default '',
  p_cargo_type text default '',
  p_photos jsonb default '[]'::jsonb,
  p_length_cm numeric default 0,
  p_width_cm numeric default 0,
  p_height_cm numeric default 0,
  p_dim_unit text default 'cm',
  p_weight numeric default 0,
  p_weight_unit text default 'kg',
  p_pieces int default 1,
  p_ready_date date default null,
  p_commodity text default '',
  p_declared_value numeric default 0,
  p_hs_code text default '',
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
  v_company_name text;
begin
  select cu.company_id into v_company
  from public.company_users cu
  where cu.user_id = auth.uid() and cu.status = 'Active'
  limit 1;
  if v_company is null then
    raise exception 'You need a company account to post an air request' using errcode='42501';
  end if;
  if coalesce(trim(p_title),'') = '' then
    raise exception 'A short title for the shipment is required';
  end if;

  insert into public.air_requests (
    customer_company_id, created_by, title, shipment_kind,
    origin_country, origin_city, origin_airport,
    dest_country, dest_city, dest_airport,
    cargo_type, photos, length_cm, width_cm, height_cm, dim_unit,
    weight, weight_unit, pieces, ready_date,
    commodity, declared_value, hs_code, currency, notes
  ) values (
    v_company, auth.uid(), trim(p_title),
    case when p_shipment_kind in ('personal','commercial') then p_shipment_kind else 'personal' end,
    coalesce(trim(p_origin_country),''), coalesce(trim(p_origin_city),''), coalesce(trim(p_origin_airport),''),
    coalesce(trim(p_dest_country),''), coalesce(trim(p_dest_city),''), coalesce(trim(p_dest_airport),''),
    coalesce(trim(p_cargo_type),''), coalesce(p_photos,'[]'::jsonb),
    greatest(coalesce(p_length_cm,0),0), greatest(coalesce(p_width_cm,0),0), greatest(coalesce(p_height_cm,0),0),
    case when p_dim_unit in ('cm','in') then p_dim_unit else 'cm' end,
    greatest(coalesce(p_weight,0),0),
    case when p_weight_unit in ('kg','lb') then p_weight_unit else 'kg' end,
    greatest(coalesce(p_pieces,1),1), p_ready_date,
    coalesce(trim(p_commodity),''), greatest(coalesce(p_declared_value,0),0),
    coalesce(trim(p_hs_code),''), coalesce(nullif(trim(p_currency),''),'CAD'), coalesce(p_notes,'')
  ) returning id into v_id;

  select name into v_company_name from public.companies where id = v_company;

  perform public.queue_notification(
    cu.user_id, 'system', 'New air cargo request',
    coalesce(v_company_name,'A company') || ' posted: ' || trim(p_title),
    'air_requests', v_id::text, jsonb_build_object('request_id', v_id)
  )
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where c.type::text = 'FreightForwarder' and cu.status = 'Active';

  perform public.write_audit('air.request_created','air_requests', v_id::text, null,
    jsonb_build_object('title', trim(p_title)), null, v_company);
  return v_id;
end;
$$;
grant execute on function public.air_create_request(text, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, numeric, text, numeric, text, int, date, text, numeric, text, text, text) to authenticated;

-- ─── 7) Store AI estimate on a request ────────────────────────────────────────
create or replace function public.air_set_estimate(
  p_request_id uuid,
  p_low numeric,
  p_high numeric,
  p_currency text default 'CAD',
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.air_requests;
begin
  select * into v_req from public.air_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_req.customer_company_id) then
    raise exception 'Only the requesting company can set an estimate' using errcode='42501';
  end if;
  update public.air_requests
     set estimate_low = greatest(coalesce(p_low,0),0),
         estimate_high = greatest(coalesce(p_high,0),0),
         estimate_currency = coalesce(nullif(trim(p_currency),''),'CAD'),
         estimate_note = coalesce(p_note,''),
         estimated_at = now(),
         updated_at = now()
   where id = p_request_id;
end;
$$;
grant execute on function public.air_set_estimate(uuid, numeric, numeric, text, text) to authenticated;

-- ─── 8) Forwarder submits / updates an offer ─────────────────────────────────
create or replace function public.air_submit_offer(
  p_request_id uuid,
  p_amount numeric,
  p_currency text default 'CAD',
  p_transit_days int default 0,
  p_departure_date date default null,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fwd uuid;
  v_req public.air_requests;
  v_id uuid;
  v_fwd_name text;
begin
  v_fwd := public.forwarder_company_for();
  if v_fwd is null then
    raise exception 'Only freight forwarder members can send offers' using errcode='42501';
  end if;
  if coalesce(p_amount,0) <= 0 then
    raise exception 'Offer amount must be greater than zero';
  end if;
  select * into v_req from public.air_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_req.status <> 'Open' then
    raise exception 'This request is no longer open (status: %)', v_req.status;
  end if;

  insert into public.air_offers (
    request_id, forwarder_company_id, created_by, amount, currency,
    transit_days, departure_date, note, status
  ) values (
    p_request_id, v_fwd, auth.uid(), round(p_amount,2),
    coalesce(nullif(trim(p_currency),''),'CAD'),
    greatest(coalesce(p_transit_days,0),0), p_departure_date, coalesce(p_note,''), 'Pending'
  )
  on conflict (request_id, forwarder_company_id) do update
    set amount = round(p_amount,2),
        currency = coalesce(nullif(trim(p_currency),''),'CAD'),
        transit_days = greatest(coalesce(p_transit_days,0),0),
        departure_date = p_departure_date,
        note = coalesce(p_note,''),
        status = 'Pending',
        updated_at = now()
  returning id into v_id;

  select name into v_fwd_name from public.companies where id = v_fwd;
  perform public.queue_notification(
    cu.user_id, 'system', 'New air cargo offer',
    coalesce(v_fwd_name,'A forwarder') || ' offered ' || round(p_amount,2)::text
      || ' ' || coalesce(nullif(trim(p_currency),''),'CAD') || ' for: ' || v_req.title,
    'air_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id, 'offer_id', v_id)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';

  return v_id;
end;
$$;
grant execute on function public.air_submit_offer(uuid, numeric, text, int, date, text) to authenticated;

-- ─── 9) Forwarder withdraws an offer ──────────────────────────────────────────
create or replace function public.air_withdraw_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fwd uuid;
  v_off public.air_offers;
begin
  v_fwd := public.forwarder_company_for();
  select * into v_off from public.air_offers where id = p_offer_id for update;
  if v_off is null then raise exception 'Offer not found' using errcode='P0002'; end if;
  if v_fwd is null or v_off.forwarder_company_id <> v_fwd then
    raise exception 'Only the offering forwarder can withdraw this' using errcode='42501';
  end if;
  if v_off.status = 'Accepted' then
    raise exception 'An accepted offer cannot be withdrawn';
  end if;
  update public.air_offers set status = 'Withdrawn', updated_at = now() where id = p_offer_id;
end;
$$;
grant execute on function public.air_withdraw_offer(uuid) to authenticated;

-- ─── 10) Customer accepts an offer → books the forwarder ─────────────────────
create or replace function public.air_accept_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_off public.air_offers;
  v_req public.air_requests;
  v_cust_name text;
begin
  select * into v_off from public.air_offers where id = p_offer_id for update;
  if v_off is null then raise exception 'Offer not found' using errcode='P0002'; end if;
  select * into v_req from public.air_requests where id = v_off.request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_req.customer_company_id) then
    raise exception 'Only the requesting company can accept an offer' using errcode='42501';
  end if;
  if v_req.status <> 'Open' then
    raise exception 'This request is no longer open (status: %)', v_req.status;
  end if;
  if v_off.status not in ('Pending') then
    raise exception 'This offer is no longer available (status: %)', v_off.status;
  end if;

  update public.air_offers set status = 'Accepted', updated_at = now() where id = p_offer_id;
  update public.air_offers
     set status = 'Rejected', updated_at = now()
   where request_id = v_req.id and id <> p_offer_id and status = 'Pending';

  update public.air_requests
     set status = 'Booked',
         awarded_company_id = v_off.forwarder_company_id,
         awarded_offer_id = p_offer_id,
         awarded_amount = v_off.amount,
         booked_at = now(),
         updated_at = now()
   where id = v_req.id;

  select name into v_cust_name from public.companies where id = v_req.customer_company_id;
  perform public.queue_notification(
    cu.user_id, 'system', 'Your air cargo offer was accepted',
    coalesce(v_cust_name,'The customer') || ' booked your offer for: ' || v_req.title,
    'air_requests', v_req.id::text, jsonb_build_object('request_id', v_req.id)
  )
  from public.company_users cu
  where cu.company_id = v_off.forwarder_company_id and cu.status = 'Active';

  perform public.write_audit('air.offer_accepted','air_requests', v_req.id::text, null,
    jsonb_build_object('offer_id', p_offer_id, 'amount', v_off.amount), null, v_req.customer_company_id);
end;
$$;
grant execute on function public.air_accept_offer(uuid) to authenticated;

-- ─── 11) Status transitions ───────────────────────────────────────────────────
create or replace function public.air_set_status(p_request_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.air_requests;
begin
  select * into v_req from public.air_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_air_party(p_request_id) then
    raise exception 'You are not part of this shipment' using errcode='42501';
  end if;
  if p_status not in ('InTransit','Completed') then
    raise exception 'Status must be InTransit or Completed';
  end if;
  if v_req.status not in ('Booked','InTransit') then
    raise exception 'Cannot change status from %', v_req.status;
  end if;

  update public.air_requests
     set status = p_status,
         completed_at = case when p_status = 'Completed' then now() else completed_at end,
         updated_at = now()
   where id = p_request_id;

  perform public.queue_notification(
    cu.user_id, 'system', 'Air cargo update',
    v_req.title || ' is now ' || p_status,
    'air_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id, 'status', p_status)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';
end;
$$;
grant execute on function public.air_set_status(uuid, text) to authenticated;

-- ─── 12) Customer cancels a request ───────────────────────────────────────────
create or replace function public.air_cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.air_requests;
begin
  select * into v_req from public.air_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_req.customer_company_id) then
    raise exception 'Only the requesting company can cancel' using errcode='42501';
  end if;
  if v_req.status not in ('Open','Booked') then
    raise exception 'This request cannot be cancelled (status: %)', v_req.status;
  end if;

  update public.air_requests set status = 'Cancelled', updated_at = now() where id = p_request_id;
  update public.air_offers set status = 'Rejected', updated_at = now()
   where request_id = p_request_id and status = 'Pending';

  if v_req.awarded_company_id is not null then
    perform public.queue_notification(
      cu.user_id, 'system', 'Air cargo cancelled',
      'The customer cancelled: ' || v_req.title,
      'air_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.awarded_company_id and cu.status = 'Active';
  end if;
end;
$$;
grant execute on function public.air_cancel_request(uuid) to authenticated;

-- ─── 13) On-platform messaging ────────────────────────────────────────────────
create or replace function public.air_send_message(p_request_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.air_requests;
  v_id uuid;
  v_name text;
  v_is_customer boolean;
begin
  select * into v_req from public.air_requests where id = p_request_id;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_air_party(p_request_id) then
    raise exception 'You are not part of this shipment' using errcode='42501';
  end if;
  if coalesce(trim(p_body),'') = '' then
    raise exception 'Message cannot be empty';
  end if;

  select name into v_name from public.profiles where id = auth.uid();
  insert into public.air_messages (request_id, sender_user_id, sender_name, body)
  values (p_request_id, auth.uid(), coalesce(v_name,''), trim(p_body))
  returning id into v_id;

  v_is_customer := public.is_member_of(v_req.customer_company_id);
  if v_is_customer and v_req.awarded_company_id is not null then
    perform public.queue_notification(
      cu.user_id, 'system', 'New air cargo message',
      coalesce(v_name,'The customer') || ': ' || left(trim(p_body), 120),
      'air_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.awarded_company_id and cu.status = 'Active';
  elsif not v_is_customer then
    perform public.queue_notification(
      cu.user_id, 'system', 'New air cargo message',
      coalesce(v_name,'Your forwarder') || ': ' || left(trim(p_body), 120),
      'air_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.customer_company_id and cu.status = 'Active';
  end if;

  return v_id;
end;
$$;
grant execute on function public.air_send_message(uuid, text) to authenticated;

-- ─── 14) Read RPCs ────────────────────────────────────────────────────────────
create or replace function public.air_list_mine()
returns table (
  id uuid, title text, shipment_kind text,
  origin_country text, origin_city text, origin_airport text,
  dest_country text, dest_city text, dest_airport text,
  cargo_type text, photos jsonb,
  length_cm numeric, width_cm numeric, height_cm numeric, dim_unit text,
  weight numeric, weight_unit text, pieces int, ready_date date,
  commodity text, declared_value numeric, hs_code text,
  currency text, notes text,
  estimate_low numeric, estimate_high numeric, estimate_currency text, estimate_note text,
  status text, awarded_amount numeric, awarded_name text,
  offer_count bigint, created_at timestamptz
)
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
  select r.id, r.title, r.shipment_kind,
         r.origin_country, r.origin_city, r.origin_airport,
         r.dest_country, r.dest_city, r.dest_airport,
         r.cargo_type, r.photos,
         r.length_cm, r.width_cm, r.height_cm, r.dim_unit,
         r.weight, r.weight_unit, r.pieces, r.ready_date,
         r.commodity, r.declared_value, r.hs_code,
         r.currency, r.notes,
         r.estimate_low, r.estimate_high, r.estimate_currency, r.estimate_note,
         r.status, r.awarded_amount, coalesce(a.name,''),
         (select count(*) from public.air_offers o where o.request_id = r.id and o.status = 'Pending'),
         r.created_at
  from public.air_requests r
  left join public.companies a on a.id = r.awarded_company_id
  where r.customer_company_id = v_company
  order by r.created_at desc;
end; $$;
grant execute on function public.air_list_mine() to authenticated;

create or replace function public.air_forwarder_board(p_scope text default 'open')
returns table (
  id uuid, title text, shipment_kind text,
  origin_country text, origin_city text, origin_airport text,
  dest_country text, dest_city text, dest_airport text,
  cargo_type text, photos jsonb,
  length_cm numeric, width_cm numeric, height_cm numeric, dim_unit text,
  weight numeric, weight_unit text, pieces int, ready_date date,
  commodity text, declared_value numeric, hs_code text,
  currency text, notes text,
  estimate_low numeric, estimate_high numeric, estimate_currency text,
  status text, customer_name text,
  my_offer_amount numeric, my_offer_status text, awarded_amount numeric,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_fwd uuid;
begin
  v_fwd := public.forwarder_company_for();
  if v_fwd is null then
    raise exception 'Only freight forwarder members can view this' using errcode='42501';
  end if;
  if p_scope = 'mine' then
    return query
    select r.id, r.title, r.shipment_kind,
           r.origin_country, r.origin_city, r.origin_airport,
           r.dest_country, r.dest_city, r.dest_airport,
           r.cargo_type, r.photos,
           r.length_cm, r.width_cm, r.height_cm, r.dim_unit,
           r.weight, r.weight_unit, r.pieces, r.ready_date,
           r.commodity, r.declared_value, r.hs_code,
           r.currency, r.notes,
           r.estimate_low, r.estimate_high, r.estimate_currency,
           r.status, coalesce(c.name,'Company'),
           o.amount, o.status, r.awarded_amount, r.created_at
    from public.air_offers o
    join public.air_requests r on r.id = o.request_id
    left join public.companies c on c.id = r.customer_company_id
    where o.forwarder_company_id = v_fwd
    order by r.created_at desc;
  else
    return query
    select r.id, r.title, r.shipment_kind,
           r.origin_country, r.origin_city, r.origin_airport,
           r.dest_country, r.dest_city, r.dest_airport,
           r.cargo_type, r.photos,
           r.length_cm, r.width_cm, r.height_cm, r.dim_unit,
           r.weight, r.weight_unit, r.pieces, r.ready_date,
           r.commodity, r.declared_value, r.hs_code,
           r.currency, r.notes,
           r.estimate_low, r.estimate_high, r.estimate_currency,
           r.status, coalesce(c.name,'Company'),
           o.amount, o.status, r.awarded_amount, r.created_at
    from public.air_requests r
    left join public.companies c on c.id = r.customer_company_id
    left join public.air_offers o
      on o.request_id = r.id and o.forwarder_company_id = v_fwd
    where r.status = 'Open'
    order by r.created_at desc;
  end if;
end; $$;
grant execute on function public.air_forwarder_board(text) to authenticated;

create or replace function public.air_list_offers(p_request_id uuid)
returns table (
  id uuid, forwarder_name text, amount numeric, currency text,
  transit_days int, departure_date date, note text, status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_air_party(p_request_id) or exists (
    select 1 from public.air_offers o
    where o.request_id = p_request_id and public.is_member_of(o.forwarder_company_id)
  )) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query
  select o.id, coalesce(c.name,'Forwarder'), o.amount, o.currency,
         o.transit_days, o.departure_date, o.note, o.status, o.created_at
  from public.air_offers o
  left join public.companies c on c.id = o.forwarder_company_id
  where o.request_id = p_request_id and o.status <> 'Withdrawn'
  order by o.amount asc, o.created_at asc;
end; $$;
grant execute on function public.air_list_offers(uuid) to authenticated;
