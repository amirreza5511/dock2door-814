-- =========================================================================
-- 0127 — Advertising: usage-based billing (run ads like an ad network)
-- Idempotent & additive. Safe to run multiple times.
--
-- Lets the super admin price an ad by delivery instead of a single flat fee:
--   * flat  — one-off price (existing behaviour, unchanged)
--   * cpm   — charge per 1,000 impressions (e.g. $100 / 1000 views)
--   * cpc   — charge per click
-- plus an optional budget cap so an ad auto-stops once it has spent its budget.
--
-- Accrued spend is derived from the live impression / click counters. The admin
-- "bills" the unbilled portion, which issues an invoice + captured payment via
-- the sandbox engine (0124) and advances the billed watermarks. Idempotent
-- billing: it only ever charges the delta since the last bill.
-- =========================================================================

alter table public.advertisements
  -- Self-heal: `price` normally comes from 0123, but ensure it exists so this
  -- migration can run standalone (the ad_accrued_spend function references it).
  add column if not exists price numeric not null default 0,                -- admin-set flat price
  add column if not exists currency text not null default 'CAD',
  add column if not exists impressions bigint not null default 0,
  add column if not exists clicks bigint not null default 0,
  add column if not exists pricing_model text not null default 'flat',      -- flat | cpm | cpc
  add column if not exists cpm_rate numeric not null default 0,             -- price per 1,000 impressions
  add column if not exists cpc_rate numeric not null default 0,             -- price per click
  add column if not exists budget_cap numeric not null default 0,           -- max total spend (0 = unlimited)
  add column if not exists billed_impressions bigint not null default 0,    -- impressions already invoiced
  add column if not exists billed_clicks bigint not null default 0,         -- clicks already invoiced
  add column if not exists billed_amount numeric not null default 0;        -- total invoiced so far

-- Accrued (earned-to-date) spend for an ad from its live counters, capped to
-- the budget. Flat ads accrue their whole price once approved/priced.
create or replace function public.ad_accrued_spend(p_ad public.advertisements)
returns numeric language sql immutable as $$
  select round(
    least(
      case coalesce(p_ad.pricing_model, 'flat')
        when 'cpm' then coalesce(p_ad.impressions, 0)::numeric / 1000.0 * coalesce(p_ad.cpm_rate, 0)
        when 'cpc' then coalesce(p_ad.clicks, 0)::numeric * coalesce(p_ad.cpc_rate, 0)
        else coalesce(p_ad.price, 0)
      end,
      case when coalesce(p_ad.budget_cap, 0) > 0
        then p_ad.budget_cap
        else 'infinity'::numeric
      end
    ), 2);
$$;

-- Bill the unbilled portion of an ad's delivery. Issues an invoice for the
-- delta (accrued - already-billed), settles it through the sandbox engine as
-- 100%-platform advertising revenue, advances the billed watermarks, and
-- auto-pauses the ad if it has reached its budget cap. Returns the amount billed.
create or replace function public.admin_bill_ad_usage(p_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_ad         public.advertisements;
  v_accrued    numeric;
  v_billable   numeric;
  v_num        text;
  v_inv_id     uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into v_ad from public.advertisements where id = p_id;
  if v_ad is null then raise exception 'advertisement not found'; end if;

  v_accrued  := public.ad_accrued_spend(v_ad);
  v_billable := round(v_accrued - coalesce(v_ad.billed_amount, 0), 2);
  if v_billable <= 0 then raise exception 'no new billable delivery for this ad yet'; end if;

  v_num := 'INV-AD-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
  insert into public.invoices (
    customer_company_id, provider_company_id, advertisement_id,
    invoice_number, subtotal_amount, tax_amount, total_amount, commission_amount,
    currency, status, issued_at
  ) values (
    v_ad.owner_company_id, null, p_id,
    v_num, v_billable, 0, v_billable, v_billable,
    coalesce(v_ad.currency, 'CAD'), 'Issued', now()
  ) returning id into v_inv_id;

  perform public.internal_settle_invoice(v_inv_id, v_billable, 'advertising');

  update public.advertisements
    set billed_impressions = coalesce(impressions, 0),
        billed_clicks      = coalesce(clicks, 0),
        billed_amount      = coalesce(billed_amount, 0) + v_billable,
        -- Auto-pause once the ad has spent (or exceeded) its budget.
        status = case
          when coalesce(budget_cap, 0) > 0
               and coalesce(billed_amount, 0) + v_billable >= budget_cap
          then 'Paused' else status end,
        updated_at = now()
    where id = p_id;

  perform public.write_audit('advertisement.usage_billed', 'advertisements', p_id::text, null,
    jsonb_build_object('amount', v_billable, 'accrued', v_accrued, 'model', v_ad.pricing_model), '');

  return v_billable;
end; $$;
grant execute on function public.admin_bill_ad_usage(uuid) to authenticated;

notify pgrst, 'reload schema';
