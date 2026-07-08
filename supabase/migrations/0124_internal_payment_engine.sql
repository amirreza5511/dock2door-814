-- =========================================================================
-- 0124 — Internal "sandbox" payment engine (fake Stripe) + finance gap wiring
-- Idempotent & additive. Safe to run multiple times.
--
-- Goal: while real Stripe stays OFF, simulate money movement so the whole
-- platform reconciles like it's live — invoices get Paid, payments get
-- Captured, provider/worker/agent payouts run, and every vertical
-- (trucking, labour, warehouse, service, DRAYAGE, ADVERTISING) lands in the
-- finance report. No external gateway is ever called.
--
-- Closes the six gaps identified in the finance audit:
--   1) No real payments anywhere      -> sandbox settle engine (this file)
--   2) Drayage has no finance layer    -> settle_drayage_order()
--   3) Advertising records no invoice  -> admin_settle_advertisement()
--   4) No real payouts (provider/worker/agent) -> sandbox_pay_* helpers
--   5) Warehouse/Service no auto invoice -> settle_booking_invoice()/settle_service_job_invoice()
--   6) Commission systems not connected -> internal_settle_invoice() always
--      fires record_recurring_commission() for the paying customer company.
-- =========================================================================

-- 1) SETTINGS -------------------------------------------------------------
-- payments_mode: 'sandbox' (simulate), 'stripe' (real, when keys added), 'off'.
alter table public.platform_settings
  add column if not exists payments_mode text not null default 'sandbox';

-- drayage commission % (platform cut on drayage revenue).
alter table public.platform_settings
  add column if not exists drayage_commission_percentage numeric not null default 10;

-- 2) INVOICE LINKS for idempotency + reporting ---------------------------
alter table public.invoices
  add column if not exists drayage_order_id uuid references public.drayage_orders(id) on delete set null;
alter table public.invoices
  add column if not exists advertisement_id uuid references public.advertisements(id) on delete set null;
alter table public.invoices
  add column if not exists commission_amount numeric not null default 0;
create index if not exists idx_invoices_drayage_order on public.invoices(drayage_order_id);
create index if not exists idx_invoices_advertisement on public.invoices(advertisement_id);

-- Payout reference (fake gateway transfer id).
alter table public.payouts
  add column if not exists reference text;

-- 3) ADMIN: set the payments mode ----------------------------------------
create or replace function public.admin_set_payments_mode(p_mode text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_mode not in ('sandbox', 'stripe', 'off') then raise exception 'invalid payments mode'; end if;
  select id into v_id from public.platform_settings limit 1;
  if v_id is null then raise exception 'platform_settings row not found'; end if;
  update public.platform_settings set payments_mode = p_mode, updated_at = now() where id = v_id;
  perform public.write_audit('platform_settings.payments_mode', 'platform_settings', v_id::text, null,
    jsonb_build_object('mode', p_mode), '');
end; $$;
grant execute on function public.admin_set_payments_mode(text) to authenticated;

-- 4) HELPER: fake gateway reference --------------------------------------
create or replace function public.sandbox_ref(p_prefix text default 'sbx')
returns text language sql volatile as $$
  select p_prefix || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
$$;

