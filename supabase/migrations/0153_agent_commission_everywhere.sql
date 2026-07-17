-- =========================================================================
-- 0153 — Sales agents earn commission from EVERYTHING.
-- Idempotent & self-healing. Safe to run multiple times.
--
-- Closes the remaining commission gaps so an agent is paid on every kind of
-- account they bring AND on all revenue their accounts generate:
--
--   1) People recurring %: attributed workers/drivers/owner-operators never
--      generated recurring commission (record_recurring_commission was
--      company-only). Adds record_recurring_commission_user() + a trigger on
--      worker_payables → when a referred worker is paid for a shift, their
--      agent earns the plan's recurring % of the gross pay.
--   2) Plan defaults: adds recurring % keys for worker / driver /
--      owner_operator to any plan that doesn't have them yet (existing
--      values are never overwritten).
--   3) Canonical vertical: record_recurring_commission now resolves the %
--      from the ATTRIBUTION's vertical (what the agent actually onboarded)
--      instead of trusting the caller-supplied transaction category, so a
--      mismatched/empty category can no longer swallow a commission.
--   4) De-duplication: a single money event used to be able to pay twice
--      (payments-table trigger from 0114 + the direct call inside
--      internal_settle_invoice from 0124). A chain-aware guard now links
--      invoice ↔ payment source ids so the same agent is never paid twice
--      for the same settlement.
--   5) Safety net: a trigger on invoices → 'Paid' catches any payment path
--      that never writes a payments row (e.g. ad settlements, future manual
--      paths), for BOTH the customer and the provider company. The dedup
--      guard makes it overlap-safe with the payments trigger.
-- =========================================================================

-- 1) Plan defaults: add people recurring % where missing ---------------------
-- Left side = new defaults, right side = existing config → existing keys win.
update public.commission_plans
set config = jsonb_set(
      config,
      '{recurring}',
      jsonb_build_object('worker', 1, 'driver', 1.5, 'owner_operator', 2)
        || coalesce(config->'recurring', '{}'::jsonb)
    ),
    updated_at = now()
where not (coalesce(config->'recurring', '{}'::jsonb) ? 'worker');

