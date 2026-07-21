-- =========================================================================
-- 0162 — Ocean Booking Board (worldwide container shipping)
-- Idempotent & additive. Safe to run multiple times.
--
-- Bid model (bid_plus_ai): a customer posts a sea-freight request onto a
-- live board. Member Freight Forwarders see the open board and submit
-- competing OFFERS (price, transit time, sailing date, note). The customer
-- compares offers and ACCEPTS one; the winning forwarder is booked, all
-- other offers are auto-rejected, and a shared chat opens between the
-- customer and the winning forwarder for docs & coordination.
-- =========================================================================

-- ─── 1) Freight forwarder company helper ─────────────────────────────────────
create or replace function public.forwarder_company_for(p_user_id uuid default null)
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
    and c.type::text = 'FreightForwarder'
  limit 1;
$$;
grant execute on function public.forwarder_company_for(uuid) to authenticated;

-- ─── 2) Ocean requests ───────────────────────────────────────────────────────
create table if not exists public.ocean_requests (
  id uuid primary key default gen_random_uuid(),
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  awarded_company_id uuid references public.companies(id) on delete set null,
  awarded_offer_id uuid,
  title text not null,
  origin_country text not null default '',
  origin_port text not null default '',
  dest_country text not null default '',
  dest_port text not null default '',
  container_size text not null default '40ft'
    check (container_size in ('20ft','40ft','40ft HC','LCL')),
  cargo_type text not null default '',
  weight numeric not null default 0,
  weight_unit text not null default 'kg' check (weight_unit in ('kg','lb')),
  ready_date date,
  incoterms text not null default '',
  currency text not null default 'CAD',
  notes text not null default '',
  status text not null default 'Open'
    check (status in ('Open','Booked','InTransit','Completed','Cancelled')),
  awarded_amount numeric not null default 0,
  booked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ocean_req_customer on public.ocean_requests(customer_company_id);
create index if not exists idx_ocean_req_awarded  on public.ocean_requests(awarded_company_id);
create index if not exists idx_ocean_req_status   on public.ocean_requests(status);

-- ─── 3) Ocean offers (one row per forwarder bid) ─────────────────────────────
create table if not exists public.ocean_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ocean_requests(id) on delete cascade,
  forwarder_company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  amount numeric not null default 0,
  currency text not null default 'CAD',
  transit_days int not null default 0,
  sailing_date date,
  note text not null default '',
  status text not null default 'Pending'
    check (status in ('Pending','Accepted','Rejected','Withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, forwarder_company_id)
);
create index if not exists idx_ocean_off_request on public.ocean_offers(request_id);
create index if not exists idx_ocean_off_fwd     on public.ocean_offers(forwarder_company_id);

-- ─── 4) Ocean messages (customer ↔ winning forwarder) ────────────────────────
create table if not exists public.ocean_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ocean_requests(id) on delete cascade,
  sender_user_id uuid references public.profiles(id) on delete set null,
  sender_name text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ocean_msg_request on public.ocean_messages(request_id, created_at);

-- ─── 5) Party helper ──────────────────────────────────────────────────────────
-- True when caller is the customer side, the awarded forwarder, or admin.
create or replace function public.is_ocean_party(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ocean_requests r
    where r.id = p_request_id
      and (
        public.is_member_of(r.customer_company_id)
        or (r.awarded_company_id is not null and public.is_member_of(r.awarded_company_id))
        or public.is_admin()
      )
  );
$$;
grant execute on function public.is_ocean_party(uuid) to authenticated;

-- ─── 6) RLS ───────────────────────────────────────────────────────────────────
alter table public.ocean_requests enable row level security;

drop policy if exists "ocean_req_read" on public.ocean_requests;
create policy "ocean_req_read" on public.ocean_requests for select using (
  public.is_member_of(customer_company_id)
  or (awarded_company_id is not null and public.is_member_of(awarded_company_id))
  -- Open board: every forwarder company sees open requests.
  or (status = 'Open' and public.forwarder_company_for() is not null)
  -- A forwarder that has offered can see the request while it's live.
  or exists (
    select 1 from public.ocean_offers o
    where o.request_id = ocean_requests.id
      and public.is_member_of(o.forwarder_company_id)
  )
  or public.is_admin()
);

