-- Dock2Door — World 4: Drayage quotes (bidding) + direct company targeting
-- Idempotent. Adds:
--   1) target_drayage_company_id on drayage_orders (customer can direct an order
--      to ONE specific drayage company — option 3)
--   2) drayage_quotes table + RLS (companies bid a price on open orders — option 2)
--   3) create_drayage_order overload accepting a target company
--   4) submit / accept / withdraw quote RPCs
--   5) RLS update so a targeted Open order is only visible to its target company

-- =========================================================================
-- 1) TARGET COMPANY on drayage_orders
-- =========================================================================
alter table public.drayage_orders
  add column if not exists target_drayage_company_id uuid references public.companies(id) on delete set null;
create index if not exists idx_drayage_orders_target on public.drayage_orders(target_drayage_company_id);

-- =========================================================================
-- 2) QUOTE STATUS ENUM + QUOTES TABLE
-- =========================================================================
do $$ begin
  create type drayage_quote_status as enum ('Pending', 'Accepted', 'Declined', 'Withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.drayage_quotes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.drayage_orders(id) on delete cascade,
  drayage_company_id uuid not null references public.companies(id) on delete cascade,
  quoted_by_user_id uuid not null references public.profiles(id) on delete cascade,
  status drayage_quote_status not null default 'Pending',
  price numeric not null default 0,
  currency text not null default 'CAD',
  eta_note text not null default '',       -- e.g. "Pickup tomorrow AM, deliver same day"
  message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one active quote per company per order
  unique (order_id, drayage_company_id)
);
create index if not exists idx_drayage_quotes_order on public.drayage_quotes(order_id);
create index if not exists idx_drayage_quotes_company on public.drayage_quotes(drayage_company_id);
create index if not exists idx_drayage_quotes_status on public.drayage_quotes(status);

alter table public.drayage_quotes enable row level security;

-- Customer of the order sees all quotes on their order; the bidding company sees
-- their own; admin sees all.
drop policy if exists "drayage_quotes_read" on public.drayage_quotes;
create policy "drayage_quotes_read" on public.drayage_quotes for select using (
  public.is_admin()
  or (drayage_company_id is not null and public.is_member_of(drayage_company_id))
  or exists (
    select 1 from public.drayage_orders o
    where o.id = drayage_quotes.order_id
    and (
      (o.customer_company_id is not null and public.is_member_of(o.customer_company_id))
      or o.customer_user_id = auth.uid()
    )
  )
);
drop policy if exists "drayage_quotes_admin" on public.drayage_quotes;
create policy "drayage_quotes_admin" on public.drayage_quotes for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- 3) RLS UPDATE — targeted Open orders only visible to the target company
-- =========================================================================
drop policy if exists "drayage_orders_read" on public.drayage_orders;
create policy "drayage_orders_read" on public.drayage_orders for select using (
  public.is_admin()
  or (customer_company_id is not null and public.is_member_of(customer_company_id))
  or (customer_user_id = auth.uid())
  or (drayage_company_id is not null and public.is_member_of(drayage_company_id))
  or (warehouse_company_id is not null and public.is_member_of(warehouse_company_id))
  -- open orders: untargeted are visible to any drayage company; targeted only to
  -- the invited company
  or (status = 'Open' and target_drayage_company_id is null)
  or (status = 'Open' and target_drayage_company_id is not null and public.is_member_of(target_drayage_company_id))
);

