-- =========================================================================
-- 0168 — Global Freight: quote-request wizard RPCs + document storage.
-- Idempotent & additive. Safe to run multiple times.
--
-- Adds the create/read RPCs used by the step wizard, plus a dedicated
-- 'freight-docs' storage bucket and document-attach RPCs. Every new request is
-- created as 'PendingReview' and admins are notified to approve it.
-- =========================================================================

-- ─── 1) Storage bucket for freight documents ────────────────────────────────
insert into storage.buckets (id, name, public)
values ('freight-docs', 'freight-docs', true)
on conflict (id) do nothing;

-- Authenticated users can upload; anyone can read (public bucket for simplicity,
-- like job-photos). Row visibility of the document *records* is enforced by RLS.
drop policy if exists "freight_docs_upload" on storage.objects;
create policy "freight_docs_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'freight-docs');

drop policy if exists "freight_docs_read" on storage.objects;
create policy "freight_docs_read" on storage.objects for select
  using (bucket_id = 'freight-docs');

-- ─── 2) Create a freight quote request (wizard submit) ──────────────────────
create or replace function public.freight_create_quote(
  p_title text,
  p_origin_country text default '',
  p_origin_city text default '',
  p_origin_port text default '',
  p_dest_country text default '',
  p_dest_city text default '',
  p_dest_port text default '',
  p_freight_mode text default 'ocean',
  p_weight numeric default 0,
  p_weight_unit text default 'kg',
  p_volume numeric default 0,
  p_volume_unit text default 'cbm',
  p_length numeric default 0,
  p_width numeric default 0,
  p_height numeric default 0,
  p_dim_unit text default 'cm',
  p_pieces int default 1,
  p_commodity text default '',
  p_declared_value numeric default 0,
  p_currency text default 'USD',
  p_hs_code text default '',
  p_notes text default '',
  p_ready_date date default null,
  p_delivery_method text default 'port_delivery',
  p_pickup_address text default '',
  p_pickup_city text default '',
  p_needs_container_pickup boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
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
    raise exception 'You need a company account to post a freight request' using errcode='42501';
  end if;
  if coalesce(trim(p_title),'') = '' then
    raise exception 'A short title for the shipment is required';
  end if;

  insert into public.freight_quotes (
    customer_company_id, created_by, title,
    origin_country, origin_city, origin_port,
    dest_country, dest_city, dest_port,
    freight_mode, weight, weight_unit, volume, volume_unit,
    length_val, width_val, height_val, dim_unit, pieces,
    commodity, declared_value, currency, hs_code, notes, ready_date,
    delivery_method, pickup_address, pickup_city, needs_container_pickup,
    status
  ) values (
    v_company, auth.uid(), trim(p_title),
    coalesce(trim(p_origin_country),''), coalesce(trim(p_origin_city),''), coalesce(trim(p_origin_port),''),
    coalesce(trim(p_dest_country),''), coalesce(trim(p_dest_city),''), coalesce(trim(p_dest_port),''),
    case when p_freight_mode in ('air','ocean','truck','fcl','lcl') then p_freight_mode else 'ocean' end,
    coalesce(p_weight,0),
    case when p_weight_unit in ('kg','lb') then p_weight_unit else 'kg' end,
    coalesce(p_volume,0),
    case when p_volume_unit in ('cbm','cft') then p_volume_unit else 'cbm' end,
    coalesce(p_length,0), coalesce(p_width,0), coalesce(p_height,0),
    case when p_dim_unit in ('cm','in') then p_dim_unit else 'cm' end,
    greatest(coalesce(p_pieces,1),1),
    coalesce(trim(p_commodity),''), coalesce(p_declared_value,0),
    coalesce(nullif(trim(p_currency),''),'USD'), coalesce(trim(p_hs_code),''),
    coalesce(p_notes,''), p_ready_date,
    case when p_delivery_method in ('door_pickup','port_delivery','booking_only') then p_delivery_method else 'port_delivery' end,
    coalesce(trim(p_pickup_address),''), coalesce(trim(p_pickup_city),''),
    coalesce(p_needs_container_pickup,false),
    'PendingReview'
  ) returning id into v_id;

  select name into v_company_name from public.companies where id = v_company;

  -- Notify admins to review & approve the new request.
  perform public.queue_notification(
    p.id, 'system', 'New freight quote to review',
    coalesce(v_company_name,'A company') || ' posted: ' || trim(p_title),
    'freight_quotes', v_id::text, jsonb_build_object('quote_id', v_id)
  )
  from public.profiles p
  where p.role in ('Admin','SuperAdmin');

  perform public.write_audit('freight.quote_created','freight_quotes', v_id::text, null,
    jsonb_build_object('title', trim(p_title), 'mode', p_freight_mode), null, v_company);
  return v_id;
end;
$$;
grant execute on function public.freight_create_quote(
  text, text, text, text, text, text, text, text, numeric, text, numeric, text,
  numeric, numeric, numeric, text, int, text, numeric, text, text, text, date,
  text, text, text, boolean
) to authenticated;

-- ─── 3) Attach a document to a request ──────────────────────────────────────
create or replace function public.freight_add_document(
  p_quote_id uuid,
  p_file_path text,
  p_file_name text default '',
  p_doc_type text default 'other'
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_q public.freight_quotes;
  v_id uuid;
begin
  select * into v_q from public.freight_quotes where id = p_quote_id;
  if v_q is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_q.customer_company_id) then
    raise exception 'Only the requesting company can attach documents' using errcode='42501';
  end if;
  if coalesce(trim(p_file_path),'') = '' then
    raise exception 'A file path is required';
  end if;

  insert into public.freight_quote_documents (quote_id, uploaded_by, file_path, file_name, doc_type)
  values (p_quote_id, auth.uid(), trim(p_file_path), coalesce(trim(p_file_name),''),
          case when p_doc_type in ('commercial_invoice','packing_list','bill_of_lading','certificate','other')
               then p_doc_type else 'other' end)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.freight_add_document(uuid, text, text, text) to authenticated;

