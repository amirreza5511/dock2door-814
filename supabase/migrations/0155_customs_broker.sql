-- =========================================================================
-- 0155 — Customs Brokers (Domain 4 — Container Drayage world)
-- Idempotent & additive. Safe to run multiple times.
--
-- Customs broker companies join the drayage world as a first-class role:
--   • Own profile + team (companies/company_users — reused as-is)
--   • Importers/exporters (FreightForwarder, DrayageCompany, Customer,
--     Shipper companies) submit CLEARANCE REQUESTS with shipment details
--   • Brokers see the open pool, claim a request, quote a brokerage fee
--   • Brokers request documents; customers upload them through the platform
--   • In-request messaging keeps all communication on Dock2Door
--   • On clearance, an invoice is issued (customer → broker) and the
--     platform keeps a brokerage commission % from the broker's fee
-- =========================================================================

-- ─── 1) Enums ────────────────────────────────────────────────────────────────
do $$ begin alter type user_role    add value if not exists 'CustomsBroker'; exception when others then null; end $$;
do $$ begin alter type company_type add value if not exists 'CustomsBroker'; exception when others then null; end $$;

-- ─── 2) Platform setting: brokerage commission ───────────────────────────────
-- % of the broker's clearance fee the platform keeps.
alter table public.platform_settings
  add column if not exists brokerage_commission_pct numeric not null default 10;

-- ─── 3) Storage bucket for clearance documents ───────────────────────────────
insert into storage.buckets (id, name, public)
values ('clearance-docs', 'clearance-docs', false)
on conflict (id) do update set public = false;

-- ─── 4) Clearance requests ────────────────────────────────────────────────────
create table if not exists public.clearance_requests (
  id uuid primary key default gen_random_uuid(),
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  broker_company_id uuid references public.companies(id) on delete set null,
  title text not null,
  mode text not null default 'Import' check (mode in ('Import','Export')),
  container_no text not null default '',
  bl_number text not null default '',
  port_of_entry text not null default '',
  eta date,
  cargo_description text not null default '',
  commercial_value numeric not null default 0,
  currency text not null default 'CAD',
  incoterms text not null default '',
  notes text not null default '',
  status text not null default 'Submitted'
    check (status in ('Submitted','Quoted','InProgress','DocsRequired','Cleared','Rejected','Cancelled')),
  quote_amount numeric not null default 0,
  quote_note text not null default '',
  quoted_at timestamptz,
  accepted_at timestamptz,
  entry_number text not null default '',
  cleared_at timestamptz,
  reject_reason text not null default '',
  platform_fee numeric not null default 0,
  invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_clr_customer on public.clearance_requests(customer_company_id);
create index if not exists idx_clr_broker   on public.clearance_requests(broker_company_id);
create index if not exists idx_clr_status   on public.clearance_requests(status);

-- ─── 5) Clearance documents ───────────────────────────────────────────────────
-- A broker inserts a row with status 'Requested' (no file yet); the customer
-- uploads and the row becomes 'Uploaded'; the broker then accepts/rejects it.
-- Customers can also proactively attach documents.
create table if not exists public.clearance_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.clearance_requests(id) on delete cascade,
  uploader_user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  doc_type text not null default 'Other',
  file_path text not null default '',
  status text not null default 'Uploaded' check (status in ('Requested','Uploaded','Accepted','Rejected')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cld_request on public.clearance_documents(request_id);

-- ─── 6) Clearance messages (customer ↔ broker, on-platform) ──────────────────
create table if not exists public.clearance_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.clearance_requests(id) on delete cascade,
  sender_user_id uuid references public.profiles(id) on delete set null,
  sender_name text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_clm_request on public.clearance_messages(request_id, created_at);

-- ─── 7) Helpers ───────────────────────────────────────────────────────────────
create or replace function public.broker_company_for(p_user_id uuid default null)
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
    and c.type::text = 'CustomsBroker'
  limit 1;
$$;
grant execute on function public.broker_company_for(uuid) to authenticated;

-- True when the caller is a party (customer side, assigned broker, or admin).
create or replace function public.is_clearance_party(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clearance_requests cr
    where cr.id = p_request_id
      and (
        public.is_member_of(cr.customer_company_id)
        or (cr.broker_company_id is not null and public.is_member_of(cr.broker_company_id))
        or public.is_admin()
      )
  );
$$;
grant execute on function public.is_clearance_party(uuid) to authenticated;

