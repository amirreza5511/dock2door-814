-- =========================================================================
-- 0114 — Fire recurring sales-agent commissions when revenue is captured.
-- Idempotent & self-healing. Safe to run multiple times.
--
-- When a payment is captured/paid, any sales agent who onboarded either the
-- customer OR the provider company on that payment earns their configured
-- recurring % (from their commission plan) on the gross amount. The vertical
-- is taken from that account's attribution record so the correct % applies.
--
-- Relies on public.record_recurring_commission() from migration 0113, which
-- already no-ops when the company isn't attributed or the plan has no % set,
-- so this trigger is safe even before any agents exist.
-- =========================================================================

create or replace function public.tg_payment_recurring_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gross numeric;
  v_paid  boolean;
  v_vertical text;
begin
  -- Only act once the money is actually collected.
  v_paid := new.status in ('Captured', 'Paid');
  if not v_paid then
    return new;
  end if;

  -- On UPDATE, only fire when the status transitions INTO a paid state.
  if tg_op = 'UPDATE' and old.status in ('Captured', 'Paid') then
    return new;
  end if;

  v_gross := coalesce(new.gross_amount, 0);
  if v_gross <= 0 then
    return new;
  end if;

  -- Provider company (the party earning marketplace revenue).
  if new.provider_company_id is not null then
    select vertical into v_vertical
    from public.agent_attributions
    where account_company_id = new.provider_company_id
    limit 1;
    if v_vertical is not null then
      perform public.record_recurring_commission(new.provider_company_id, v_gross, v_vertical, new.id);
    end if;
  end if;

  -- Customer company (in case the agent onboarded the buyer instead).
  if new.customer_company_id is not null
     and new.customer_company_id is distinct from new.provider_company_id then
    select vertical into v_vertical
    from public.agent_attributions
    where account_company_id = new.customer_company_id
    limit 1;
    if v_vertical is not null then
      perform public.record_recurring_commission(new.customer_company_id, v_gross, v_vertical, new.id);
    end if;
  end if;

  return new;
exception when others then
  -- Never block a payment because of commission bookkeeping.
  raise warning 'tg_payment_recurring_commission failed for payment %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_payment_recurring_commission on public.payments;
create trigger trg_payment_recurring_commission
  after insert or update of status on public.payments
  for each row execute function public.tg_payment_recurring_commission();

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
