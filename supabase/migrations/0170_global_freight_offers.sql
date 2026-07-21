-- =========================================================================
-- 0170 — Global Freight: provider quote board + offers.
-- Idempotent & additive. Safe to run multiple times.
--
-- Approved requests ('Open'/'Quoted') appear on a provider board. Freight
-- providers (forwarders + carriers) submit 'freight' offers; trucking/drayage
-- companies submit a separate 'ground' offer on requests that need container
-- pickup. The submit RPC auto-detects the caller's provider kind.
-- =========================================================================

-- ─── 1) Provider board ──────────────────────────────────────────────────────
create or replace function public.freight_provider_board(p_scope text default 'open')
returns table (
  id uuid, reference_code text, title text, freight_mode text,
  origin_country text, origin_city text, origin_port text,
  dest_country text, dest_city text, dest_port text,
  weight numeric, weight_unit text, volume numeric, pieces int,
  commodity text, declared_value numeric, currency text,
  delivery_method text, needs_container_pickup boolean,
  status text, customer_name text, doc_count bigint,
  my_offer_amount numeric, my_offer_currency text, my_offer_status text,
  offer_kind text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_freight uuid;
  v_ground uuid;
  v_company uuid;
  v_kind text;
begin
  v_freight := public.freight_quote_provider_for();
  v_ground := public.freight_ground_provider_for();
  if v_freight is not null then
    v_company := v_freight; v_kind := 'freight';
  elsif v_ground is not null then
    v_company := v_ground; v_kind := 'ground';
  else
    raise exception 'Only freight or ground providers can view this board' using errcode='42501';
  end if;

  if p_scope = 'mine' then
    return query
    select q.id, q.reference_code, q.title, q.freight_mode,
           q.origin_country, q.origin_city, q.origin_port,
           q.dest_country, q.dest_city, q.dest_port,
           q.weight, q.weight_unit, q.volume, q.pieces,
           q.commodity, q.declared_value, q.currency,
           q.delivery_method, q.needs_container_pickup,
           q.status, coalesce(c.name,'Company'),
           (select count(*) from public.freight_quote_documents d where d.quote_id = q.id),
           o.amount, o.currency, o.status, v_kind, q.created_at
    from public.freight_quote_offers o
    join public.freight_quotes q on q.id = o.quote_id
    left join public.companies c on c.id = q.customer_company_id
    where o.provider_company_id = v_company and o.offer_kind = v_kind
    order by q.created_at desc;
  else
    return query
    select q.id, q.reference_code, q.title, q.freight_mode,
           q.origin_country, q.origin_city, q.origin_port,
           q.dest_country, q.dest_city, q.dest_port,
           q.weight, q.weight_unit, q.volume, q.pieces,
           q.commodity, q.declared_value, q.currency,
           q.delivery_method, q.needs_container_pickup,
           q.status, coalesce(c.name,'Company'),
           (select count(*) from public.freight_quote_documents d where d.quote_id = q.id),
           o.amount, o.currency, o.status, v_kind, q.created_at
    from public.freight_quotes q
    left join public.companies c on c.id = q.customer_company_id
    left join public.freight_quote_offers o
      on o.quote_id = q.id and o.provider_company_id = v_company and o.offer_kind = v_kind
    where q.status in ('PendingReview','Open','Quoted')
      and (v_kind = 'freight' or q.needs_container_pickup = true)
    order by
      case when q.status = 'PendingReview' then 1 else 0 end,
      q.created_at desc;
  end if;
end;
$$;
grant execute on function public.freight_provider_board(text) to authenticated;

-- ─── 2) Submit / update an offer (auto-detects freight vs ground) ────────────
create or replace function public.freight_submit_offer(
  p_quote_id uuid,
  p_amount numeric,
  p_currency text default 'USD',
  p_transit_days int default 0,
  p_valid_until date default null,
  p_note text default ''
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_freight uuid;
  v_ground uuid;
  v_company uuid;
  v_kind text;
  v_q public.freight_quotes;
  v_id uuid;
  v_name text;
begin
  v_freight := public.freight_quote_provider_for();
  v_ground := public.freight_ground_provider_for();
  if v_freight is not null then
    v_company := v_freight; v_kind := 'freight';
  elsif v_ground is not null then
    v_company := v_ground; v_kind := 'ground';
  else
    raise exception 'Only freight or ground providers can submit offers' using errcode='42501';
  end if;

  if coalesce(p_amount,0) <= 0 then
    raise exception 'Offer amount must be greater than zero';
  end if;

  select * into v_q from public.freight_quotes where id = p_quote_id for update;
  if v_q is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_q.status = 'PendingReview' then
    raise exception 'This request is awaiting admin approval and cannot be quoted yet';
  end if;
  if v_q.status not in ('Open','Quoted') then
    raise exception 'This request is no longer open for quotes (status: %)', v_q.status;
  end if;
  if v_kind = 'ground' and not v_q.needs_container_pickup then
    raise exception 'This request does not need container pickup';
  end if;

  insert into public.freight_quote_offers (
    quote_id, provider_company_id, created_by, offer_kind, amount, currency,
    transit_days, valid_until, note, status
  ) values (
    p_quote_id, v_company, auth.uid(), v_kind, round(p_amount,2),
    coalesce(nullif(trim(p_currency),''),'USD'),
    greatest(coalesce(p_transit_days,0),0), p_valid_until, coalesce(p_note,''), 'Pending'
  )
  on conflict (quote_id, provider_company_id, offer_kind) do update
    set amount = round(p_amount,2),
        currency = coalesce(nullif(trim(p_currency),''),'USD'),
        transit_days = greatest(coalesce(p_transit_days,0),0),
        valid_until = p_valid_until,
        note = coalesce(p_note,''),
        status = 'Pending',
        updated_at = now()
  returning id into v_id;

  -- Move the request to 'Quoted' once the first offer lands.
  if v_q.status = 'Open' then
    update public.freight_quotes set status = 'Quoted', updated_at = now() where id = p_quote_id;
  end if;

  select name into v_name from public.companies where id = v_company;
  perform public.queue_notification(
    cu.user_id, 'system',
    case when v_kind = 'ground' then 'New container pickup quote' else 'New freight quote' end,
    coalesce(v_name,'A provider') || ' quoted ' || round(p_amount,2)::text
      || ' ' || coalesce(nullif(trim(p_currency),''),'USD') || ' for: ' || v_q.title,
    'freight_quotes', p_quote_id::text, jsonb_build_object('quote_id', p_quote_id, 'offer_id', v_id, 'kind', v_kind)
  )
  from public.company_users cu
  where cu.company_id = v_q.customer_company_id and cu.status = 'Active';

  return v_id;
end;
$$;
grant execute on function public.freight_submit_offer(uuid, numeric, text, int, date, text) to authenticated;

-- ─── 3) Withdraw an offer ───────────────────────────────────────────────────
create or replace function public.freight_withdraw_offer(p_offer_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_off public.freight_quote_offers;
begin
  select * into v_off from public.freight_quote_offers where id = p_offer_id for update;
  if v_off is null then raise exception 'Offer not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_off.provider_company_id) then
    raise exception 'Only the offering company can withdraw this' using errcode='42501';
  end if;
  if v_off.status = 'Accepted' then
    raise exception 'An accepted offer cannot be withdrawn';
  end if;
  update public.freight_quote_offers set status = 'Withdrawn', updated_at = now() where id = p_offer_id;
end;
$$;
grant execute on function public.freight_withdraw_offer(uuid) to authenticated;

-- ─── 4) List offers on a request (customer/party + eligible providers) ───────
create or replace function public.freight_list_offers(p_quote_id uuid)
returns table (
  id uuid, provider_name text, offer_kind text, amount numeric, currency text,
  transit_days int, valid_until date, note text, status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (
    public.is_freight_party(p_quote_id)
    or exists (
      select 1 from public.freight_quote_offers o
      where o.quote_id = p_quote_id and public.is_member_of(o.provider_company_id)
    )
  ) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query
  select o.id, coalesce(c.name,'Provider'), o.offer_kind, o.amount, o.currency,
         o.transit_days, o.valid_until, o.note, o.status, o.created_at
  from public.freight_quote_offers o
  left join public.companies c on c.id = o.provider_company_id
  where o.quote_id = p_quote_id and o.status <> 'Withdrawn'
  order by o.offer_kind asc, o.amount asc, o.created_at asc;
end;
$$;
grant execute on function public.freight_list_offers(uuid) to authenticated;

notify pgrst, 'reload schema';