-- ─── 8) RLS ───────────────────────────────────────────────────────────────────
alter table public.clearance_requests enable row level security;

drop policy if exists "clr_read" on public.clearance_requests;
create policy "clr_read" on public.clearance_requests for select using (
  public.is_member_of(customer_company_id)
  or (broker_company_id is not null and public.is_member_of(broker_company_id))
  -- Open pool: every broker company sees unclaimed submitted requests.
  or (broker_company_id is null and status = 'Submitted' and public.broker_company_for() is not null)
  or public.is_admin()
);

drop policy if exists "clr_insert" on public.clearance_requests;
create policy "clr_insert" on public.clearance_requests for insert with check (
  created_by = auth.uid() and public.is_member_of(customer_company_id)
);

drop policy if exists "clr_update" on public.clearance_requests;
create policy "clr_update" on public.clearance_requests for update
  using (public.is_clearance_party(id))
  with check (public.is_clearance_party(id));

alter table public.clearance_documents enable row level security;

drop policy if exists "cld_read" on public.clearance_documents;
create policy "cld_read" on public.clearance_documents for select using (
  public.is_clearance_party(request_id)
);

drop policy if exists "cld_write" on public.clearance_documents;
create policy "cld_write" on public.clearance_documents for all
  using (public.is_clearance_party(request_id))
  with check (public.is_clearance_party(request_id));

alter table public.clearance_messages enable row level security;

drop policy if exists "clm_read" on public.clearance_messages;
create policy "clm_read" on public.clearance_messages for select using (
  public.is_clearance_party(request_id)
);

-- Storage policies: first path segment of every object is the request id.
drop policy if exists "clearance_docs_insert" on storage.objects;
create policy "clearance_docs_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'clearance-docs'
  and public.is_clearance_party(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "clearance_docs_select" on storage.objects;
create policy "clearance_docs_select" on storage.objects for select to authenticated
using (
  bucket_id = 'clearance-docs'
  and public.is_clearance_party(((storage.foldername(name))[1])::uuid)
);

-- ─── 9) Customer creates a clearance request ─────────────────────────────────
create or replace function public.clearance_create_request(
  p_title text,
  p_mode text default 'Import',
  p_container_no text default '',
  p_bl_number text default '',
  p_port text default '',
  p_eta date default null,
  p_cargo_description text default '',
  p_commercial_value numeric default 0,
  p_currency text default 'CAD',
  p_incoterms text default '',
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
    raise exception 'You need a company account to request customs clearance' using errcode='42501';
  end if;
  if coalesce(trim(p_title),'') = '' then
    raise exception 'A short title for the shipment is required';
  end if;

  insert into public.clearance_requests (
    customer_company_id, created_by, title, mode, container_no, bl_number,
    port_of_entry, eta, cargo_description, commercial_value, currency, incoterms, notes
  ) values (
    v_company, auth.uid(), trim(p_title),
    case when p_mode in ('Import','Export') then p_mode else 'Import' end,
    coalesce(trim(p_container_no),''), coalesce(trim(p_bl_number),''),
    coalesce(trim(p_port),''), p_eta, coalesce(p_cargo_description,''),
    coalesce(p_commercial_value, 0), coalesce(nullif(trim(p_currency),''), 'CAD'),
    coalesce(trim(p_incoterms),''), coalesce(p_notes,'')
  ) returning id into v_id;

  select name into v_company_name from public.companies where id = v_company;

  -- Notify all active customs broker teams about the new open request.
  perform public.queue_notification(
    cu.user_id, 'system', 'New customs clearance request',
    coalesce(v_company_name,'A company') || ' submitted: ' || trim(p_title),
    'clearance_requests', v_id::text, jsonb_build_object('request_id', v_id)
  )
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where c.type::text = 'CustomsBroker' and cu.status = 'Active';

  perform public.write_audit('clearance.request_created','clearance_requests', v_id::text, null,
    jsonb_build_object('title', trim(p_title), 'mode', p_mode), null, v_company);
  return v_id;
end;
$$;
grant execute on function public.clearance_create_request(text, text, text, text, text, date, text, numeric, text, text, text) to authenticated;

-- ─── 10) Broker claims an open request ────────────────────────────────────────
create or replace function public.broker_claim_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker uuid;
  v_req public.clearance_requests;
  v_broker_name text;
