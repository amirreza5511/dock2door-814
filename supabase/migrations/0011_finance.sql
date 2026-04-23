-- Dock2Door — Finance: invoices, invoice_lines, payments, payouts, refunds, disputes
-- Idempotent. Extends existing invoices / payments / payouts tables.

-- =========================================================================
-- ENUMS
-- =========================================================================
do $$ begin
  create type invoice_status as enum ('Draft','Issued','Paid','Void','Refunded','Overdue');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('Pending','Authorized','Captured','Failed','Refunded','PartiallyRefunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type refund_status as enum ('Pending','Processing','Succeeded','Failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type dispute_status as enum ('Open','UnderReview','Resolved','Rejected','Escalated');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- INVOICES — ensure columns + lines
-- =========================================================================
alter table public.invoices add column if not exists customer_company_id uuid references public.companies(id) on delete set null;
alter table public.invoices add column if not exists provider_company_id uuid references public.companies(id) on delete set null;
alter table public.invoices add column if not exists booking_id uuid references public.warehouse_bookings(id) on delete set null;
alter table public.invoices add column if not exists service_job_id uuid references public.service_jobs(id) on delete set null;
alter table public.invoices add column if not exists subtotal_amount numeric not null default 0;
alter table public.invoices add column if not exists tax_amount numeric not null default 0;
alter table public.invoices add column if not exists total_amount numeric not null default 0;
alter table public.invoices add column if not exists currency text not null default 'CAD';
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists issued_at timestamptz;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists invoice_number text;
alter table public.invoices add column if not exists pdf_path text;

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null default '',
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  tax_rate_id uuid references public.tax_rules(id) on delete set null,
  tax_amount numeric not null default 0,
  line_total numeric not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoice_lines_invoice on public.invoice_lines(invoice_id);

alter table public.invoice_lines enable row level security;

-- =========================================================================
-- PAYMENTS — ensure columns
-- =========================================================================
alter table public.payments add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
alter table public.payments add column if not exists customer_company_id uuid references public.companies(id) on delete set null;
alter table public.payments add column if not exists provider_company_id uuid references public.companies(id) on delete set null;
alter table public.payments add column if not exists stripe_payment_intent_id text;
alter table public.payments add column if not exists stripe_charge_id text;
alter table public.payments add column if not exists payment_method text;
alter table public.payments add column if not exists authorized_at timestamptz;
alter table public.payments add column if not exists captured_at timestamptz;
alter table public.payments add column if not exists refunded_at timestamptz;

create index if not exists idx_payments_invoice on public.payments(invoice_id);
create index if not exists idx_payments_customer on public.payments(customer_company_id);
create index if not exists idx_payments_provider on public.payments(provider_company_id);
create unique index if not exists uq_payments_stripe_intent on public.payments(stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- =========================================================================
-- REFUNDS
-- =========================================================================
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  amount numeric not null default 0,
  reason text not null default '',
  status refund_status not null default 'Pending',
  stripe_refund_id text,
  initiated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_refunds_payment on public.refunds(payment_id);
alter table public.refunds enable row level security;

-- =========================================================================
-- DISPUTES — extend existing
-- =========================================================================
alter table public.disputes add column if not exists payment_id uuid references public.payments(id) on delete set null;
alter table public.disputes add column if not exists refund_id uuid references public.refunds(id) on delete set null;
alter table public.disputes add column if not exists resolution_amount numeric default 0;
alter table public.disputes add column if not exists resolved_by uuid references public.profiles(id) on delete set null;
alter table public.disputes add column if not exists resolved_at timestamptz;

-- =========================================================================
-- PAYMENT METHODS (per company, for saved cards via Stripe)
-- =========================================================================
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  stripe_customer_id text,
  stripe_payment_method_id text,
  brand text default '',
  last4 text default '',
  exp_month int,
  exp_year int,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_pm_company on public.payment_methods(company_id);
alter table public.payment_methods enable row level security;

-- =========================================================================
-- RLS POLICIES
-- =========================================================================

-- invoice_lines: readable by participants of parent invoice
drop policy if exists "invoice_lines_read" on public.invoice_lines;
create policy "invoice_lines_read" on public.invoice_lines for select using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_lines.invoice_id
      and (
        public.is_member_of(i.customer_company_id)
        or public.is_member_of(i.provider_company_id)
        or public.is_admin()
      )
  )
);