-- 2) Chain-aware dedup guard --------------------------------------------------
-- True when this agent already has a recurring entry for the same money event,
-- following the invoice ↔ payment link in both directions.
create or replace function public.agent_recurring_exists(
  p_agent_id  uuid,
  p_source_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_related uuid[];
begin
  if p_agent_id is null or p_source_id is null then
    return false;
  end if;

  v_related := array[p_source_id];

  -- If the source is a payment, include its invoice.
  v_related := v_related || coalesce(
    (select array_agg(invoice_id) from public.payments
      where id = p_source_id and invoice_id is not null),
    '{}'::uuid[]);

  -- If the source is an invoice, include all of its payments.
  v_related := v_related || coalesce(
    (select array_agg(id) from public.payments where invoice_id = p_source_id),
    '{}'::uuid[]);

  return exists (
    select 1 from public.commission_entries
    where agent_id = p_agent_id
      and kind = 'recurring'
      and source_id = any(v_related)
  );
end;
$$;

grant execute on function public.agent_recurring_exists(uuid, uuid) to authenticated;

-- 3) record_recurring_commission — attribution vertical + dedup --------------
-- Same signature as 0113 so every existing caller keeps working.
create or replace function public.record_recurring_commission(
  p_account_company_id uuid,
  p_gross_amount       numeric,
  p_vertical           text,
  p_source_id          uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_config jsonb;
  v_attr_vertical text;
  v_vertical text;
  v_pct numeric;
  v_amount numeric;
  v_id uuid;
begin
  if p_account_company_id is null or coalesce(p_gross_amount, 0) <= 0 then
    return null;
  end if;

  select aa.agent_id, coalesce(cp.config, '{}'::jsonb), aa.vertical
    into v_agent_id, v_config, v_attr_vertical
  from public.agent_attributions aa
  join public.sales_agents sa on sa.id = aa.agent_id and sa.status = 'Active'
  left join public.commission_plans cp on cp.id = sa.plan_id
  where aa.account_company_id = p_account_company_id
  limit 1;

  if v_agent_id is null then
    return null;
  end if;

  -- Canonical vertical = what the agent onboarded; caller category is only a
  -- fallback when the attribution record has no vertical.
  v_vertical := coalesce(nullif(trim(coalesce(v_attr_vertical, '')), ''),
                         nullif(trim(coalesce(p_vertical, '')), ''));
  if v_vertical is null then
    return null;
  end if;

  v_pct := coalesce((v_config->'recurring'->>v_vertical)::numeric, 0);
  if v_pct <= 0 then
    return null;
  end if;

  -- Never pay the same agent twice for the same settlement chain.
  if public.agent_recurring_exists(v_agent_id, p_source_id) then
    return null;
  end if;

  v_amount := round(p_gross_amount * v_pct / 100.0, 2);
  if v_amount <= 0 then
    return null;
  end if;

  insert into public.commission_entries (agent_id, kind, vertical, amount, status, source_type, source_id, description)
  values (v_agent_id, 'recurring', v_vertical, v_amount, 'Pending', 'booking', p_source_id,
          v_pct || '% recurring commission on ' || v_vertical || ' revenue')
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_recurring_commission(uuid, numeric, text, uuid) to authenticated;

-- 4) record_recurring_commission_user — people-level recurring ----------------
-- Same idea, but for accounts attributed by USER id (workers, drivers,
-- owner-operators). Fired when the person earns money on the platform.
create or replace function public.record_recurring_commission_user(
  p_account_user_id uuid,
  p_gross_amount    numeric,
  p_vertical        text,
  p_source_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_config jsonb;
  v_attr_vertical text;
  v_vertical text;
  v_pct numeric;
  v_amount numeric;
  v_id uuid;
begin
  if p_account_user_id is null or coalesce(p_gross_amount, 0) <= 0 then
    return null;
  end if;

  select aa.agent_id, coalesce(cp.config, '{}'::jsonb), aa.vertical
    into v_agent_id, v_config, v_attr_vertical
  from public.agent_attributions aa
  join public.sales_agents sa on sa.id = aa.agent_id and sa.status = 'Active'
  left join public.commission_plans cp on cp.id = sa.plan_id
  where aa.account_user_id = p_account_user_id
  limit 1;

  if v_agent_id is null then
    return null;
  end if;

  v_vertical := coalesce(nullif(trim(coalesce(v_attr_vertical, '')), ''),
                         nullif(trim(coalesce(p_vertical, '')), ''));
  if v_vertical is null then
    return null;
  end if;

  v_pct := coalesce((v_config->'recurring'->>v_vertical)::numeric, 0);
  if v_pct <= 0 then
    return null;
  end if;

  if p_source_id is not null and exists (
    select 1 from public.commission_entries
    where agent_id = v_agent_id and kind = 'recurring' and source_id = p_source_id
  ) then
    return null;
  end if;

  v_amount := round(p_gross_amount * v_pct / 100.0, 2);
  if v_amount <= 0 then
    return null;
  end if;

  insert into public.commission_entries (agent_id, kind, vertical, amount, status, source_type, source_id, description)
  values (v_agent_id, 'recurring', v_vertical, v_amount, 'Pending', 'booking', p_source_id,
          v_pct || '% recurring commission on referred ' || v_vertical || ' earnings')
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_recurring_commission_user(uuid, numeric, text, uuid) to authenticated;

-- 5) Worker payout trigger — referred worker gets paid → agent earns ----------
create or replace function public.tg_worker_payable_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text <> 'Paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status::text = 'Paid' then
    return new;
  end if;

  perform public.record_recurring_commission_user(
    new.worker_user_id, coalesce(new.gross_pay, 0), 'worker', new.id);

  return new;
exception when others then
  -- Never block a worker payout because of commission bookkeeping.
  raise warning 'tg_worker_payable_commission failed for payable %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_worker_payable_commission on public.worker_payables;
create trigger trg_worker_payable_commission
  after insert or update of status on public.worker_payables
  for each row execute function public.tg_worker_payable_commission();

-- 6) Invoice-paid safety net ---------------------------------------------------
-- Catches revenue paths that never insert a payments row. Both sides of the
-- transaction are checked; the dedup chain guard makes this overlap-safe with
-- the 0114 payments trigger.
create or replace function public.tg_invoice_paid_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gross numeric;
begin
  if new.status::text <> 'Paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status::text = 'Paid' then
    return new;
  end if;

  v_gross := coalesce(new.total_amount, 0);
  if v_gross <= 0 then
    return new;
  end if;

  if new.customer_company_id is not null then
    perform public.record_recurring_commission(new.customer_company_id, v_gross, '', new.id);
  end if;

  if new.provider_company_id is not null
     and new.provider_company_id is distinct from new.customer_company_id then
    perform public.record_recurring_commission(new.provider_company_id, v_gross, '', new.id);
  end if;

  return new;
exception when others then
  -- Never block an invoice payment because of commission bookkeeping.
  raise warning 'tg_invoice_paid_commission failed for invoice %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_invoice_paid_commission on public.invoices;
create trigger trg_invoice_paid_commission
  after insert or update of status on public.invoices
  for each row execute function public.tg_invoice_paid_commission();

-- 7) Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