begin
  v_broker := public.broker_company_for();
  if v_broker is null then
    raise exception 'Only customs broker members can claim requests' using errcode='42501';
  end if;
  select * into v_req from public.clearance_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_req.broker_company_id is not null and v_req.broker_company_id <> v_broker then
    raise exception 'Another broker already claimed this request';
  end if;
  if v_req.status not in ('Submitted') and v_req.broker_company_id is null then
    raise exception 'This request is no longer open (status: %)', v_req.status;
  end if;

  update public.clearance_requests
     set broker_company_id = v_broker, updated_at = now()
   where id = p_request_id;

  select name into v_broker_name from public.companies where id = v_broker;
  perform public.queue_notification(
    cu.user_id, 'system', 'A customs broker took your request',
    coalesce(v_broker_name,'A customs broker') || ' is now handling: ' || v_req.title,
    'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';

  perform public.write_audit('clearance.claimed','clearance_requests', p_request_id::text, null,
    jsonb_build_object('broker_company_id', v_broker), null, v_req.customer_company_id);
end;
$$;
grant execute on function public.broker_claim_request(uuid) to authenticated;

-- ─── 11) Broker quotes a brokerage fee ────────────────────────────────────────
create or replace function public.broker_quote(
  p_request_id uuid,
  p_amount numeric,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker uuid;
  v_req public.clearance_requests;
  v_broker_name text;
begin
  v_broker := public.broker_company_for();
  if v_broker is null then
    raise exception 'Only customs broker members can quote' using errcode='42501';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Quote amount must be greater than zero';
  end if;
  select * into v_req from public.clearance_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_req.broker_company_id is null then
    -- Quoting implicitly claims an open request.
    if v_req.status <> 'Submitted' then
      raise exception 'This request is no longer open (status: %)', v_req.status;
    end if;
  elsif v_req.broker_company_id <> v_broker then
    raise exception 'Another broker is handling this request' using errcode='42501';
  end if;
  if v_req.status in ('Cleared','Rejected','Cancelled') then
    raise exception 'This request is closed (status: %)', v_req.status;
  end if;

  update public.clearance_requests
     set broker_company_id = v_broker,
         quote_amount = round(p_amount, 2),
         quote_note = coalesce(p_note,''),
         quoted_at = now(),
         status = case when status in ('Submitted','Quoted') then 'Quoted' else status end,
         updated_at = now()
   where id = p_request_id;

  select name into v_broker_name from public.companies where id = v_broker;
  perform public.queue_notification(
    cu.user_id, 'system', 'Clearance quote received',
    coalesce(v_broker_name,'Your customs broker') || ' quoted $' || round(p_amount,2)::text || ' for: ' || v_req.title,
    'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id, 'amount', round(p_amount,2))
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';

  perform public.write_audit('clearance.quoted','clearance_requests', p_request_id::text, null,
    jsonb_build_object('amount', round(p_amount,2)), null, v_req.customer_company_id);
end;
$$;
grant execute on function public.broker_quote(uuid, numeric, text) to authenticated;

-- ─── 12) Customer accepts the quote ──────────────────────────────────────────
create or replace function public.clearance_accept_quote(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.clearance_requests;
begin
  select * into v_req from public.clearance_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_req.customer_company_id) then
    raise exception 'Only the requesting company can accept a quote' using errcode='42501';
  end if;
  if v_req.status <> 'Quoted' then
    raise exception 'There is no pending quote to accept (status: %)', v_req.status;
  end if;

  update public.clearance_requests
     set status = 'InProgress', accepted_at = now(), updated_at = now()
   where id = p_request_id;

  perform public.queue_notification(
    cu.user_id, 'system', 'Quote accepted — clearance in progress',
    'The customer accepted your $' || v_req.quote_amount::text || ' quote for: ' || v_req.title,
    'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
  )
  from public.company_users cu
  where cu.company_id = v_req.broker_company_id and cu.status = 'Active';

  perform public.write_audit('clearance.quote_accepted','clearance_requests', p_request_id::text, null,
    jsonb_build_object('amount', v_req.quote_amount), null, v_req.customer_company_id);
end;
$$;
grant execute on function public.clearance_accept_quote(uuid) to authenticated;

-- ─── 13) Broker requests a document ──────────────────────────────────────────
create or replace function public.broker_request_document(
  p_request_id uuid,
  p_name text,
  p_doc_type text default 'Other',
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker uuid;
  v_req public.clearance_requests;
  v_id uuid;
begin
  v_broker := public.broker_company_for();
  select * into v_req from public.clearance_requests where id = p_request_id;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_broker is null or v_req.broker_company_id is distinct from v_broker then
    raise exception 'Only the assigned broker can request documents' using errcode='42501';
  end if;
  if v_req.status in ('Cleared','Rejected','Cancelled') then
    raise exception 'This request is closed (status: %)', v_req.status;
  end if;
  if coalesce(trim(p_name),'') = '' then
    raise exception 'Document name is required';
  end if;

  insert into public.clearance_documents (request_id, uploader_user_id, name, doc_type, status, note)
  values (p_request_id, auth.uid(), trim(p_name), coalesce(nullif(trim(p_doc_type),''),'Other'), 'Requested', coalesce(p_note,''))
  returning id into v_id;

  update public.clearance_requests
     set status = case when status in ('InProgress','DocsRequired') then 'DocsRequired' else status end,
         updated_at = now()
   where id = p_request_id;

  perform public.queue_notification(
    cu.user_id, 'system', 'Document needed for customs clearance',
    'Your broker needs: ' || trim(p_name) || ' — for ' || v_req.title,
    'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id, 'document_id', v_id)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';

  return v_id;
end;
$$;
grant execute on function public.broker_request_document(uuid, text, text, text) to authenticated;

-- ─── 14) Customer submits a document (fulfils a request or adds a new one) ───
create or replace function public.clearance_submit_document(
  p_request_id uuid,
  p_file_path text,
  p_name text,
  p_doc_type text default 'Other',
  p_document_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.clearance_requests;
  v_id uuid;
  v_remaining int;
begin
  select * into v_req from public.clearance_requests where id = p_request_id;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_req.customer_company_id) then
    raise exception 'Only the requesting company can upload documents' using errcode='42501';
  end if;
  if v_req.status in ('Cleared','Rejected','Cancelled') then
    raise exception 'This request is closed (status: %)', v_req.status;
  end if;
  if coalesce(trim(p_file_path),'') = '' then
    raise exception 'File path is required';
  end if;

  if p_document_id is not null then
    update public.clearance_documents
       set file_path = trim(p_file_path), status = 'Uploaded',
           uploader_user_id = auth.uid(), updated_at = now()
     where id = p_document_id and request_id = p_request_id
    returning id into v_id;
    if v_id is null then raise exception 'Document slot not found' using errcode='P0002'; end if;
  else
    insert into public.clearance_documents (request_id, uploader_user_id, name, doc_type, file_path, status)
    values (p_request_id, auth.uid(), coalesce(nullif(trim(p_name),''),'Document'),
            coalesce(nullif(trim(p_doc_type),''),'Other'), trim(p_file_path), 'Uploaded')
    returning id into v_id;
  end if;

  -- All requested docs in? Move DocsRequired back to InProgress.
  select count(*) into v_remaining
  from public.clearance_documents
  where request_id = p_request_id and status = 'Requested';
  if v_remaining = 0 then
    update public.clearance_requests
       set status = case when status = 'DocsRequired' then 'InProgress' else status end,
           updated_at = now()
     where id = p_request_id;
  end if;

  if v_req.broker_company_id is not null then
    perform public.queue_notification(
      cu.user_id, 'system', 'Clearance document uploaded',
      'A document was uploaded for: ' || v_req.title,
      'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id, 'document_id', v_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.broker_company_id and cu.status = 'Active';
  end if;

  return v_id;
end;
$$;
grant execute on function public.clearance_submit_document(uuid, text, text, text, uuid) to authenticated;

-- ─── 15) Broker reviews an uploaded document ──────────────────────────────────
create or replace function public.broker_set_document_status(
  p_document_id uuid,
  p_status text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker uuid;
  v_doc public.clearance_documents;
  v_req public.clearance_requests;
begin
  v_broker := public.broker_company_for();
  select * into v_doc from public.clearance_documents where id = p_document_id;
  if v_doc is null then raise exception 'Document not found' using errcode='P0002'; end if;
  select * into v_req from public.clearance_requests where id = v_doc.request_id;
  if v_broker is null or v_req.broker_company_id is distinct from v_broker then
    raise exception 'Only the assigned broker can review documents' using errcode='42501';
  end if;
  if p_status not in ('Accepted','Rejected') then
    raise exception 'Status must be Accepted or Rejected';
  end if;

  update public.clearance_documents
     set status = p_status,
         note = case when coalesce(trim(p_note),'') <> '' then p_note else note end,
         updated_at = now()
   where id = p_document_id;

  if p_status = 'Rejected' then
    -- A rejected doc needs a replacement — flag the request.
    update public.clearance_requests
       set status = case when status in ('InProgress','DocsRequired') then 'DocsRequired' else status end,
           updated_at = now()
     where id = v_doc.request_id;
  end if;

  perform public.queue_notification(
    cu.user_id, 'system',
    case when p_status = 'Accepted' then 'Document accepted' else 'Document needs a fix' end,
    v_doc.name || ' — ' || case when p_status = 'Accepted' then 'accepted by your broker.' else 'was rejected: ' || coalesce(nullif(trim(p_note),''),'please re-upload.') end,
    'clearance_requests', v_doc.request_id::text, jsonb_build_object('request_id', v_doc.request_id, 'document_id', p_document_id)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';
end;
$$;
grant execute on function public.broker_set_document_status(uuid, text, text) to authenticated;

-- ─── 16) Broker marks the shipment cleared → invoice ─────────────────────────
create or replace function public.broker_mark_cleared(
  p_request_id uuid,
  p_entry_number text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker uuid;
  v_req public.clearance_requests;
  v_pct numeric := 0;
  v_fee numeric := 0;
  v_invoice uuid;
  v_number text;
  v_broker_name text;
begin
  v_broker := public.broker_company_for();
  select * into v_req from public.clearance_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_broker is null or v_req.broker_company_id is distinct from v_broker then
    raise exception 'Only the assigned broker can mark this cleared' using errcode='42501';
  end if;
  if v_req.status not in ('InProgress','DocsRequired','Quoted') then
    raise exception 'This request cannot be cleared from status %', v_req.status;
  end if;
  if v_req.quote_amount <= 0 then
    raise exception 'Set your brokerage fee (quote) before marking cleared';
  end if;

  select coalesce(brokerage_commission_pct, 0) into v_pct from public.platform_settings limit 1;
  v_fee := round(v_req.quote_amount * (v_pct / 100.0), 2);

  v_number := 'INV-CLR-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_req.customer_company_id, v_broker,
    v_number, v_req.quote_amount, 0, v_req.quote_amount,
    coalesce(nullif(v_req.currency,''),'CAD'), 'Issued', current_date + 14, now()
  ) returning id into v_invoice;

  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (v_invoice, 'Customs clearance — ' || v_req.title
            || case when coalesce(trim(p_entry_number),'') <> '' then ' (entry ' || trim(p_entry_number) || ')' else '' end,
          1, v_req.quote_amount, v_req.quote_amount, 0);

  update public.clearance_requests
     set status = 'Cleared',
         cleared_at = now(),
         entry_number = coalesce(trim(p_entry_number),''),
         platform_fee = v_fee,
         invoice_id = v_invoice,
         updated_at = now()
   where id = p_request_id;

  select name into v_broker_name from public.companies where id = v_broker;
  perform public.queue_notification(
    cu.user_id, 'system', 'Shipment cleared customs',
    coalesce(v_broker_name,'Your customs broker') || ' cleared: ' || v_req.title
      || case when coalesce(trim(p_entry_number),'') <> '' then ' — entry ' || trim(p_entry_number) else '' end,
    'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id, 'invoice_id', v_invoice)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';

  perform public.write_audit('clearance.cleared','clearance_requests', p_request_id::text, null,
    jsonb_build_object('invoice_id', v_invoice, 'fee', v_req.quote_amount, 'platform_fee', v_fee),
    null, v_req.customer_company_id);
  return v_invoice;
end;
$$;
grant execute on function public.broker_mark_cleared(uuid, text) to authenticated;

-- ─── 17) Broker rejects / customer cancels ────────────────────────────────────
create or replace function public.broker_reject_request(p_request_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker uuid;
  v_req public.clearance_requests;
begin
  v_broker := public.broker_company_for();
  select * into v_req from public.clearance_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_broker is null or v_req.broker_company_id is distinct from v_broker then
    raise exception 'Only the assigned broker can reject this request' using errcode='42501';
  end if;
  if v_req.status in ('Cleared','Rejected','Cancelled') then
    raise exception 'This request is already closed (status: %)', v_req.status;
  end if;

  update public.clearance_requests
     set status = 'Rejected', reject_reason = coalesce(p_reason,''), updated_at = now()
   where id = p_request_id;

  perform public.queue_notification(
    cu.user_id, 'system', 'Clearance request declined',
    'Your broker declined: ' || v_req.title
      || case when coalesce(trim(p_reason),'') <> '' then ' — ' || trim(p_reason) else '' end,
    'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';
end;
$$;
grant execute on function public.broker_reject_request(uuid, text) to authenticated;

create or replace function public.clearance_cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.clearance_requests;
begin
  select * into v_req from public.clearance_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_req.customer_company_id) then
    raise exception 'Only the requesting company can cancel' using errcode='42501';
  end if;
  if v_req.status in ('Cleared','Rejected','Cancelled') then
    raise exception 'This request is already closed (status: %)', v_req.status;
  end if;

  update public.clearance_requests
     set status = 'Cancelled', updated_at = now()
   where id = p_request_id;

  if v_req.broker_company_id is not null then
    perform public.queue_notification(
      cu.user_id, 'system', 'Clearance request cancelled',
      'The customer cancelled: ' || v_req.title,
      'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.broker_company_id and cu.status = 'Active';
  end if;
end;
$$;
grant execute on function public.clearance_cancel_request(uuid) to authenticated;

-- ─── 18) On-platform messaging ────────────────────────────────────────────────
create or replace function public.clearance_send_message(p_request_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.clearance_requests;
  v_id uuid;
  v_name text;
  v_is_customer boolean;
begin
  select * into v_req from public.clearance_requests where id = p_request_id;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_clearance_party(p_request_id) then
    raise exception 'You are not part of this clearance request' using errcode='42501';
  end if;
  if coalesce(trim(p_body),'') = '' then
    raise exception 'Message cannot be empty';
  end if;

  select name into v_name from public.profiles where id = auth.uid();
  insert into public.clearance_messages (request_id, sender_user_id, sender_name, body)
  values (p_request_id, auth.uid(), coalesce(v_name,''), trim(p_body))
  returning id into v_id;

  v_is_customer := public.is_member_of(v_req.customer_company_id);

  -- Notify the other side.
  if v_is_customer and v_req.broker_company_id is not null then
    perform public.queue_notification(
      cu.user_id, 'system', 'New clearance message',
      coalesce(v_name,'The customer') || ': ' || left(trim(p_body), 120),
      'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.broker_company_id and cu.status = 'Active';
  elsif not v_is_customer then
    perform public.queue_notification(
      cu.user_id, 'system', 'New clearance message',
      coalesce(v_name,'Your broker') || ': ' || left(trim(p_body), 120),
      'clearance_requests', p_request_id::text, jsonb_build_object('request_id', p_request_id)
    )
    from public.company_users cu
    where cu.company_id = v_req.customer_company_id and cu.status = 'Active';
  end if;

  return v_id;
end;
$$;
grant execute on function public.clearance_send_message(uuid, text) to authenticated;

-- ─── 19) Read RPCs (joined data) ──────────────────────────────────────────────
create or replace function public.broker_list_requests(p_scope text default 'mine')
returns table (
  id uuid, title text, mode text, container_no text, bl_number text,
  port_of_entry text, eta date, cargo_description text, commercial_value numeric,
  currency text, incoterms text, notes text, status text,
  quote_amount numeric, quote_note text, entry_number text,
  platform_fee numeric, customer_name text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_broker uuid;
begin
  v_broker := public.broker_company_for();
  if v_broker is null then
    raise exception 'Only customs broker members can view this' using errcode='42501';
  end if;
  if p_scope = 'open' then
    return query
    select cr.id, cr.title, cr.mode, cr.container_no, cr.bl_number,
           cr.port_of_entry, cr.eta, cr.cargo_description, cr.commercial_value,
           cr.currency, cr.incoterms, cr.notes, cr.status,
           cr.quote_amount, cr.quote_note, cr.entry_number,
           cr.platform_fee, coalesce(c.name,'Company'), cr.created_at
    from public.clearance_requests cr
    left join public.companies c on c.id = cr.customer_company_id
    where cr.broker_company_id is null and cr.status = 'Submitted'
    order by cr.created_at desc;
  else
    return query
    select cr.id, cr.title, cr.mode, cr.container_no, cr.bl_number,
           cr.port_of_entry, cr.eta, cr.cargo_description, cr.commercial_value,
           cr.currency, cr.incoterms, cr.notes, cr.status,
           cr.quote_amount, cr.quote_note, cr.entry_number,
           cr.platform_fee, coalesce(c.name,'Company'), cr.created_at
    from public.clearance_requests cr
    left join public.companies c on c.id = cr.customer_company_id
    where cr.broker_company_id = v_broker
    order by cr.created_at desc;
  end if;
end; $$;
grant execute on function public.broker_list_requests(text) to authenticated;

create or replace function public.clearance_list_mine()
returns table (
  id uuid, title text, mode text, container_no text, bl_number text,
  port_of_entry text, eta date, status text,
  quote_amount numeric, quote_note text, entry_number text,
  broker_name text, created_at timestamptz
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
  select cr.id, cr.title, cr.mode, cr.container_no, cr.bl_number,
         cr.port_of_entry, cr.eta, cr.status,
         cr.quote_amount, cr.quote_note, cr.entry_number,
         coalesce(b.name,''), cr.created_at
  from public.clearance_requests cr
  left join public.companies b on b.id = cr.broker_company_id
  where cr.customer_company_id = v_company
  order by cr.created_at desc;
end; $$;
grant execute on function public.clearance_list_mine() to authenticated;

create or replace function public.broker_list_billing()
returns table (
  id uuid, title text, customer_name text, cleared_at timestamptz,
  fee numeric, platform_fee numeric, net_to_broker numeric,
  invoice_status text, currency text
)
language plpgsql stable security definer set search_path = public as $$
declare v_broker uuid;
begin
  v_broker := public.broker_company_for();
  if v_broker is null then
    raise exception 'Only customs broker members can view this' using errcode='42501';
  end if;
  return query
  select cr.id, cr.title, coalesce(c.name,'Company'), cr.cleared_at,
         cr.quote_amount, cr.platform_fee, round(cr.quote_amount - cr.platform_fee, 2),
         coalesce(i.status::text, ''), cr.currency
  from public.clearance_requests cr
  left join public.companies c on c.id = cr.customer_company_id
  left join public.invoices i on i.id = cr.invoice_id
  where cr.broker_company_id = v_broker and cr.status = 'Cleared'
  order by cr.cleared_at desc;
end; $$;
grant execute on function public.broker_list_billing() to authenticated;

-- ─── 20) handle_new_user — CustomsBroker signup with company ─────────────────
-- Verbatim from 0154 with the CustomsBroker mapping added.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_requested_role text;
  v_name text;
  v_company_id uuid;
  v_company_name text;
  v_company_city text;
  v_company_type company_type;
  v_fleet_code text;
  v_fleet_company_id uuid;
  v_agent_code text;
  v_vertical text;
begin
  v_requested_role := new.raw_user_meta_data->>'role';

  if v_requested_role in ('Admin', 'SuperAdmin') then
    v_role := 'Customer'::user_role;
    raise warning 'handle_new_user: blocked self-assignment of privileged role % for %', v_requested_role, new.email;
  else
    v_role := coalesce(v_requested_role::user_role, 'Customer'::user_role);
  end if;

  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  v_company_name := new.raw_user_meta_data->>'company_name';
  v_company_city := coalesce(new.raw_user_meta_data->>'city', 'Vancouver');
  v_fleet_code := nullif(trim(new.raw_user_meta_data->>'fleet_code'), '');
  v_agent_code := nullif(trim(new.raw_user_meta_data->>'agent_code'), '');

  v_company_type := case v_role
    when 'Customer' then 'Customer'::company_type
    when 'WarehouseProvider' then 'WarehouseProvider'::company_type
    when 'ServiceProvider' then 'ServiceProvider'::company_type
    when 'Employer' then 'Employer'::company_type
    when 'TruckingCompany' then 'TruckingCompany'::company_type
    when 'GateStaff' then 'WarehouseProvider'::company_type
    when 'Shipper' then 'Shipper'::company_type
    when 'DrayageCompany' then 'DrayageCompany'::company_type
    when 'FreightForwarder' then 'FreightForwarder'::company_type
    when 'EquipmentRentalCompany' then 'EquipmentRentalCompany'::company_type
    when 'MobileRepairProvider' then 'MobileRepairProvider'::company_type
    when 'CargoInsurer' then 'CargoInsurer'::company_type
    when 'MarketplaceBuyer' then 'MarketplaceBuyer'::company_type
    when 'EmploymentAgency' then 'EmploymentAgency'::company_type
    when 'CustomsBroker' then 'CustomsBroker'::company_type
    else null
  end;

  if v_company_type is not null and coalesce(v_company_name, '') <> '' then
    insert into public.companies (name, type, city, status)
    values (v_company_name, v_company_type, v_company_city, 'PendingApproval')
    returning id into v_company_id;
  end if;

  insert into public.profiles (id, email, name, role, company_id)
  values (new.id, new.email, v_name, v_role, v_company_id);

  if v_company_id is not null then
    insert into public.company_users (company_id, user_id, company_role, status)
    values (v_company_id, new.id, 'Owner', 'Active');
  end if;

  -- Sales agent self-registration → provision an agent record + code.
  if v_role = 'SalesAgent' then
    perform public.ensure_sales_agent(new.id);
  end if;

  -- Driver self-registration → link into the fleet as a PENDING request.
  if v_role = 'Driver' and v_fleet_code is not null then
    select id into v_fleet_company_id
    from public.companies where fleet_code = upper(v_fleet_code) limit 1;

    if v_fleet_company_id is not null then
      insert into public.drivers (company_id, profile_id, name, phone, status, data)
      values (
        v_fleet_company_id, new.id, v_name, '',
        'PendingApproval',
        jsonb_build_object('userId', new.id::text, 'email', new.email, 'name', v_name, 'selfRegistered', true)
      );

      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
      select cu.user_id, 'system', 'Driver wants to join your fleet',
        v_name || ' requested to join. Approve them in Dispatch.',
        'drivers', v_fleet_company_id
      from public.company_users cu
      where cu.company_id = v_fleet_company_id and cu.status = 'Active';
    end if;
  end if;

  -- Worker self-registration → auto-link to any agency roster rows that
  -- invited this email before the account existed.
  if v_role = 'Worker' then
    update public.agency_workers
       set worker_user_id = new.id, status = 'Active', updated_at = now()
     where worker_user_id is null
       and lower(email) = lower(new.email)
       and status = 'Invited';
  end if;

  -- Agent-code attribution.
  if v_agent_code is not null and v_role <> 'SalesAgent' then
    v_vertical := case v_role
      when 'WarehouseProvider' then 'warehouse'
      when 'DrayageCompany' then 'drayage'
      when 'FreightForwarder' then 'freight_forwarder'
      when 'CustomsBroker' then 'freight_forwarder'
      when 'Employer' then 'employer'
      when 'EmploymentAgency' then 'employer'
      when 'TruckingCompany' then 'trucking'
      when 'Shipper' then 'shipper'
      when 'Customer' then 'customer'
      when 'ServiceProvider' then 'service'
      when 'Worker' then 'worker'
      when 'Driver' then 'driver'
      when 'EquipmentRentalCompany' then 'service'
      when 'MobileRepairProvider' then 'service'
      when 'CargoInsurer' then 'service'
      when 'MarketplaceBuyer' then 'customer'
      else 'customer'
    end;
    begin
      perform public.attribute_account_to_agent(v_agent_code, new.id, v_company_id, v_vertical, 'code');
    exception when others then
      raise warning 'handle_new_user: agent attribution failed for %: %', new.email, sqlerrm;
    end;
  end if;

  -- Legal acceptances captured at signup (Terms for everyone, NDA for agents).
  begin
    if coalesce(new.raw_user_meta_data->>'accepted_terms', '') = 'true' then
      insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
      values (new.id, 'terms',
              coalesce(nullif(new.raw_user_meta_data->>'terms_version', ''), '1.0'),
              v_name, v_role::text, coalesce(new.raw_user_meta_data->>'signup_platform', ''))
      on conflict (user_id, doc_type) do nothing;
    end if;
    if coalesce(new.raw_user_meta_data->>'accepted_nda', '') = 'true' then
      insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
      values (new.id, 'nda',
              coalesce(nullif(new.raw_user_meta_data->>'nda_version', ''), '1.0'),
              coalesce(nullif(new.raw_user_meta_data->>'nda_signed_name', ''), v_name),
              v_role::text, coalesce(new.raw_user_meta_data->>'signup_platform', ''))
      on conflict (user_id, doc_type) do nothing;
    end if;
  exception when others then
    raise warning 'handle_new_user: legal acceptance recording failed for %: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;

-- ─── 21) Refresh PostgREST schema cache ──────────────────────────────────────
notify pgrst, 'reload schema';