drop policy if exists "invoice_lines_write_admin" on public.invoice_lines;
create policy "invoice_lines_write_admin" on public.invoice_lines for all using (public.is_admin()) with check (public.is_admin());

-- refunds: participants read; writes via RPC only
drop policy if exists "refunds_read" on public.refunds;
create policy "refunds_read" on public.refunds for select using (
  exists (
    select 1 from public.payments p
    where p.id = refunds.payment_id
      and (public.is_member_of(p.customer_company_id) or public.is_member_of(p.provider_company_id) or public.is_admin())
  )
);

-- payment_methods: company members
drop policy if exists "pm_read" on public.payment_methods;
create policy "pm_read" on public.payment_methods for select using (public.is_member_of(company_id) or public.is_admin());

drop policy if exists "pm_write" on public.payment_methods;
create policy "pm_write" on public.payment_methods for all
  using (public.is_member_of(company_id))
  with check (public.is_member_of(company_id));

-- =========================================================================
-- RPCs — finance operations
-- =========================================================================

-- Issue an invoice from a completed booking (commission auto-computed)
create or replace function public.issue_invoice_for_booking(p_booking_id uuid, p_due_days int default 14)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.warehouse_bookings;
  v_invoice_id uuid;
  v_number text;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_commission numeric := 0;
  v_rate numeric := 0;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_booking from public.warehouse_bookings where id = p_booking_id;
  if v_booking is null then raise exception 'booking not found'; end if;
  if v_booking.status <> 'completed' then raise exception 'booking must be completed'; end if;
  if not (public.is_member_of(v_booking.warehouse_company_id) or public.is_admin()) then
    raise exception 'only warehouse provider or admin can issue invoice';
  end if;

  v_subtotal := coalesce(v_booking.total_amount, 0);
  select coalesce(percentage, 0) into v_rate from public.commission_rules where scope = 'warehouse_booking' and active = true order by created_at desc limit 1;
  v_commission := round(v_subtotal * (v_rate / 100.0), 2);

  v_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id, booking_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_booking.customer_company_id, v_booking.warehouse_company_id, v_booking.id,
    v_number, v_subtotal, v_tax, v_subtotal + v_tax,
    'CAD', 'Issued', (current_date + make_interval(days => p_due_days)), now()
  ) returning id into v_invoice_id;

  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (v_invoice_id, 'Warehouse storage (booking ' || substr(p_booking_id::text, 1, 8) || ')', 1, v_subtotal, v_subtotal, 0);

  perform public.write_audit('invoice_issued', 'invoices', v_invoice_id::text, null,
    jsonb_build_object('booking_id', p_booking_id, 'total', v_subtotal + v_tax, 'commission', v_commission), '');

  return v_invoice_id;
end; $$;

grant execute on function public.issue_invoice_for_booking(uuid, int) to authenticated;

-- Issue invoice from service job
create or replace function public.issue_invoice_for_service_job(p_job_id uuid, p_due_days int default 14)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.service_jobs;
  v_invoice_id uuid;
  v_number text;
  v_amount numeric := 0;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_job from public.service_jobs where id = p_job_id;
  if v_job is null then raise exception 'job not found'; end if;
  if v_job.status <> 'completed' then raise exception 'job must be completed'; end if;
  if not (public.is_member_of(v_job.provider_company_id) or public.is_admin()) then
    raise exception 'only provider or admin can issue invoice';
  end if;

  v_amount := coalesce(v_job.total_amount, 0);
  v_number := 'INV-SJ-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id, service_job_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_job.customer_company_id, v_job.provider_company_id, v_job.id,
    v_number, v_amount, 0, v_amount,
    'CAD', 'Issued', (current_date + make_interval(days => p_due_days)), now()
  ) returning id into v_invoice_id;

  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (v_invoice_id, 'Service job ' || substr(p_job_id::text, 1, 8), 1, v_amount, v_amount, 0);

  perform public.write_audit('invoice_issued_service', 'invoices', v_invoice_id::text, null,
    jsonb_build_object('job_id', p_job_id, 'total', v_amount), '');

  return v_invoice_id;
