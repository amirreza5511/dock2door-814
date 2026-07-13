-- Dock2Door — Services Marketplace: cargo insurance, quote→order flow, job
-- photos, and platform-commission invoicing.
-- ---------------------------------------------------------------------------
-- Additive & idempotent. Safe to re-run. Builds on:
--   * service_listings / service_jobs           (0001, 0008, 0132)
--   * invoices / invoice_lines / payments        (0001, 0011, 0117)
-- No destructive changes. Quote state is tracked in a NEW text column so we do
-- NOT have to touch the job_status enum or its transition state-machine.

-- =============================================================
-- 1) Cargo insurance service type + pricing columns
-- =============================================================
-- Widen the service_type check to include 'cargo_insurance'.
alter table public.service_listings drop constraint if exists service_listings_service_type_chk;
alter table public.service_listings
  add constraint service_listings_service_type_chk
  check (service_type in ('service', 'equipment_rental', 'mobile_repair', 'cargo_insurance'));

-- Cargo-insurance pricing: a percentage of declared cargo value plus a minimum
-- premium floor. Null for non-insurance listings.
alter table public.service_listings
  add column if not exists cargo_rate_percent numeric,
  add column if not exists min_premium        numeric;

-- =============================================================
-- 2) Quote → order fields on service_jobs
-- =============================================================
-- quote_status drives the marketplace quote lifecycle independent of the job
-- status enum:  'none' | 'requested' | 'quoted' | 'accepted' | 'declined'.
alter table public.service_jobs
  add column if not exists quote_status      text    not null default 'none',
  add column if not exists quoted_amount     numeric,
  add column if not exists quote_notes       text    not null default '',
  add column if not exists quote_sent_at     timestamptz,
  add column if not exists cargo_value       numeric,
  add column if not exists commission_amount numeric not null default 0,
  add column if not exists invoice_id        uuid references public.invoices(id) on delete set null;

create index if not exists idx_service_jobs_quote on public.service_jobs(quote_status);

-- =============================================================
-- 3) send_service_quote — provider sends an official price
-- =============================================================
create or replace function public.send_service_quote(
  p_job_id uuid,
  p_amount numeric,
  p_notes text default '',
  p_commission_rate numeric default 0.08
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.service_jobs;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_job from public.service_jobs where id = p_job_id;
  if v_job is null then raise exception 'job not found'; end if;
  if not (public.is_member_of(v_job.provider_company_id) or public.is_admin()) then
    raise exception 'only the provider can quote this job';
  end if;

  update public.service_jobs
     set quoted_amount     = greatest(coalesce(p_amount, 0), 0),
         quote_notes       = coalesce(p_notes, ''),
         quote_sent_at     = now(),
         quote_status      = 'quoted',
         commission_amount = round(greatest(coalesce(p_amount, 0), 0) * coalesce(p_commission_rate, 0.08), 2)
   where id = p_job_id;
end; $$;

grant execute on function public.send_service_quote(uuid, numeric, text, numeric) to authenticated;

-- =============================================================
-- 4) respond_service_quote — customer accepts / declines
-- =============================================================
create or replace function public.respond_service_quote(
  p_job_id uuid,
  p_accept boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.service_jobs;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_job from public.service_jobs where id = p_job_id;
  if v_job is null then raise exception 'job not found'; end if;
  if not (public.is_member_of(v_job.customer_company_id) or public.is_admin()) then
    raise exception 'only the customer can respond to this quote';
  end if;
  if v_job.quote_status <> 'quoted' then
    raise exception 'no quote is awaiting a response on this job';
  end if;

  if p_accept then
    update public.service_jobs
       set quote_status = 'accepted',
           total_price  = coalesce(v_job.quoted_amount, total_price)
     where id = p_job_id;
  else
    -- Decline: mark the quote declined and cancel the request (allowed
    -- customer transition Requested -> Cancelled).
    perform set_config('request.job_transition_reason', 'Quote declined by customer', true);
    update public.service_jobs
       set quote_status = 'declined',
           status = case when status = 'Requested' then 'Cancelled'::job_status else status end
     where id = p_job_id;
  end if;
end; $$;

grant execute on function public.respond_service_quote(uuid, boolean) to authenticated;

-- =============================================================
-- 5) invoice_service_job — provider bills a completed job with commission
-- =============================================================
create or replace function public.invoice_service_job(
  p_job_id uuid,
  p_tax_rate numeric default 0,
  p_commission_rate numeric default 0.08
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.service_jobs;
  v_invoice_id uuid;
  v_number text;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
  v_commission numeric;
  v_customer_name text := '';
  v_desc text;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_job from public.service_jobs where id = p_job_id;
  if v_job is null then raise exception 'job not found'; end if;
  if not (public.is_member_of(v_job.provider_company_id) or public.is_admin()) then
    raise exception 'only the provider can invoice this job';
  end if;
  if v_job.invoice_id is not null then
    return v_job.invoice_id; -- already invoiced
  end if;

  v_subtotal := coalesce(nullif(v_job.total_price, 0), v_job.quoted_amount, 0);
  v_tax := round(v_subtotal * (coalesce(p_tax_rate, 0) / 100.0), 2);
  v_total := v_subtotal + v_tax;
  v_commission := round(v_subtotal * coalesce(p_commission_rate, 0.08), 2);
  v_number := 'MKT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  select name into v_customer_name from public.companies where id = v_job.customer_company_id;
  v_desc := 'Marketplace service — ' || coalesce(nullif(v_job.location_city, ''), 'job') ||
            ' (' || to_char(coalesce(v_job.date_time_start, now()), 'YYYY-MM-DD') || ')';

  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount, commission_amount,
    currency, status, due_date, issued_at, notes, customer_name, source, created_by
  ) values (
    v_job.customer_company_id, v_job.provider_company_id,
    v_number, v_subtotal, v_tax, v_total, v_commission,
    'CAD', 'Issued', current_date + 14, now(), coalesce(v_job.notes, ''),
    coalesce(v_customer_name, ''), 'marketplace', auth.uid()
  ) returning id into v_invoice_id;

  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (v_invoice_id, v_desc, 1, v_subtotal, v_subtotal, 0);

  update public.service_jobs
     set invoice_id = v_invoice_id,
         commission_amount = v_commission
   where id = p_job_id;

  return v_invoice_id;
