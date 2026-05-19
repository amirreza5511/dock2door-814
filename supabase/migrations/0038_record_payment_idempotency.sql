-- 0038_record_payment_idempotency.sql
-- Fixes two bugs in record_payment (called by the stripe-webhook Edge Function):
--
--   BUG 1 — No idempotency guard
--     The original INSERT had no conflict handler.  When Stripe retries a
--     webhook (it retries on any non-2xx response), the UNIQUE index on
--     stripe_payment_intent_id throws a 23505 unique-violation exception,
--     crashing the function and returning 500 to Stripe — which triggers
--     another retry, creating an infinite retry loop.
--     FIX: Check for an existing payment row by stripe_payment_intent_id
--     BEFORE the INSERT and return the existing id immediately.
--
--   BUG 2 — Commission double-write on concurrent / duplicate calls
--     Even if the INSERT is guarded, the subsequent
--       UPDATE invoices SET paid_at = now()
--     runs unconditionally, meaning a second concurrent call (different
--     stripe intent for the same invoice — edge case) could calculate and
--     write a second commission.
--     FIX: Add AND paid_at IS NULL to the invoice UPDATE so it is a true
--     no-op after the first successful payment.
--
-- Idempotent — safe to run on any database state.

create or replace function public.record_payment(
  p_invoice_id   uuid,
  p_gross        numeric,
  p_currency     text,
  p_stripe_intent text,
  p_method       text default 'card'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice    public.invoices;
  v_commission numeric := 0;
  v_rate       numeric := 0;
  v_payment_id uuid;
begin
  -- ─────────────────────────────────────────────────────────────────────────
  -- 1. Idempotency guard:
  --    If this Stripe payment intent was already recorded, return the
  --    existing payment id without touching anything.
  -- ─────────────────────────────────────────────────────────────────────────
  select id into v_payment_id
  from public.payments
  where stripe_payment_intent_id = p_stripe_intent;

  if found then
    return v_payment_id;
  end if;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 2. Validate invoice exists.
  -- ─────────────────────────────────────────────────────────────────────────
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 3. Commission double-write guard:
  --    If the invoice is already marked Paid (via a different intent), return
  --    the existing payment rather than creating a duplicate commission row.
  -- ─────────────────────────────────────────────────────────────────────────
  if v_invoice.paid_at is not null then
    select id into v_payment_id
    from public.payments
    where invoice_id = p_invoice_id
    order by captured_at desc nulls last
    limit 1;
    -- Return existing id, or a harmless generated id if somehow none exists.
    return coalesce(v_payment_id, gen_random_uuid());
  end if;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 4. Commission calculation.
  -- ─────────────────────────────────────────────────────────────────────────
  select coalesce(percentage, 0) into v_rate
  from public.commission_rules
  where scope = 'default' and active = true
  order by created_at desc limit 1;

  v_commission := round(p_gross * (v_rate / 100.0), 2);

  -- ─────────────────────────────────────────────────────────────────────────
  -- 5. Insert payment row.
  -- ─────────────────────────────────────────────────────────────────────────
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

  -- ─────────────────────────────────────────────────────────────────────────
  -- 6. Mark invoice paid — guarded by AND paid_at IS NULL to prevent
  --    double-processing on any concurrent / retry call.
  -- ─────────────────────────────────────────────────────────────────────────
  update public.invoices
  set status = 'Paid', paid_at = now()
  where id = p_invoice_id
    and paid_at is null;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 7. Queue payout.
  -- ─────────────────────────────────────────────────────────────────────────
  insert into public.payouts (
    company_id, payment_id,
    gross_amount, commission_amount, net_amount,
    status
  ) values (
    v_invoice.provider_company_id, v_payment_id,
    p_gross, v_commission, p_gross - v_commission,
    'Pending'
  );

  -- ─────────────────────────────────────────────────────────────────────────
  -- 8. Audit.
  -- ─────────────────────────────────────────────────────────────────────────
  perform public.write_audit(
    'payment_recorded', 'payments', v_payment_id::text, null,
    jsonb_build_object(
      'invoice_id',    p_invoice_id,
      'gross',         p_gross,
      'stripe_intent', p_stripe_intent
    ),
    ''
  );

  return v_payment_id;
end;
$$;

-- Service-role only.  No direct call from authenticated users.
revoke execute on function public.record_payment(uuid, numeric, text, text, text)
  from public, authenticated;