drop policy if exists "ocean_req_insert" on public.ocean_requests;
create policy "ocean_req_insert" on public.ocean_requests for insert with check (
  created_by = auth.uid() and public.is_member_of(customer_company_id)
);

drop policy if exists "ocean_req_update" on public.ocean_requests;
create policy "ocean_req_update" on public.ocean_requests for update
  using (public.is_ocean_party(id))
  with check (public.is_ocean_party(id));

alter table public.ocean_offers enable row level security;

drop policy if exists "ocean_off_read" on public.ocean_offers;
create policy "ocean_off_read" on public.ocean_offers for select using (
  public.is_member_of(forwarder_company_id)
  or exists (
    select 1 from public.ocean_requests r
    where r.id = ocean_offers.request_id
      and (public.is_member_of(r.customer_company_id) or public.is_admin())
  )
);

drop policy if exists "ocean_off_write" on public.ocean_offers;
create policy "ocean_off_write" on public.ocean_offers for all
  using (public.is_member_of(forwarder_company_id) or public.is_admin())
  with check (public.is_member_of(forwarder_company_id) or public.is_admin());

alter table public.ocean_messages enable row level security;

drop policy if exists "ocean_msg_read" on public.ocean_messages;
create policy "ocean_msg_read" on public.ocean_messages for select using (
  public.is_ocean_party(request_id)
);