-- =========================================================================
-- 4) create_drayage_order overload — accepts an optional target company
-- =========================================================================
create or replace function public.create_drayage_order(
  p_direction drayage_direction,
  p_container_number text,
  p_container_size container_size,
  p_container_type text,
  p_bol_number text,
  p_booking_number text,
  p_commodity text,
  p_weight_kg numeric,
  p_is_hazmat boolean,
  p_is_overweight boolean,
  p_is_oversized boolean,
  p_origin_terminal_id uuid,
  p_destination_terminal_id uuid,
  p_warehouse_company_id uuid,
  p_pickup_address text,
  p_pickup_city text,
  p_pickup_lat numeric,
  p_pickup_lng numeric,
  p_delivery_address text,
  p_delivery_city text,
  p_delivery_lat numeric,
  p_delivery_lng numeric,
  p_port_reservation_date date,
  p_port_reservation_time text,
  p_is_prepull boolean,
  p_prepull_pickup_date date,
  p_prepull_yard_terminal_id uuid,
  p_notes text,
  p_target_drayage_company_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_company uuid;
  v_ref text;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select company_id into v_company from public.profiles where id = auth.uid();

  v_ref := 'DRY-' || to_char(now(), 'YYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.drayage_orders (
    reference_code, direction, status,
    customer_user_id, customer_company_id,
    container_number, container_size, container_type,
    bol_number, booking_number, commodity, weight_kg,
    is_hazmat, is_overweight, is_oversized,
    origin_terminal_id, destination_terminal_id, warehouse_company_id,
    pickup_address, pickup_city, pickup_lat, pickup_lng,
    delivery_address, delivery_city, delivery_lat, delivery_lng,
    port_reservation_date, port_reservation_time,
    is_prepull, prepull_pickup_date, prepull_yard_terminal_id,
    notes, target_drayage_company_id
  ) values (
    v_ref, p_direction, 'Open',
    auth.uid(), v_company,
    coalesce(p_container_number,''), coalesce(p_container_size,'40ft'), coalesce(p_container_type,''),
    coalesce(p_bol_number,''), coalesce(p_booking_number,''), coalesce(p_commodity,''), greatest(coalesce(p_weight_kg,0),0),
    coalesce(p_is_hazmat,false), coalesce(p_is_overweight,false), coalesce(p_is_oversized,false),
    p_origin_terminal_id, p_destination_terminal_id, p_warehouse_company_id,
    coalesce(p_pickup_address,''), coalesce(p_pickup_city,''), greatest(coalesce(p_pickup_lat,0),0), greatest(coalesce(p_pickup_lng,0),0),
    coalesce(p_delivery_address,''), coalesce(p_delivery_city,''), greatest(coalesce(p_delivery_lat,0),0), greatest(coalesce(p_delivery_lng,0),0),
    p_port_reservation_date, coalesce(p_port_reservation_time,''),
    coalesce(p_is_prepull,false), p_prepull_pickup_date, p_prepull_yard_terminal_id,
    coalesce(p_notes,''), p_target_drayage_company_id
  ) returning id into v_id;

  -- Notify the targeted drayage company (all its members) that they were invited.
  if p_target_drayage_company_id is not null then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    select cu.user_id, 'system', 'New drayage invitation',
      'You were invited to quote on order ' || v_ref,
      'drayage_orders', v_id
    from public.company_users cu
    where cu.company_id = p_target_drayage_company_id and cu.status = 'Active';
  end if;

  perform public.write_audit('drayage_order.created', 'drayage_orders', v_id::text, null,
    jsonb_build_object('ref', v_ref, 'direction', p_direction, 'container', p_container_number,
      'target', p_target_drayage_company_id), '');
  return v_id;
end;
$$;
grant execute on function public.create_drayage_order(
  drayage_direction, text, container_size, text, text, text, text, numeric,
  boolean, boolean, boolean, uuid, uuid, uuid, text, text, numeric, numeric,
  text, text, numeric, numeric, date, text, boolean, date, uuid, text, uuid
) to authenticated;

-- =========================================================================
-- 5) SUBMIT / UPDATE A QUOTE (drayage company bids on an open order)
-- =========================================================================
create or replace function public.submit_drayage_quote(
  p_order_id uuid,
  p_price numeric,
  p_currency text,
  p_eta_note text,
  p_message text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_order public.drayage_orders;
  v_company uuid;
  v_quote_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id;
  if v_order is null then raise exception 'order not found'; end if;
  if v_order.status <> 'Open' then raise exception 'order is no longer open for quotes'; end if;

  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then raise exception 'no company associated with your account'; end if;

  -- If the order was targeted to a specific company, only that company may quote.
  if v_order.target_drayage_company_id is not null and v_order.target_drayage_company_id <> v_company then
    raise exception 'this order is reserved for another drayage company' using errcode = '42501';
  end if;

  insert into public.drayage_quotes (order_id, drayage_company_id, quoted_by_user_id, status, price, currency, eta_note, message)
  values (p_order_id, v_company, auth.uid(), 'Pending', greatest(coalesce(p_price,0),0), coalesce(p_currency,'CAD'), coalesce(p_eta_note,''), coalesce(p_message,''))
  on conflict (order_id, drayage_company_id) do update
    set price = greatest(coalesce(p_price,0),0),
        currency = coalesce(p_currency,'CAD'),
        eta_note = coalesce(p_eta_note,''),
        message = coalesce(p_message,''),
        status = 'Pending',
        quoted_by_user_id = auth.uid(),
        updated_at = now()
  returning id into v_quote_id;

  -- Notify the customer of the new/updated bid.
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_order.customer_user_id, 'system', 'New quote received',
    'A drayage company quoted ' || coalesce(p_currency,'CAD') || ' ' || round(greatest(coalesce(p_price,0),0))::text || ' on order ' || v_order.reference_code,
    'drayage_orders', p_order_id);

  perform public.write_audit('drayage_quote.submitted', 'drayage_quotes', v_quote_id::text, null,
    jsonb_build_object('order', p_order_id, 'price', p_price), '');
  return v_quote_id;