end; $$;

grant execute on function public.issue_invoice_for_service_job(uuid, int) to authenticated;

-- Record a payment (typically called by stripe-webhook Edge Function)
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_gross numeric,
  p_currency text,
  p_stripe_intent text,
  p_method text default 'card'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_commission numeric := 0;
  v_rate numeric := 0;
  v_payment_id uuid;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice is null then raise exception 'invoice not found'; end if;

  select coalesce(percentage, 0) into v_rate from public.commission_rules where scope = 'default' and active = true order by created_at desc limit 1;
  v_commission := round(p_gross * (v_rate / 100.0), 2);

  insert into public.payments (
    invoice_id, booking_id, customer_company_id, provider_company_id,
    gross_amount, commission_amount, net_amount, currency,
    status, stripe_payment_intent_id, payment_method,
    authorized_at, captured_at
  ) values (
    p_invoice_id, v_invoice.booking_id, v_invoice.customer_company_id, v_invoice.provider_company_id,
    p_gross, v_commission, p_gross - v_commission, coalesce(p_currency, 'CAD'),
    'Captured', p_stripe_intent, p_method,
    now(), now()
  ) returning id into v_payment_id;

  update public.invoices set status = 'Paid', paid_at = now() where id = p_invoice_id;

  -- queue payout
  insert into public.payouts (company_id, payment_id, gross_amount, commission_amount, net_amount, status)
  values (v_invoice.provider_company_id, v_payment_id, p_gross, v_commission, p_gross - v_commission, 'Pending');

  perform public.write_audit('payment_recorded', 'payments', v_payment_id::text, null,
    jsonb_build_object('invoice_id', p_invoice_id, 'gross', p_gross, 'stripe', p_stripe_intent), '');

  return v_payment_id;
end; $$;

revoke execute on function public.record_payment(uuid, numeric, text, text, text) from public, authenticated;

-- Initiate refund (admin only)
create or replace function public.admin_initiate_refund(p_payment_id uuid, p_amount numeric, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund_id uuid;
  v_payment public.payments;
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);
  select * into v_payment from public.payments where id = p_payment_id;
  if v_payment is null then raise exception 'payment not found'; end if;
  if p_amount <= 0 or p_amount > coalesce(v_payment.gross_amount, 0) then raise exception 'invalid refund amount'; end if;

  insert into public.refunds (payment_id, amount, reason, status, initiated_by)
  values (p_payment_id, p_amount, p_reason, 'Pending', auth.uid())
  returning id into v_refund_id;

  update public.payments
    set status = case when p_amount >= gross_amount then 'Refunded' else 'PartiallyRefunded' end
  where id = p_payment_id;

  perform public.write_audit('refund_initiated', 'refunds', v_refund_id::text, null,
    jsonb_build_object('payment_id', p_payment_id, 'amount', p_amount), p_reason);

  return v_refund_id;
end; $$;

grant execute on function public.admin_initiate_refund(uuid, numeric, text) to authenticated;

-- Schedule payouts (admin / cron)
create or replace function public.schedule_pending_payouts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  perform public.require_admin();
  update public.payouts set status = 'Processing', updated_at = now() where status = 'Pending';
  get diagnostics v_count = row_count;
  perform public.write_audit('payouts_scheduled', 'payouts', null, null, jsonb_build_object('count', v_count), '');
  return v_count;
end; $$;

grant execute on function public.schedule_pending_payouts() to authenticated;

-- Helper: is_authenticated (safe, idempotent)
create or replace function public.is_authenticated() returns boolean language sql stable as $$
  select auth.uid() is not null
$$;
