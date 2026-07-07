-- =========================================================================
-- 0118 — Sales Agent profile & payout details
-- Idempotent & self-healing. Safe to run multiple times.
--
-- Adds payout/profile fields to sales_agents and a self-service RPC an agent
-- can call to complete their profile (phone, territory, payout method +
-- details). Powers the "complete your profile" checklist item and the
-- Agent profile screen.
-- =========================================================================

-- 1) Columns ----------------------------------------------------------------
alter table public.sales_agents add column if not exists payout_method  text not null default '';
alter table public.sales_agents add column if not exists payout_details text not null default '';

-- 2) Self-service profile update -------------------------------------------
create or replace function public.agent_update_profile(
  p_phone          text,
  p_territory      text,
  p_payout_method  text,
  p_payout_details text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  perform public.ensure_sales_agent(v_me);

  update public.sales_agents set
    phone          = coalesce(p_phone, phone),
    territory      = coalesce(p_territory, territory),
    payout_method  = coalesce(p_payout_method, payout_method),
    payout_details = coalesce(p_payout_details, payout_details),
    updated_at     = now()
  where id = v_me;
end;
$$;

grant execute on function public.agent_update_profile(text, text, text, text) to authenticated;

-- 3) Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
