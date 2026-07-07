-- Dock2Door — Provider-authored invoicing + light accounting.
-- Lets any provider company create and send a custom invoice to a customer
-- company (with itemized lines + tax), issue/void/mark-paid it themselves, and
-- see a basic accounting overview (A/R aging, revenue, expenses, net). Builds on
-- the existing invoices / invoice_lines / payments / payouts layer (0011).
-- Idempotent.

-- =========================================================================
-- 1) INVOICE metadata for manual/custom invoices
-- =========================================================================
alter table public.invoices add column if not exists notes text not null default '';
alter table public.invoices add column if not exists customer_name text not null default '';
alter table public.invoices add column if not exists customer_email text not null default '';
alter table public.invoices add column if not exists source text not null default 'auto'; -- 'auto' | 'manual'
alter table public.invoices add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.invoices add column if not exists commission_amount numeric not null default 0;

-- Providers must be able to read/insert lines for invoices they own (0011 only
-- allowed admins to write invoice_lines). Add owner-scoped policies.
drop policy if exists "invoice_lines_write_owner" on public.invoice_lines;
create policy "invoice_lines_write_owner" on public.invoice_lines for all
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and (public.is_member_of(i.provider_company_id) or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and (public.is_member_of(i.provider_company_id) or public.is_admin())
    )
  );

-- Allow providers to insert their own invoices directly (RLS on invoices table).
drop policy if exists "invoices_insert_owner" on public.invoices;
create policy "invoices_insert_owner" on public.invoices for insert
  with check (public.is_member_of(provider_company_id) or public.is_admin());

-- =========================================================================
-- 2) create_provider_invoice — build a custom invoice with lines
--    p_lines: jsonb array of { description, quantity, unit_price }
--    p_status: 'Draft' | 'Issued'
-- =========================================================================
create or replace function public.create_provider_invoice(
  p_provider_company_id uuid,
  p_customer_company_id uuid default null,
  p_customer_name text default '',
  p_customer_email text default '',
  p_currency text default 'CAD',
  p_tax_rate numeric default 0,
  p_due_days int default 14,
  p_notes text default '',
  p_lines jsonb default '[]'::jsonb,
  p_status text default 'Issued'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_number text;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_status text;
  v_line jsonb;
  v_qty numeric;
  v_price numeric;
  v_line_total numeric;
  v_sort int := 0;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if not (public.is_member_of(p_provider_company_id) or public.is_admin()) then
    raise exception 'only a member of the provider company can create this invoice';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'invoice needs at least one line item';
  end if;

  v_status := case when lower(coalesce(p_status, 'issued')) = 'draft' then 'Draft' else 'Issued' end;

  -- Compute subtotal from lines.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce((v_line->>'quantity')::numeric, 1);
    v_price := coalesce((v_line->>'unit_price')::numeric, 0);
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
  end loop;

  v_tax := round(v_subtotal * (coalesce(p_tax_rate, 0) / 100.0), 2);
  v_total := v_subtotal + v_tax;

  v_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date,
    issued_at, notes, customer_name, customer_email, source, created_by
  ) values (
    p_customer_company_id, p_provider_company_id,
    v_number, v_subtotal, v_tax, v_total,
    coalesce(nullif(p_currency, ''), 'CAD'), v_status,
    (current_date + make_interval(days => greatest(coalesce(p_due_days, 14), 0))),
    case when v_status = 'Issued' then now() else null end,
    coalesce(p_notes, ''), coalesce(p_customer_name, ''), coalesce(p_customer_email, ''),
    'manual', auth.uid()
  ) returning id into v_invoice_id;

  -- Insert lines.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce((v_line->>'quantity')::numeric, 1);
    v_price := coalesce((v_line->>'unit_price')::numeric, 0);
    v_line_total := round(v_qty * v_price, 2);
    insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
    values (v_invoice_id, coalesce(v_line->>'description', 'Item'), v_qty, v_price, v_line_total, v_sort);
    v_sort := v_sort + 1;
  end loop;

  perform public.write_audit('provider_invoice_created', 'invoices', v_invoice_id::text, null,
    jsonb_build_object('total', v_total, 'status', v_status, 'provider', p_provider_company_id), '');

  return v_invoice_id;
end; $$;

grant execute on function public.create_provider_invoice(uuid, uuid, text, text, text, numeric, int, text, jsonb, text) to authenticated;