end;
$$;
grant execute on function public.submit_drayage_quote(uuid, numeric, text, text, text) to authenticated;

-- =========================================================================
-- 6) ACCEPT A QUOTE (customer picks a winner -> assigns that company)
-- =========================================================================
create or replace function public.accept_drayage_quote(p_quote_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_quote public.drayage_quotes;
  v_order public.drayage_orders;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_quote from public.drayage_quotes where id = p_quote_id for update;
  if v_quote is null then raise exception 'quote not found'; end if;

  select * into v_order from public.drayage_orders where id = v_quote.order_id for update;
  if v_order is null then raise exception 'order not found'; end if;

  -- Only the customer who placed the order (or admin) can accept a quote.
  if not (
    v_order.customer_user_id = auth.uid()
    or (v_order.customer_company_id is not null and public.is_member_of(v_order.customer_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the ordering customer can accept a quote' using errcode = '42501';
  end if;
  if v_order.status <> 'Open' then raise exception 'order is no longer open'; end if;

  -- Assign the winning company + lock in the quoted price.
  update public.drayage_orders
    set status = 'Assigned',
        drayage_company_id = v_quote.drayage_company_id,
        quoted_price = v_quote.price,
        total_price = v_quote.price,
        currency = v_quote.currency,
        assigned_at = now(),
        updated_at = now()
    where id = v_order.id;

  -- Winning quote -> Accepted; all others on this order -> Declined.
  update public.drayage_quotes set status = 'Accepted', updated_at = now() where id = p_quote_id;
  update public.drayage_quotes set status = 'Declined', updated_at = now()
    where order_id = v_order.id and id <> p_quote_id and status = 'Pending';

  -- Notify the winning company's members.
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  select cu.user_id, 'system', 'Quote accepted',
    'Your quote on order ' || v_order.reference_code || ' was accepted. Dispatch a driver.',
    'drayage_orders', v_order.id
  from public.company_users cu
  where cu.company_id = v_quote.drayage_company_id and cu.status = 'Active';

  perform public.write_audit('drayage_quote.accepted', 'drayage_quotes', p_quote_id::text, null,
    jsonb_build_object('order', v_order.id, 'company', v_quote.drayage_company_id, 'price', v_quote.price), '');
end;
$$;
grant execute on function public.accept_drayage_quote(uuid) to authenticated;

-- =========================================================================
-- 7) WITHDRAW A QUOTE (drayage company pulls their bid)
-- =========================================================================
create or replace function public.withdraw_drayage_quote(p_quote_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_quote public.drayage_quotes;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_quote from public.drayage_quotes where id = p_quote_id for update;
  if v_quote is null then raise exception 'quote not found'; end if;

  if not (public.is_member_of(v_quote.drayage_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_quote.status <> 'Pending' then raise exception 'only pending quotes can be withdrawn'; end if;

  update public.drayage_quotes set status = 'Withdrawn', updated_at = now() where id = p_quote_id;

  perform public.write_audit('drayage_quote.withdrawn', 'drayage_quotes', p_quote_id::text, null, '{}'::jsonb, '');
end;
$$;
grant execute on function public.withdraw_drayage_quote(uuid) to authenticated;