-- 5) CORE: settle an issued invoice through the sandbox engine -----------
-- Records a Captured payment (sandbox gateway ref), marks the invoice Paid,
-- queues a provider payout for the net, and records recurring sales-agent
-- commission for the paying customer company. Idempotent: if a payment
-- already exists for the invoice it just reconciles the status.
create or replace function public.internal_settle_invoice(
  p_invoice_id uuid,
  p_commission numeric default 0,
  p_category   text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv       public.invoices;
  v_gross     numeric;
  v_commission numeric;
  v_net       numeric;
  v_currency  text;
  v_pay_id    uuid;
  v_existing  uuid;
  v_ref       text;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;

  select * into v_inv from public.invoices where id = p_invoice_id;
  if v_inv is null then raise exception 'invoice not found'; end if;
  if v_inv.status = 'Void' then raise exception 'a voided invoice cannot be paid'; end if;

  select id into v_existing from public.payments where invoice_id = p_invoice_id limit 1;
  if v_existing is not null then
    update public.invoices set status = 'Paid', paid_at = coalesce(paid_at, now())
      where id = p_invoice_id and status <> 'Paid';
    return v_existing;
  end if;

  v_gross := coalesce(v_inv.total_amount, 0);
  v_commission := round(greatest(0, coalesce(p_commission, v_inv.commission_amount, 0)), 2);
  if v_commission > v_gross then v_commission := v_gross; end if;
  v_net := greatest(0, v_gross - v_commission);
  v_currency := coalesce(v_inv.currency, 'CAD');
  v_ref := public.sandbox_ref('sbx');

  insert into public.payments (
    invoice_id, booking_id, customer_company_id, provider_company_id,
    gross_amount, commission_amount, net_amount, currency, status,
    payment_method, category, stripe_charge_id, authorized_at, captured_at
  ) values (
    v_inv.id, v_inv.booking_id, v_inv.customer_company_id, v_inv.provider_company_id,
    v_gross, v_commission, v_net, v_currency, 'Captured',
    'sandbox', p_category, v_ref, now(), now()
  ) returning id into v_pay_id;

  update public.invoices
    set status = 'Paid', paid_at = now(), payment_id = v_pay_id, commission_amount = v_commission
    where id = p_invoice_id;

  -- Provider gets a payout for the net (skip pure-platform revenue like ads).
  if v_inv.provider_company_id is not null and v_net > 0 then
    insert into public.payouts (company_id, payment_id, gross_amount, commission_amount, net_amount, currency, status)
    values (v_inv.provider_company_id, v_pay_id, v_gross, v_commission, v_net, v_currency, 'Pending');
  end if;

  -- Unify the two commission systems: any settled invoice fires recurring
  -- sales-agent commission for the attributed customer company.
  if v_inv.customer_company_id is not null then
    begin
      perform public.record_recurring_commission(v_inv.customer_company_id, v_gross, coalesce(p_category, ''), v_inv.id);
    exception when others then null;
    end;
  end if;

  perform public.write_audit('payment.sandbox_settled', 'invoices', p_invoice_id::text, null,
    jsonb_build_object('gross', v_gross, 'commission', v_commission, 'net', v_net, 'ref', v_ref, 'category', p_category), '');

  return v_pay_id;
end; $$;
grant execute on function public.internal_settle_invoice(uuid, numeric, text) to authenticated;

-- 6) DRAYAGE settlement (gap #2) -----------------------------------------
-- Builds an invoice from the priced order, then settles it via the engine.
create or replace function public.settle_drayage_order(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_o     public.drayage_orders;
  v_pct   numeric;
  v_comm  numeric;
  v_num   text;
  v_inv_id uuid;
  v_existing uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into v_o from public.drayage_orders where id = p_order_id;
  if v_o is null then raise exception 'drayage order not found'; end if;
  if coalesce(v_o.total_price, 0) <= 0 then raise exception 'this drayage order has no price yet'; end if;

  select id into v_existing from public.invoices where drayage_order_id = p_order_id limit 1;
  if v_existing is not null then
    return public.internal_settle_invoice(v_existing, null, 'drayage');
  end if;

  select coalesce(drayage_commission_percentage, 10) into v_pct from public.platform_settings limit 1;
  v_comm := round(v_o.total_price * coalesce(v_pct, 10) / 100.0, 2);
  v_num := 'INV-DRY-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id, drayage_order_id,
    invoice_number, subtotal_amount, tax_amount, total_amount, commission_amount,
    currency, status, issued_at
  ) values (
    v_o.customer_company_id, v_o.drayage_company_id, p_order_id,
    v_num, v_o.total_price, 0, v_o.total_price, v_comm,
    coalesce(v_o.currency, 'CAD'), 'Issued', now()
  ) returning id into v_inv_id;

  return public.internal_settle_invoice(v_inv_id, v_comm, 'drayage');
end; $$;
grant execute on function public.settle_drayage_order(uuid) to authenticated;

-- 7) ADVERTISING settlement (gap #3) -------------------------------------
-- The ad price is 100% platform revenue (no provider payout). Also flips the
-- self-serve ad to Paid so the super admin can approve it live.
create or replace function public.admin_settle_advertisement(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ad     public.advertisements;
  v_num    text;
  v_inv_id uuid;
  v_existing uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into v_ad from public.advertisements where id = p_id;
  if v_ad is null then raise exception 'advertisement not found'; end if;
  if coalesce(v_ad.price, 0) <= 0 then raise exception 'set a price for this ad first'; end if;

  select id into v_existing from public.invoices where advertisement_id = p_id limit 1;
  if v_existing is null then
    v_num := 'INV-AD-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
    insert into public.invoices (
      customer_company_id, provider_company_id, advertisement_id,
      invoice_number, subtotal_amount, tax_amount, total_amount, commission_amount,
      currency, status, issued_at
    ) values (
      v_ad.owner_company_id, null, p_id,
      v_num, v_ad.price, 0, v_ad.price, v_ad.price,
      coalesce(v_ad.currency, 'CAD'), 'Issued', now()
    ) returning id into v_inv_id;
    perform public.internal_settle_invoice(v_inv_id, v_ad.price, 'advertising');
  else
    v_inv_id := v_existing;
    perform public.internal_settle_invoice(v_inv_id, v_ad.price, 'advertising');
  end if;

  update public.advertisements
    set review_status = 'Paid', paid_at = coalesce(paid_at, now()), updated_at = now()
    where id = p_id and source = 'self_serve';

  return v_inv_id;
end; $$;
grant execute on function public.admin_settle_advertisement(uuid) to authenticated;

-- 8) WAREHOUSE booking settlement (gap #5) -------------------------------
create or replace function public.settle_booking_invoice(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_b      public.warehouse_bookings;
  v_provider uuid;
  v_amount numeric;
  v_pct    numeric;
  v_comm   numeric;
  v_num    text;
  v_inv_id uuid;
  v_existing uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into v_b from public.warehouse_bookings where id = p_booking_id;
  if v_b is null then raise exception 'booking not found'; end if;

  v_amount := coalesce(v_b.final_price, v_b.counter_offer_price, v_b.proposed_price, 0);
  if v_amount <= 0 then raise exception 'this booking has no agreed price yet'; end if;

  select id into v_existing from public.invoices where booking_id = p_booking_id limit 1;
  if v_existing is not null then
    return public.internal_settle_invoice(v_existing, null, 'warehouse');
  end if;

  select company_id into v_provider from public.warehouse_listings where id = v_b.listing_id;
  select coalesce(warehouse_commission_percentage, 8) into v_pct from public.platform_settings limit 1;
  v_comm := round(v_amount * coalesce(v_pct, 8) / 100.0, 2);
  v_num := 'INV-WHS-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id, booking_id,
    invoice_number, subtotal_amount, tax_amount, total_amount, commission_amount,
    currency, status, issued_at
  ) values (
    v_b.customer_company_id, v_provider, p_booking_id,
    v_num, v_amount, 0, v_amount, v_comm, 'CAD', 'Issued', now()
  ) returning id into v_inv_id;

  return public.internal_settle_invoice(v_inv_id, v_comm, 'warehouse');
end; $$;
grant execute on function public.settle_booking_invoice(uuid) to authenticated;

-- 9) SERVICE job settlement (gap #5) -------------------------------------
create or replace function public.settle_service_job_invoice(p_job_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_j      public.service_jobs;
  v_provider uuid;
  v_pct    numeric;
  v_comm   numeric;
  v_num    text;
  v_inv_id uuid;
  v_existing uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into v_j from public.service_jobs where id = p_job_id;
  if v_j is null then raise exception 'service job not found'; end if;
  if coalesce(v_j.total_price, 0) <= 0 then raise exception 'this job has no price yet'; end if;

  select id into v_existing from public.invoices where service_job_id = p_job_id limit 1;
  if v_existing is not null then
    return public.internal_settle_invoice(v_existing, null, 'service');
  end if;

  select company_id into v_provider from public.service_listings where id = v_j.service_id;
  select coalesce(service_commission_percentage, 20) into v_pct from public.platform_settings limit 1;
  v_comm := round(v_j.total_price * coalesce(v_pct, 20) / 100.0, 2);
  v_num := 'INV-SVC-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id, service_job_id,
    invoice_number, subtotal_amount, tax_amount, total_amount, commission_amount,
    currency, status, issued_at
  ) values (
    v_j.customer_company_id, v_provider, p_job_id,
    v_num, v_j.total_price, 0, v_j.total_price, v_comm, 'CAD', 'Issued', now()
  ) returning id into v_inv_id;

  return public.internal_settle_invoice(v_inv_id, v_comm, 'service');
end; $$;
grant execute on function public.settle_service_job_invoice(uuid) to authenticated;

-- 10) PAYOUT RAILS (gap #4) — sandbox transfers --------------------------
create or replace function public.sandbox_pay_payout(p_payout_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.payouts
    set status = 'Paid', reference = coalesce(reference, public.sandbox_ref('po')), updated_at = now()
    where id = p_payout_id and status <> 'Paid';
  perform public.write_audit('payout.sandbox_paid', 'payouts', p_payout_id::text, null, null, '');
end; $$;
grant execute on function public.sandbox_pay_payout(uuid) to authenticated;

create or replace function public.sandbox_pay_worker(p_payable_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_p public.worker_payables;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into v_p from public.worker_payables where id = p_payable_id;
  if v_p is null then raise exception 'payable not found'; end if;
  update public.worker_payables
    set status = 'Paid', paid_at = now(),
        payout_reference = coalesce(payout_reference, public.sandbox_ref('wpo')), updated_at = now()
    where id = p_payable_id and status <> 'Paid';
  perform public.write_audit('worker_payout.sandbox_paid', 'worker_payables', p_payable_id::text, null,
    jsonb_build_object('amount', v_p.gross_pay), '');
end; $$;
grant execute on function public.sandbox_pay_worker(uuid) to authenticated;

-- Sales-agent commission payout (reuses the ledger status machine).
create or replace function public.sandbox_pay_commission(p_entry_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  perform public.admin_set_commission_status(p_entry_id, 'Paid');
end; $$;
grant execute on function public.sandbox_pay_commission(uuid) to authenticated;

notify pgrst, 'reload schema';