end; $$;

grant execute on function public.invoice_service_job(uuid, numeric, numeric) to authenticated;

-- =============================================================
-- 6) Job photos — before/after/progress evidence
-- =============================================================
create table if not exists public.service_job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  url text not null,
  caption text not null default '',
  kind text not null default 'progress', -- 'before' | 'after' | 'progress'
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_service_job_photos_job on public.service_job_photos(job_id, created_at);

alter table public.service_job_photos enable row level security;

drop policy if exists "sjp_read_parties" on public.service_job_photos;
create policy "sjp_read_parties" on public.service_job_photos for select
  using (
    public.is_admin() or exists (
      select 1 from public.service_jobs j
       where j.id = service_job_photos.job_id
         and (public.is_member_of(j.customer_company_id) or public.is_member_of(j.provider_company_id))
    )
  );

drop policy if exists "sjp_write_parties" on public.service_job_photos;
create policy "sjp_write_parties" on public.service_job_photos for insert
  with check (
    public.is_admin() or exists (
      select 1 from public.service_jobs j
       where j.id = service_job_photos.job_id
         and (public.is_member_of(j.customer_company_id) or public.is_member_of(j.provider_company_id))
    )
  );

drop policy if exists "sjp_delete_parties" on public.service_job_photos;
create policy "sjp_delete_parties" on public.service_job_photos for delete
  using (
    public.is_admin() or exists (
      select 1 from public.service_jobs j
       where j.id = service_job_photos.job_id
         and (public.is_member_of(j.customer_company_id) or public.is_member_of(j.provider_company_id))
    )
  );

-- =============================================================
-- 7) Storage bucket for job photos (public read, authenticated write)
-- =============================================================
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', true)
on conflict (id) do nothing;

drop policy if exists "job_photos_read" on storage.objects;
create policy "job_photos_read" on storage.objects for select
  using (bucket_id = 'job-photos');

drop policy if exists "job_photos_insert" on storage.objects;
create policy "job_photos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos');

drop policy if exists "job_photos_delete" on storage.objects;
create policy "job_photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos');

notify pgrst, 'reload schema';
