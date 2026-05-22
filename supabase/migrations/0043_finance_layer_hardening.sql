-- 0043_finance_layer_hardening.sql
-- Fixes three confirmed bugs in the finance layer:
--
-- BUG 1 — invoices.payment_id NOT NULL (0001) but issue_invoice_for_booking never sets it.
--   Every call to issue_invoice_for_booking crashes with a NOT NULL violation.
--   FIX: DROP NOT NULL on invoices.payment_id — invoices are created before payment exists.
--
-- BUG 2 — issue_invoice_for_booking uses v_booking.total_amount which does not exist on
--   warehouse_bookings (0001 defines final_price / proposed_price / counter_offer_price).
--   v_booking.total_amount silently resolves to NULL → every invoice is issued for $0.
--   FIX: COALESCE(final_price, proposed_price, counter_offer_price, 0).
--
-- BUG 3 — record_payment always uses commission scope='default' regardless of invoice type.
--   Warehouse booking invoices should use scope='warehouse_booking';
--   service job invoices should use scope='service_job'.
--   FIX: derive scope from invoice.booking_id / service_job_id, fall back to 'default'.
--
-- Idempotent — safe to apply on any DB state.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop NOT NULL on invoices.payment_id
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.invoices alter column payment_id drop not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix issue_invoice_for_booking — correct booking amount + commission scope
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.issue_invoice_for_booking(
  p_booking_id uuid,
  p_due_days   int default 14
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking    public.warehouse_bookings;
  v_invoice_id uuid;
  v_number     text;
  v_subtotal   numeric := 0;
  v_tax        numeric := 0;
  v_commission numeric := 0;
  v_rate       numeric := 0;
begin
  if not public.is_authenticated() then
    raise exception 'not authenticated';
  end if;

  select * into v_booking from public.warehouse_bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'booking not found';
  end if;
  -- Use ::text cast to safely compare against the PascalCase enum value 'Completed'
  if v_booking.status::text <> 'Completed' then
    raise exception 'booking must be completed before invoicing (current status: %)', v_booking.status;
  end if;
  if not (public.is_member_of(v_booking.warehouse_company_id) or public.is_admin()) then
    raise exception 'only warehouse provider or admin can issue invoice';
  end if;

  -- BUG 2 FIX: use final_price → proposed_price → counter_offer_price → 0
  -- (total_amount column does not exist on warehouse_bookings)
  v_subtotal := coalesce(
    v_booking.final_price,
    v_booking.proposed_price,
    v_booking.counter_offer_price,
    0
  );

  -- Commission: prefer warehouse_booking scope, fall back to default
  select coalesce(percentage, 0) into v_rate
  from public.commission_rules
  where scope = 'warehouse_booking' and active = true
  order by created_at desc limit 1;

  if v_rate = 0 then
    select coalesce(percentage, 0) into v_rate
    from public.commission_rules
    where scope = 'default' and active = true
    order by created_at desc limit 1;
  end if;

  v_commission := round(v_subtotal * (v_rate / 100.0), 2);

  v_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id, booking_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_booking.customer_company_id, v_booking.warehouse_company_id, v_booking.id,
    v_number, v_subtotal, v_tax, v_subtotal + v_tax,
    'CAD', 'Issued',
    (current_date + make_interval(days => p_due_days)),
    now()
  ) returning id into v_invoice_id;

  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (
    v_invoice_id,
    'Warehouse storage (booking ' || substr(p_booking_id::text, 1, 8) || ')',
    1, v_subtotal, v_subtotal, 0
  );

  perform public.write_audit(
    'invoice_issued', 'invoices', v_invoice_id::text, null,
    jsonb_build_object(
      'booking_id',  p_booking_id,
      'subtotal',    v_subtotal,
      'total',       v_subtotal + v_tax,
      'commission',  v_commission
    ),
    ''
  );

  return v_invoice_id;
end; $$;

grant execute on function public.issue_invoice_for_booking(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fix record_payment — commission scope derived from invoice type
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_payment(
  p_invoice_id    uuid,
  p_gross         numeric,
  p_currency      text,
  p_stripe_intent text,
  p_method        text default 'card'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice    public.invoices;
  v_commission numeric := 0;
  v_rate       numeric := 0;
  v_scope      text;
  v_payment_id uuid;
begin
  -- Idempotency guard: if this Stripe intent was already recorded, return existing id.
  select id into v_payment_id
  from public.payments
  where stripe_payment_intent_id = p_stripe_intent;
  if found then
    return v_payment_id;
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  -- Commission double-write guard: if already paid, return existing payment.
  if v_invoice.paid_at is not null then
    select id into v_payment_id
    from public.payments
    where invoice_id = p_invoice_id
    order by captured_at desc nulls last
    limit 1;
    return coalesce(v_payment_id, gen_random_uuid());
  end if;

  -- BUG 3 FIX: derive commission scope from invoice type
  v_scope := case
    when v_invoice.booking_id     is not null then 'warehouse_booking'
    when v_invoice.service_job_id is not null then 'service_job'
    else 'default'
  end;

  select coalesce(percentage, 0) into v_rate
  from public.commission_rules
  where scope = v_scope and active = true
  order by created_at desc limit 1;

  -- Fall back to 'default' if no rule for derived scope.
  if v_rate = 0 and v_scope <> 'default' then
    select coalesce(percentage, 0) into v_rate
    from public.commission_rules
    where scope = 'default' and active = true
    order by created_at desc limit 1;
  end if;

  v_commission := round(p_gross * (v_rate / 100.0), 2);

  insert into public.payments (
    invoice_id, booking_id,
    customer_company_id, provider_company_id,
    gross_amount, commission_amount, net_amount, currency,
    status, stripe_payment_intent_id, payment_method,
    authorized_at, captured_at
  ) values (
    p_invoice_id, v_invoice.booking_id,
    v_invoice.customer_company_id, v_invoice.provider_company_id,
    p_gross, v_commission, p_gross - v_commission,
    coalesce(p_currency, 'CAD'),
    'Captured', p_stripe_intent, p_method,
    now(), now()
  ) returning id into v_payment_id;

  -- Guard: only mark paid if not already paid (concurrent retry safety).
  update public.invoices
  set status = 'Paid', paid_at = now()
  where id = p_invoice_id
    and paid_at is null;

  insert into public.payouts (
    company_id, payment_id,
    gross_amount, commission_amount, net_amount,
    status
  ) values (
    v_invoice.provider_company_id, v_payment_id,
    p_gross, v_commission, p_gross - v_commission,
    'Pending'
  );

  perform public.write_audit(
    'payment_recorded', 'payments', v_payment_id::text, null,
    jsonb_build_object(
      'invoice_id',       p_invoice_id,
      'gross',            p_gross,
      'commission_scope', v_scope,
      'commission_rate',  v_rate,
      'commission',       v_commission,
      'stripe_intent',    p_stripe_intent
    ),
    ''
  );

  return v_payment_id;
end; $$;

-- Service-role only — called exclusively by the stripe-webhook Edge Function.
revoke execute on function public.record_payment(uuid, numeric, text, text, text)
  from public, authenticated;
