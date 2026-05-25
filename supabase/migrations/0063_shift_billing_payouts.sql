-- Dock2Door — Shift billing, worker payouts, company billing setup
-- Idempotent. Adds shift-level invoicing on top of existing finance layer.

-- =========================================================================
-- 1) COMPANY BILLING FIELDS
-- =========================================================================
alter table public.companies add column if not exists billing_contact_name text;
alter table public.companies add column if not exists billing_email text;
alter table public.companies add column if not exists billing_phone text;
alter table public.companies add column if not exists billing_address text;
alter table public.companies add column if not exists billing_mode text not null default 'ManualInvoice'
  check (billing_mode in ('ManualInvoice','CardOnFile','StripeCheckout'));
alter table public.companies add column if not exists payment_terms_days int not null default 14
  check (payment_terms_days between 0 and 90);
alter table public.companies add column if not exists billing_setup_completed_at timestamptz;

-- Set / update billing info (owner or admin of the company)
create or replace function public.company_update_billing(
  p_company_id uuid,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_billing_mode text,
  p_payment_terms_days int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if coalesce(trim(p_contact_name),'') = '' then raise exception 'billing contact name required'; end if;
  if coalesce(trim(p_email),'') = '' then raise exception 'billing email required'; end if;
  if p_billing_mode not in ('ManualInvoice','CardOnFile','StripeCheckout') then
    raise exception 'invalid billing_mode';
  end if;

  update public.companies
     set billing_contact_name = trim(p_contact_name),
         billing_email = trim(p_email),
         billing_phone = nullif(trim(coalesce(p_phone,'')), ''),
         billing_address = nullif(trim(coalesce(p_address,'')), ''),
         billing_mode = p_billing_mode,
         payment_terms_days = coalesce(p_payment_terms_days, 14),
         billing_setup_completed_at = now()
   where id = p_company_id;

  perform public.write_audit('company.billing_updated','companies', p_company_id::text, null,
    jsonb_build_object('billing_mode', p_billing_mode, 'terms_days', p_payment_terms_days), '');
end; $$;
grant execute on function public.company_update_billing(uuid, text, text, text, text, text, int) to authenticated;

-- =========================================================================
-- 2) WORKER PAYABLES (per-assignment payout ledger)
-- =========================================================================
do $$ begin
  create type worker_payable_status as enum ('Pending','Approved','Paid','Cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.worker_payables (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  shift_id uuid not null references public.shift_posts(id) on delete cascade,
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  employer_company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  confirmed_hours numeric not null default 0,
  hourly_rate numeric not null default 0,
  gross_pay numeric not null default 0,
  status worker_payable_status not null default 'Pending',
  paid_at timestamptz,
  payout_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id)
);
create index if not exists idx_wp_worker on public.worker_payables(worker_user_id);
create index if not exists idx_wp_employer on public.worker_payables(employer_company_id);
create index if not exists idx_wp_invoice on public.worker_payables(invoice_id);
create index if not exists idx_wp_status on public.worker_payables(status);

alter table public.worker_payables enable row level security;

drop policy if exists "wp_read_worker" on public.worker_payables;
create policy "wp_read_worker" on public.worker_payables for select using (
  worker_user_id = auth.uid()
  or public.is_member_of(employer_company_id)
  or public.is_admin()
);