-- ─── 4) List a request's documents (party or eligible provider) ─────────────
create or replace function public.freight_list_documents(p_quote_id uuid)
returns table (id uuid, file_path text, file_name text, doc_type text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (
    public.is_freight_party(p_quote_id)
    or public.freight_quote_provider_for() is not null
    or public.freight_ground_provider_for() is not null
  ) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query
  select d.id, d.file_path, d.file_name, d.doc_type, d.created_at
  from public.freight_quote_documents d
  where d.quote_id = p_quote_id
  order by d.created_at asc;
end;
$$;
grant execute on function public.freight_list_documents(uuid) to authenticated;

-- ─── 5) Customer's own requests ─────────────────────────────────────────────
create or replace function public.freight_list_mine()
returns table (
  id uuid, reference_code text, title text, freight_mode text,
  origin_country text, origin_city text, origin_port text,
  dest_country text, dest_city text, dest_port text,
  weight numeric, weight_unit text, volume numeric, volume_unit text, pieces int,
  commodity text, declared_value numeric, currency text,
  delivery_method text, needs_container_pickup boolean,
  status text, rejected_reason text,
  awarded_amount numeric, awarded_name text,
  ground_awarded_amount numeric, ground_awarded_name text,
  offer_count bigint, ground_offer_count bigint, doc_count bigint,
  created_at timestamptz
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
         q.created_at
  from public.freight_quotes q
  left join public.companies a on a.id = q.awarded_company_id
  left join public.companies g on g.id = q.ground_awarded_company_id
  where q.customer_company_id = v_company
  order by q.created_at desc;
end;
$$;
grant execute on function public.freight_list_mine() to authenticated;

-- ─── 6) Single request detail (party or eligible provider) ──────────────────
create or replace function public.freight_get_quote(p_quote_id uuid)
returns setof public.freight_quotes
language plpgsql stable security definer set search_path = public as $$
begin
  if not (
    public.is_freight_party(p_quote_id)
    or public.freight_quote_provider_for() is not null
    or public.freight_ground_provider_for() is not null
  ) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query select * from public.freight_quotes where id = p_quote_id;
end;
$$;
grant execute on function public.freight_get_quote(uuid) to authenticated;

notify pgrst, 'reload schema';
