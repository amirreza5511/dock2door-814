-- 0015_stripe_connect_checkout.sql
-- Stripe Connect + Checkout session support (idempotent)

alter table public.companies add column if not exists stripe_connect_account_id text;
alter table public.companies add column if not exists stripe_connect_onboarded boolean not null default false;
create unique index if not exists uq_companies_stripe_connect on public.companies(stripe_connect_account_id) where stripe_connect_account_id is not null;

alter table public.invoices add column if not exists stripe_checkout_session_id text;
alter table public.invoices add column if not exists stripe_payment_intent_id text;
create index if not exists ix_invoices_checkout on public.invoices(stripe_checkout_session_id) where stripe_checkout_session_id is not null;

-- RPC: owner/admin sets their connect account id (only once, idempotent)
create or replace function public.set_stripe_connect_account(p_company uuid, p_account_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_member_of(p_company)) then
    raise exception 'forbidden';
  end if;
  update public.companies
     set stripe_connect_account_id = p_account_id
   where id = p_company;
end;
$$;

create or replace function public.mark_stripe_connect_onboarded(p_company uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_member_of(p_company)) then
    raise exception 'forbidden';
  end if;
  update public.companies set stripe_connect_onboarded = p_done where id = p_company;
end;
$$;

grant execute on function public.set_stripe_connect_account(uuid, text) to authenticated;
grant execute on function public.mark_stripe_connect_onboarded(uuid, boolean) to authenticated;