drop policy if exists "wp_write_admin" on public.worker_payables;
create policy "wp_write_admin" on public.worker_payables for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- 3) ISSUE INVOICE FOR SHIFT
-- =========================================================================
-- Issues a single invoice covering all confirmed time entries on a shift.
-- Idempotent: re-issuing returns the existing invoice id when one already exists.
create or replace function public.issue_invoice_for_shift(p_shift_id uuid, p_due_days int default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shift_posts;
  v_company public.companies;
  v_invoice_id uuid;
  v_existing uuid;
  v_number text;
  v_subtotal numeric := 0;
  v_commission_pct numeric := 0;
  v_commission numeric := 0;
  v_due int;
  r record;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_shift from public.shift_posts where id = p_shift_id;
  if v_shift is null then raise exception 'shift not found'; end if;
  if not (public.is_member_of(v_shift.employer_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  -- Reuse existing invoice if already issued for this shift
  select id into v_existing
    from public.invoices
   where customer_company_id = v_shift.employer_company_id
     and (subtotal_amount > 0)
     and exists (
       select 1 from public.worker_payables wp where wp.invoice_id = invoices.id and wp.shift_id = p_shift_id
     )
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_company from public.companies where id = v_shift.employer_company_id;
  v_due := coalesce(p_due_days, coalesce(v_company.payment_terms_days, 14));

  -- Sum confirmed hours × rate across all assignments on this shift
  for r in
    select sa.id as assignment_id,
           sa.worker_user_id,
           coalesce(sum(coalesce(te.employer_confirmed_hours, 0)), 0) as hours,
           coalesce(sa.hourly_rate, v_shift.hourly_rate, 0) as rate
      from public.shift_assignments sa
      left join public.time_entries te on te.assignment_id = sa.id
     where sa.shift_id = p_shift_id
       and sa.status in ('Completed','HoursConfirmed')
     group by sa.id, sa.worker_user_id, sa.hourly_rate
  loop
    if r.hours > 0 then
      v_subtotal := v_subtotal + (r.hours * r.rate);
    end if;
  end loop;

  if v_subtotal <= 0 then raise exception 'no confirmed hours to invoice'; end if;

  -- Commission from platform_settings (labour_commission_percentage)
  select coalesce(labour_commission_percentage, 0) into v_commission_pct from public.platform_settings limit 1;
  v_commission := round(v_subtotal * (v_commission_pct / 100.0), 2);

  v_number := 'INV-SHF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_shift.employer_company_id, null,
    v_number, v_subtotal, 0, v_subtotal + v_commission,
    'CAD', 'Issued', (current_date + make_interval(days => v_due)), now()
  ) returning id into v_invoice_id;

  -- Create lines per assignment + a commission line
  for r in
    select sa.id as assignment_id,
           sa.worker_user_id,
           coalesce(sum(coalesce(te.employer_confirmed_hours, 0)), 0) as hours,
           coalesce(sa.hourly_rate, v_shift.hourly_rate, 0) as rate,
           coalesce(p.full_name, 'Worker') as worker_name
      from public.shift_assignments sa
      left join public.time_entries te on te.assignment_id = sa.id
      left join public.profiles p on p.id = sa.worker_user_id
     where sa.shift_id = p_shift_id
       and sa.status in ('Completed','HoursConfirmed')
     group by sa.id, sa.worker_user_id, sa.hourly_rate, p.full_name
  loop
    if r.hours > 0 then
      insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
      values (v_invoice_id,
              r.worker_name || ' — ' || r.hours || 'h @ $' || r.rate,
              r.hours, r.rate, round(r.hours * r.rate, 2), 0);

      insert into public.worker_payables (
        assignment_id, shift_id, worker_user_id, employer_company_id,
        invoice_id, confirmed_hours, hourly_rate, gross_pay, status
      ) values (
        r.assignment_id, p_shift_id, r.worker_user_id, v_shift.employer_company_id,
        v_invoice_id, r.hours, r.rate, round(r.hours * r.rate, 2), 'Approved'
      )
      on conflict (assignment_id) do update set
        invoice_id = excluded.invoice_id,
        confirmed_hours = excluded.confirmed_hours,
        hourly_rate = excluded.hourly_rate,
        gross_pay = excluded.gross_pay,
        status = case when worker_payables.status = 'Paid' then 'Paid'::worker_payable_status else 'Approved'::worker_payable_status end,
        updated_at = now();
    end if;
  end loop;

  if v_commission > 0 then
    insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
    values (v_invoice_id, 'Platform fee (' || v_commission_pct || '%)', 1, v_commission, v_commission, 99);
  end if;

  -- Update shift status
  update public.shift_posts set status = 'Completed' where id = p_shift_id and status not in ('Cancelled','Completed');

  perform public.write_audit('invoice_issued_shift', 'invoices', v_invoice_id::text, null,
    jsonb_build_object('shift_id', p_shift_id, 'subtotal', v_subtotal, 'commission', v_commission, 'total', v_subtotal + v_commission), '');

  return v_invoice_id;
end; $$;
grant execute on function public.issue_invoice_for_shift(uuid, int) to authenticated;

-- =========================================================================
-- 4) MANUAL ADMIN PAYMENT / PAYOUT ACTIONS (audited)
-- =========================================================================
create or replace function public.admin_mark_invoice_paid_manual(
  p_invoice_id uuid,
  p_reference text,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv public.invoices;
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);
  select * into v_inv from public.invoices where id = p_invoice_id;
  if v_inv is null then raise exception 'invoice not found'; end if;
  if v_inv.status = 'Paid' then raise exception 'invoice already paid'; end if;

  update public.invoices set status = 'Paid', paid_at = now() where id = p_invoice_id;

  insert into public.payments (
    invoice_id, customer_company_id, provider_company_id,
    gross_amount, commission_amount, net_amount, currency,
    status, payment_method, authorized_at, captured_at
  ) values (
    p_invoice_id, v_inv.customer_company_id, v_inv.provider_company_id,
    coalesce(v_inv.total_amount, 0), 0, coalesce(v_inv.total_amount, 0), coalesce(v_inv.currency,'CAD'),
    'Captured', 'manual', now(), now()
  );

  perform public.write_audit('invoice.manual_paid','invoices', p_invoice_id::text, null,
    jsonb_build_object('reference', p_reference, 'amount', v_inv.total_amount), p_reason);
end; $$;
grant execute on function public.admin_mark_invoice_paid_manual(uuid, text, text) to authenticated;

create or replace function public.admin_mark_worker_payout_paid(
  p_payable_id uuid,
  p_reference text,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_p public.worker_payables;
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);
  select * into v_p from public.worker_payables where id = p_payable_id;
  if v_p is null then raise exception 'payable not found'; end if;
  if v_p.status = 'Paid' then raise exception 'already paid'; end if;
  if v_p.invoice_id is not null then
    if (select status from public.invoices where id = v_p.invoice_id) <> 'Paid' then
      raise exception 'invoice must be paid first';
    end if;
  end if;

  update public.worker_payables
     set status = 'Paid', paid_at = now(), payout_reference = nullif(trim(coalesce(p_reference,'')), ''),
         updated_at = now()
   where id = p_payable_id;

  perform public.write_audit('worker_payout.paid','worker_payables', p_payable_id::text, null,
    jsonb_build_object('reference', p_reference, 'amount', v_p.gross_pay), p_reason);
end; $$;
grant execute on function public.admin_mark_worker_payout_paid(uuid, text, text) to authenticated;

-- =========================================================================
-- 5) BILLING / PAYOUT OVERVIEW VIEWS
-- =========================================================================
create or replace view public.employer_billing_overview as
select i.id as invoice_id,
       i.customer_company_id as employer_company_id,
       i.invoice_number,
       i.status,
       i.subtotal_amount,
       i.total_amount,
       i.currency,
       i.due_date,
       i.issued_at,
       i.paid_at
  from public.invoices i
 where exists (select 1 from public.worker_payables wp where wp.invoice_id = i.id);

create or replace view public.worker_earnings_overview as
select wp.id as payable_id,
       wp.worker_user_id,
       wp.shift_id,
       sp.title as shift_title,
       sp.date as shift_date,
       wp.confirmed_hours,
       wp.hourly_rate,
       wp.gross_pay,
       wp.status,
       wp.paid_at,
       wp.invoice_id,
       i.status as invoice_status,
       c.name as employer_name
  from public.worker_payables wp
  join public.shift_posts sp on sp.id = wp.shift_id
  left join public.invoices i on i.id = wp.invoice_id
  left join public.companies c on c.id = wp.employer_company_id;

grant select on public.employer_billing_overview to authenticated;
grant select on public.worker_earnings_overview to authenticated;