-- ─── 7) Customer posts an ocean request ───────────────────────────────────────
create or replace function public.ocean_create_request(
  p_title text,
  p_origin_country text default '',
  p_origin_port text default '',
  p_dest_country text default '',
  p_dest_port text default '',
  p_container_size text default '40ft',
  p_cargo_type text default '',
  p_weight numeric default 0,
  p_weight_unit text default 'kg',
  p_ready_date date default null,
  p_incoterms text default '',
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
    raise exception 'You need a company account to post an ocean request' using errcode='42501';
  end if;
  if coalesce(trim(p_title),'') = '' then
    raise exception 'A short title for the shipment is required';
  end if;

  insert into public.ocean_requests (
    customer_company_id, created_by, title,
    origin_country, origin_port, dest_country, dest_port,
    container_size, cargo_type, weight, weight_unit, ready_date,
    incoterms, currency, notes
  ) values (
    v_company, auth.uid(), trim(p_title),
    coalesce(trim(p_origin_country),''), coalesce(trim(p_origin_port),''),
    coalesce(trim(p_dest_country),''), coalesce(trim(p_dest_port),''),
    case when p_container_size in ('20ft','40ft','40ft HC','LCL') then p_container_size else '40ft' end,
    coalesce(trim(p_cargo_type),''), coalesce(p_weight,0),
    case when p_weight_unit in ('kg','lb') then p_weight_unit else 'kg' end,
    p_ready_date, coalesce(trim(p_incoterms),''),
    coalesce(nullif(trim(p_currency),''),'CAD'), coalesce(p_notes,'')
  ) returning id into v_id;

  select name into v_company_name from public.companies where id = v_company;

  -- Notify all active freight forwarder teams about the new open request.
  perform public.queue_notification(
    cu.user_id, 'system', 'New ocean freight request',
    coalesce(v_company_name,'A company') || ' posted: ' || trim(p_title),
    'ocean_requests', v_id::text, jsonb_build_object('request_id', v_id)
  )
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where c.type::text = 'FreightForwarder' and cu.status = 'Active';

  perform public.write_audit('ocean.request_created','ocean_requests', v_id::text, null,
    jsonb_build_object('title', trim(p_title)), null, v_company);
  return v_id;
end;
$$;
grant execute on function public.ocean_create_request(text, text, text, text, text, text, text, numeric, text, date, text, text, text) to authenticated;

-- ─── 8) Forwarder submits / updates an offer ─────────────────────────────────
create or replace function public.ocean_submit_offer(
  p_request_id uuid,
  p_amount numeric,
  p_currency text default 'CAD',
  p_transit_days int default 0,
  p_sailing_date date default null,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fwd uuid;
  v_req public.ocean_requests;
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
  select * into v_req from public.ocean_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_req.status <> 'Open' then
    raise exception 'This request is no longer open (status: %)', v_req.status;
  end if;

  insert into public.ocean_offers (
    request_id, forwarder_company_id, created_by, amount, currency,
    transit_days, sailing_date, note, status
  ) values (
    p_request_id, v_fwd, auth.uid(), round(p_amount,2),
    coalesce(nullif(trim(p_currency),''),'CAD'),
    greatest(coalesce(p_transit_days,0),0), p_sailing_date, coalesce(p_note,''), 'Pending'
  )
  on conflict (request_id, forwarder_company_id) do update
    set amount = round(p_amount,2),
        currency = coalesce(nullif(trim(p_currency),''),'CAD'),
        transit_days = greatest(coalesce(p_transit_days,0),0),
        sailing_date = p_sailing_date,
        note = coalesce(p_note,''),
        status = 'Pending',
        updated_at = now()
  returning id into v_id;

  select name into v_fwd_name from public.companies where id = v_fwd;
  perform public.queue_notification(
    cu.user_id, 'system', 'New ocean freight offer',
    coalesce(v_fwd_name,'A forwarder') || ' offered ' || round(p_amount,2)::text
      || ' ' || coalesce(nullif(trim(p_currency),''),'CAD') || ' for: ' || v_req.title,
    'ocean_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id, 'offer_id', v_id)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';

  return v_id;
end;
$$;
grant execute on function public.ocean_submit_offer(uuid, numeric, text, int, date, text) to authenticated;

-- ─── 9) Forwarder withdraws an offer ──────────────────────────────────────────
create or replace function public.ocean_withdraw_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fwd uuid;
  v_off public.ocean_offers;
begin
  v_fwd := public.forwarder_company_for();
  select * into v_off from public.ocean_offers where id = p_offer_id for update;
  if v_off is null then raise exception 'Offer not found' using errcode='P0002'; end if;
  if v_fwd is null or v_off.forwarder_company_id <> v_fwd then
    raise exception 'Only the offering forwarder can withdraw this' using errcode='42501';
  end if;
  if v_off.status = 'Accepted' then
    raise exception 'An accepted offer cannot be withdrawn';
  end if;
  update public.ocean_offers set status = 'Withdrawn', updated_at = now() where id = p_offer_id;
end;
$$;
grant execute on function public.ocean_withdraw_offer(uuid) to authenticated;

-- ─── 10) Customer accepts an offer → books the forwarder ─────────────────────
create or replace function public.ocean_accept_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_off public.ocean_offers;
  v_req public.ocean_requests;
  v_cust_name text;
begin
  select * into v_off from public.ocean_offers where id = p_offer_id for update;
  if v_off is null then raise exception 'Offer not found' using errcode='P0002'; end if;
  select * into v_req from public.ocean_requests where id = v_off.request_id for update;
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

  update public.ocean_offers set status = 'Accepted', updated_at = now() where id = p_offer_id;
  update public.ocean_offers
     set status = 'Rejected', updated_at = now()
   where request_id = v_req.id and id <> p_offer_id and status = 'Pending';

  update public.ocean_requests
     set status = 'Booked',
         awarded_company_id = v_off.forwarder_company_id,
         awarded_offer_id = p_offer_id,
         awarded_amount = v_off.amount,
         booked_at = now(),
         updated_at = now()
   where id = v_req.id;

  select name into v_cust_name from public.companies where id = v_req.customer_company_id;
  perform public.queue_notification(
    cu.user_id, 'system', 'Your ocean offer was accepted',
    coalesce(v_cust_name,'The customer') || ' booked your offer for: ' || v_req.title,
    'ocean_requests', v_req.id::text, jsonb_build_object('request_id', v_req.id)
  )
  from public.company_users cu
  where cu.company_id = v_off.forwarder_company_id and cu.status = 'Active';

  perform public.write_audit('ocean.offer_accepted','ocean_requests', v_req.id::text, null,
    jsonb_build_object('offer_id', p_offer_id, 'amount', v_off.amount), null, v_req.customer_company_id);
