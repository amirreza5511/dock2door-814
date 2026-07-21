-- 0167 — Allow the consumer Ship & Return flow to work for individuals.
--
-- The parcel functions previously required an Active company membership, so any
-- signed-in person WITHOUT a company hit "Company account required". The
-- consumer parcel flow must work for anyone, tying ownership to the user
-- (created_by) when they have no company.

-- 1. Company is now optional; personal parcels have a null company.
alter table public.parcel_shipments
  alter column customer_company_id drop not null;

-- 2. parcel_create — fall back to personal ownership when no company.
create or replace function public.parcel_create(
  p_from_name text, p_from_line1 text, p_from_city text, p_from_region text,
  p_from_postal text, p_from_country text,
  p_to_name text, p_to_line1 text, p_to_city text, p_to_region text,
  p_to_postal text, p_to_country text,
  p_length numeric, p_width numeric, p_height numeric, p_dim_unit text,
  p_weight numeric, p_weight_unit text,
  p_service text default 'regular', p_currency text default 'CAD', p_notes text default ''
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_id uuid;
  v_tracking text;
  v_quote record;
  v_dim text := case when p_dim_unit = 'in' then 'in' else 'cm' end;
  v_wu text := case when p_weight_unit = 'lb' then 'lb' else 'kg' end;
  v_svc text := case when p_service in ('regular','expedited','xpresspost','priority') then p_service else 'regular' end;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in to create a parcel' using errcode='42501';
  end if;

  select cu.company_id into v_company
  from public.company_users cu
  where cu.user_id = auth.uid() and cu.status = 'Active'
  limit 1;
  -- v_company may be null for individuals — that's fine now.

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
$function$;

-- 3. parcel_list_mine — company parcels for members, plus personal ones.
create or replace function public.parcel_list_mine()
  returns setof parcel_shipments
  language plpgsql
  stable security definer
  set search_path to 'public'
as $function$
declare v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode='42501';
  end if;

  select cu.company_id into v_company
  from public.company_users cu
  where cu.user_id = auth.uid() and cu.status = 'Active'
  limit 1;

  return query
  select * from public.parcel_shipments p
  where p.created_by = auth.uid()
     or (v_company is not null and p.customer_company_id = v_company)
  order by p.created_at desc;
end;
$function$;

-- 4. parcel_get — allow the creator, company members, or admins.
create or replace function public.parcel_get(p_id uuid)
  returns setof parcel_shipments
  language plpgsql
  stable security definer
  set search_path to 'public'
as $function$
begin
  return query
  select * from public.parcel_shipments p
  where p.id = p_id
    and (
      p.created_by = auth.uid()
      or (p.customer_company_id is not null and public.is_member_of(p.customer_company_id))
      or public.is_admin()
    );
end;
$function$;

grant execute on function public.parcel_list_mine() to authenticated;
grant execute on function public.parcel_get(uuid) to authenticated;
