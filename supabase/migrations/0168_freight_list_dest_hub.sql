-- 0168 — expose destination-hub columns in freight_list_mine so the
-- "My requests" list can show the chosen Canadian city hub.
-- freight_get_quote already returns `select *`, so the detail screen has them.

create or replace function public.freight_list_mine()
  returns table(
    id uuid, reference_code text, title text, freight_mode text,
    origin_country text, origin_city text, origin_port text,
    dest_country text, dest_city text, dest_port text,
    weight numeric, weight_unit text, volume numeric, volume_unit text, pieces integer,
    commodity text, declared_value numeric, currency text,
    delivery_method text, needs_container_pickup boolean,
    status text, rejected_reason text,
    awarded_amount numeric, awarded_name text,
    ground_awarded_amount numeric, ground_awarded_name text,
    offer_count bigint, ground_offer_count bigint, doc_count bigint,
    created_at timestamp with time zone,
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
  select q.id, q.reference_code, q.title, q.freight_mode,
         q.origin_country, q.origin_city, q.origin_port,
         q.dest_country, q.dest_city, q.dest_port,
         q.weight, q.weight_unit, q.volume, q.volume_unit, q.pieces,
         q.commodity, q.declared_value, q.currency,
         q.delivery_method, q.needs_container_pickup,
         q.status, q.rejected_reason,
         q.awarded_amount, coalesce(a.name,''),
         q.ground_awarded_amount, coalesce(g.name,''),
         (select count(*) from public.freight_quote_offers o where o.quote_id = q.id and o.offer_kind = 'freight' and o.status in ('Pending','Accepted')),
         (select count(*) from public.freight_quote_offers o where o.quote_id = q.id and o.offer_kind = 'ground' and o.status in ('Pending','Accepted')),
         (select count(*) from public.freight_quote_documents d where d.quote_id = q.id),
         q.created_at,
         coalesce(q.dest_hub_id,''), coalesce(q.dest_hub_city,''), coalesce(q.dest_hub_is_member,false)
  from public.freight_quotes q
  left join public.companies a on a.id = q.awarded_company_id
  left join public.companies g on g.id = q.ground_awarded_company_id
  where q.customer_company_id = v_company
  order by q.created_at desc;
end;
$function$;

grant execute on function public.freight_list_mine() to authenticated;