end;
$$;
grant execute on function public.ocean_accept_offer(uuid) to authenticated;

-- ─── 11) Status transitions (forwarder marks in-transit / completed) ─────────
create or replace function public.ocean_set_status(p_request_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.ocean_requests;
begin
  select * into v_req from public.ocean_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_ocean_party(p_request_id) then
    raise exception 'You are not part of this shipment' using errcode='42501';
  end if;
  if p_status not in ('InTransit','Completed') then
    raise exception 'Status must be InTransit or Completed';
  end if;
  if v_req.status not in ('Booked','InTransit') then
    raise exception 'Cannot change status from %', v_req.status;
  end if;

  update public.ocean_requests
     set status = p_status,
         completed_at = case when p_status = 'Completed' then now() else completed_at end,
         updated_at = now()
   where id = p_request_id;

  perform public.queue_notification(
    cu.user_id, 'system', 'Ocean shipment update',
    v_req.title || ' is now ' || p_status,
    'ocean_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id, 'status', p_status)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';
end;
$$;
grant execute on function public.ocean_set_status(uuid, text) to authenticated;

-- ─── 12) Customer cancels an open request ─────────────────────────────────────
create or replace function public.ocean_cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.ocean_requests;
begin
  select * into v_req from public.ocean_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_req.customer_company_id) then
    raise exception 'Only the requesting company can cancel' using errcode='42501';
  end if;
  if v_req.status not in ('Open','Booked') then
    raise exception 'This request cannot be cancelled (status: %)', v_req.status;
  end if;

  update public.ocean_requests set status = 'Cancelled', updated_at = now() where id = p_request_id;
  update public.ocean_offers set status = 'Rejected', updated_at = now()
   where request_id = p_request_id and status = 'Pending';

  if v_req.awarded_company_id is not null then
    perform public.queue_notification(
      cu.user_id, 'system', 'Ocean shipment cancelled',
      'The customer cancelled: ' || v_req.title,
      'ocean_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.awarded_company_id and cu.status = 'Active';
  end if;
end;
$$;
grant execute on function public.ocean_cancel_request(uuid) to authenticated;

-- ─── 13) On-platform messaging ────────────────────────────────────────────────
create or replace function public.ocean_send_message(p_request_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.ocean_requests;
  v_id uuid;
  v_name text;
  v_is_customer boolean;
begin
  select * into v_req from public.ocean_requests where id = p_request_id;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_ocean_party(p_request_id) then
    raise exception 'You are not part of this shipment' using errcode='42501';
  end if;
  if coalesce(trim(p_body),'') = '' then
    raise exception 'Message cannot be empty';
  end if;

  select name into v_name from public.profiles where id = auth.uid();
  insert into public.ocean_messages (request_id, sender_user_id, sender_name, body)
  values (p_request_id, auth.uid(), coalesce(v_name,''), trim(p_body))
  returning id into v_id;

  v_is_customer := public.is_member_of(v_req.customer_company_id);
  if v_is_customer and v_req.awarded_company_id is not null then
    perform public.queue_notification(
      cu.user_id, 'system', 'New ocean freight message',
      coalesce(v_name,'The customer') || ': ' || left(trim(p_body), 120),
      'ocean_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.awarded_company_id and cu.status = 'Active';
  elsif not v_is_customer then
    perform public.queue_notification(
      cu.user_id, 'system', 'New ocean freight message',
      coalesce(v_name,'Your forwarder') || ': ' || left(trim(p_body), 120),
      'ocean_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.customer_company_id and cu.status = 'Active';
  end if;

  return v_id;
end;
$$;
grant execute on function public.ocean_send_message(uuid, text) to authenticated;

-- ─── 14) Read RPCs ────────────────────────────────────────────────────────────
-- Customer's own requests.
create or replace function public.ocean_list_mine()
returns table (
  id uuid, title text, origin_country text, origin_port text,
  dest_country text, dest_port text, container_size text, cargo_type text,
  weight numeric, weight_unit text, ready_date date, incoterms text,
  currency text, notes text, status text, awarded_amount numeric,
  awarded_name text, offer_count bigint, created_at timestamptz
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
  select r.id, r.title, r.origin_country, r.origin_port,
         r.dest_country, r.dest_port, r.container_size, r.cargo_type,
         r.weight, r.weight_unit, r.ready_date, r.incoterms,
         r.currency, r.notes, r.status, r.awarded_amount,
         coalesce(a.name,''),
         (select count(*) from public.ocean_offers o where o.request_id = r.id and o.status = 'Pending'),
         r.created_at
  from public.ocean_requests r
  left join public.companies a on a.id = r.awarded_company_id
  where r.customer_company_id = v_company
  order by r.created_at desc;
end; $$;
grant execute on function public.ocean_list_mine() to authenticated;

-- Forwarder board: 'open' = open requests, 'mine' = requests I've offered on or won.
create or replace function public.ocean_forwarder_board(p_scope text default 'open')
returns table (
  id uuid, title text, origin_country text, origin_port text,
  dest_country text, dest_port text, container_size text, cargo_type text,
  weight numeric, weight_unit text, ready_date date, incoterms text,
  currency text, notes text, status text, customer_name text,
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
    select r.id, r.title, r.origin_country, r.origin_port,
           r.dest_country, r.dest_port, r.container_size, r.cargo_type,
           r.weight, r.weight_unit, r.ready_date, r.incoterms,
           r.currency, r.notes, r.status, coalesce(c.name,'Company'),
           o.amount, o.status, r.awarded_amount, r.created_at
    from public.ocean_offers o
    join public.ocean_requests r on r.id = o.request_id
    left join public.companies c on c.id = r.customer_company_id
    where o.forwarder_company_id = v_fwd
    order by r.created_at desc;
  else
    return query
    select r.id, r.title, r.origin_country, r.origin_port,
           r.dest_country, r.dest_port, r.container_size, r.cargo_type,
           r.weight, r.weight_unit, r.ready_date, r.incoterms,
           r.currency, r.notes, r.status, coalesce(c.name,'Company'),
           o.amount, o.status, r.awarded_amount, r.created_at
    from public.ocean_requests r
    left join public.companies c on c.id = r.customer_company_id
    left join public.ocean_offers o
      on o.request_id = r.id and o.forwarder_company_id = v_fwd
    where r.status = 'Open'
    order by r.created_at desc;
  end if;
end; $$;
grant execute on function public.ocean_forwarder_board(text) to authenticated;

-- Offers on a specific request (visible to the customer who owns it).
create or replace function public.ocean_list_offers(p_request_id uuid)
returns table (
  id uuid, forwarder_name text, amount numeric, currency text,
  transit_days int, sailing_date date, note text, status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_ocean_party(p_request_id) or exists (
    select 1 from public.ocean_offers o
    where o.request_id = p_request_id and public.is_member_of(o.forwarder_company_id)
  )) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query
  select o.id, coalesce(c.name,'Forwarder'), o.amount, o.currency,
         o.transit_days, o.sailing_date, o.note, o.status, o.created_at
  from public.ocean_offers o
  left join public.companies c on c.id = o.forwarder_company_id
  where o.request_id = p_request_id and o.status <> 'Withdrawn'
  order by o.amount asc, o.created_at asc;
end; $$;
grant execute on function public.ocean_list_offers(uuid) to authenticated;
