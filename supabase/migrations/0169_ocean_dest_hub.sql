-- 0169 — add Canadian destination-hub selection to the ocean booking flow,
-- mirroring the unified freight flow (0166/0168).

alter table public.ocean_requests
  add column if not exists dest_hub_id text not null default '',
  add column if not exists dest_hub_city text not null default '',
  add column if not exists dest_hub_is_member boolean not null default false;

-- ocean_create_request — accept the three hub params.
create or replace function public.ocean_create_request(
  p_title text,
  p_origin_country text default '', p_origin_port text default '',
  p_dest_country text default '', p_dest_port text default '',
  p_container_size text default '40ft', p_cargo_type text default '',
  p_weight numeric default 0, p_weight_unit text default 'kg',
  p_ready_date date default null, p_incoterms text default '',
  p_currency text default 'CAD', p_notes text default '',
  p_dest_hub_id text default '', p_dest_hub_city text default '',
  p_dest_hub_is_member boolean default false
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
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
    incoterms, currency, notes,
    dest_hub_id, dest_hub_city, dest_hub_is_member
  ) values (
    v_company, auth.uid(), trim(p_title),
    coalesce(trim(p_origin_country),''), coalesce(trim(p_origin_port),''),
    coalesce(trim(p_dest_country),''), coalesce(trim(p_dest_port),''),
    case when p_container_size in ('20ft','40ft','40ft HC','LCL') then p_container_size else '40ft' end,
    coalesce(trim(p_cargo_type),''), coalesce(p_weight,0),
    case when p_weight_unit in ('kg','lb') then p_weight_unit else 'kg' end,
    p_ready_date, coalesce(trim(p_incoterms),''),
    coalesce(nullif(trim(p_currency),''),'CAD'), coalesce(p_notes,''),
    coalesce(trim(p_dest_hub_id),''), coalesce(trim(p_dest_hub_city),''), coalesce(p_dest_hub_is_member,false)
  ) returning id into v_id;

  select name into v_company_name from public.companies where id = v_company;

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
$function$;

-- ocean_list_mine — expose the hub columns.
drop function if exists public.ocean_list_mine();
create function public.ocean_list_mine()
  returns table(
    id uuid, title text, origin_country text, origin_port text,
    dest_country text, dest_port text, container_size text, cargo_type text,
    weight numeric, weight_unit text, ready_date date, incoterms text,
    currency text, notes text, status text, awarded_amount numeric, awarded_name text,
    offer_count bigint, created_at timestamp with time zone,
    dest_hub_id text, dest_hub_city text, dest_hub_is_member boolean
  )
  language plpgsql
  stable security definer
  set search_path to 'public'
as $function$
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
         r.created_at,
         coalesce(r.dest_hub_id,''), coalesce(r.dest_hub_city,''), coalesce(r.dest_hub_is_member,false)
  from public.ocean_requests r
  left join public.companies a on a.id = r.awarded_company_id
  where r.customer_company_id = v_company
  order by r.created_at desc;
end; $function$;

grant execute on function public.ocean_list_mine() to authenticated;