-- =========================================================================
-- 3) provider_set_invoice_status — owner can Issue / Void / mark Paid
--    Marking Paid records a manual payment + queues a payout (mirrors the
--    admin flow in the shim) so reconciliation stays balanced.
-- =========================================================================
create or replace function public.provider_set_invoice_status(
  p_invoice_id uuid,
  p_status text,
  p_method text default 'manual'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices;
  v_gross numeric;
  v_commission numeric;
  v_net numeric;
  v_payment_id uuid;
  v_existing uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id;
  if v_inv is null then raise exception 'invoice not found'; end if;
  if not (public.is_member_of(v_inv.provider_company_id) or public.is_admin()) then
    raise exception 'only the issuing provider can change this invoice';
  end if;

  if p_status = 'Issued' then
    update public.invoices set status = 'Issued', issued_at = coalesce(issued_at, now()) where id = p_invoice_id;
    return null;
  elsif p_status = 'Void' then
    if v_inv.status = 'Paid' then raise exception 'a paid invoice cannot be voided'; end if;
    update public.invoices set status = 'Void', voided_at = now() where id = p_invoice_id;
    return null;
  elsif p_status = 'Paid' then
    if v_inv.status = 'Paid' then raise exception 'invoice already paid'; end if;
    if v_inv.status = 'Void' then raise exception 'a voided invoice cannot be paid'; end if;

    select id into v_existing from public.payments where invoice_id = p_invoice_id limit 1;
    if v_existing is not null then
      update public.invoices set status = 'Paid', paid_at = now() where id = p_invoice_id;
      return v_existing;
    end if;

    v_gross := coalesce(v_inv.total_amount, 0);
    v_commission := coalesce(v_inv.commission_amount, 0);
    v_net := greatest(v_gross - v_commission, 0);

    insert into public.payments (
      invoice_id, booking_id, customer_company_id, provider_company_id,
      gross_amount, commission_amount, net_amount, currency,
      status, payment_method, authorized_at, captured_at
    ) values (
      p_invoice_id, v_inv.booking_id, v_inv.customer_company_id, v_inv.provider_company_id,
      v_gross, v_commission, v_net, coalesce(v_inv.currency, 'CAD'),
      'Captured', coalesce(p_method, 'manual'), now(), now()
    ) returning id into v_payment_id;

    update public.invoices set status = 'Paid', paid_at = now(), payment_id = v_payment_id where id = p_invoice_id;

    if v_inv.provider_company_id is not null then
      insert into public.payouts (company_id, payment_id, gross_amount, commission_amount, net_amount, currency, status)
      values (v_inv.provider_company_id, v_payment_id, v_gross, v_commission, v_net, coalesce(v_inv.currency, 'CAD'), 'Pending');
    end if;

    perform public.write_audit('provider_invoice_paid', 'invoices', p_invoice_id::text, null,
      jsonb_build_object('payment_id', v_payment_id, 'method', p_method, 'gross', v_gross), '');
    return v_payment_id;
  else
    raise exception 'unsupported status %', p_status;
  end if;
end; $$;

grant execute on function public.provider_set_invoice_status(uuid, text, text) to authenticated;

-- =========================================================================
-- 4) COMPANY EXPENSES — light bookkeeping (accounts payable / costs)
-- =========================================================================
create table if not exists public.company_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null default 'general',
  vendor text not null default '',
  description text not null default '',
  amount numeric not null default 0,
  currency text not null default 'CAD',
  incurred_on date not null default current_date,
  status text not null default 'Recorded', -- 'Recorded' | 'Paid'
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_company_expenses_company on public.company_expenses(company_id, incurred_on desc);

alter table public.company_expenses enable row level security;

drop policy if exists "company_expenses_read" on public.company_expenses;
create policy "company_expenses_read" on public.company_expenses for select
  using (public.is_member_of(company_id) or public.is_admin());
drop policy if exists "company_expenses_write" on public.company_expenses;
create policy "company_expenses_write" on public.company_expenses for all
  using (public.is_member_of(company_id) or public.is_admin())
  with check (public.is_member_of(company_id) or public.is_admin());

-- =========================================================================
-- 5) company_accounting_summary — dashboard numbers for a company
--    Returns revenue (collected), outstanding A/R + aging buckets, expenses,
--    and net profit. Computed server-side over that company's invoices.
-- =========================================================================
create or replace function public.company_accounting_summary(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_collected numeric := 0;
  v_outstanding numeric := 0;
  v_overdue numeric := 0;
  v_draft numeric := 0;
  v_expenses numeric := 0;
  v_current numeric := 0;      -- not yet due
  v_1_30 numeric := 0;
  v_31_60 numeric := 0;
  v_60_plus numeric := 0;
  v_invoice_count int := 0;
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then
    raise exception 'not authorized';
  end if;

  select
    coalesce(sum(total_amount) filter (where status = 'Paid'), 0),
    coalesce(sum(total_amount) filter (where status in ('Issued','Overdue')), 0),
    coalesce(sum(total_amount) filter (where status = 'Draft'), 0),
    count(*) filter (where status <> 'Void')
  into v_collected, v_outstanding, v_draft, v_invoice_count
  from public.invoices
  where provider_company_id = p_company_id;

  -- Aging buckets over unpaid (Issued/Overdue) invoices by due date.
  select
    coalesce(sum(total_amount) filter (where due_date >= current_date), 0),
    coalesce(sum(total_amount) filter (where due_date < current_date and due_date >= current_date - 30), 0),
    coalesce(sum(total_amount) filter (where due_date < current_date - 30 and due_date >= current_date - 60), 0),
    coalesce(sum(total_amount) filter (where due_date < current_date - 60), 0),
    coalesce(sum(total_amount) filter (where due_date < current_date), 0)
  into v_current, v_1_30, v_31_60, v_60_plus, v_overdue
  from public.invoices
  where provider_company_id = p_company_id and status in ('Issued','Overdue');

  select coalesce(sum(amount), 0) into v_expenses
  from public.company_expenses where company_id = p_company_id;

  v_result := jsonb_build_object(
    'collected', v_collected,
    'outstanding', v_outstanding,
    'overdue', v_overdue,
    'draft', v_draft,
    'expenses', v_expenses,
    'net', v_collected - v_expenses,
    'invoiceCount', v_invoice_count,
    'aging', jsonb_build_object(
      'current', v_current,
      'd1_30', v_1_30,
      'd31_60', v_31_60,
      'd60_plus', v_60_plus
    )
  );
  return v_result;
end; $$;

grant execute on function public.company_accounting_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
