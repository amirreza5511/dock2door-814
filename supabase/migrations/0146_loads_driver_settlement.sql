-- Dock2Door — Driver settlement & per-trip profit
-- ==========================================================================
-- Each load can carry a driver-pay plan (percent of the carrier net, or a flat
-- trip rate) plus a fuel cost. Per-trip profit = provider_net - driver pay -
-- fuel. Delivered loads roll up into a per-driver settlement that the carrier
-- can mark as paid. Additive + idempotent.
-- ==========================================================================

alter table public.loads add column if not exists driver_pay_type text;       -- 'Percent' | 'Flat'
alter table public.loads add column if not exists driver_pay_value numeric;    -- percent (0-100) or flat amount
alter table public.loads add column if not exists fuel_cost numeric;
alter table public.loads add column if not exists driver_settled boolean not null default false;
alter table public.loads add column if not exists driver_settled_at timestamptz;

-- Computed driver pay for a load, given its plan and carrier net.
create or replace function public.load_driver_pay(p_pay_type text, p_pay_value numeric, p_net numeric)
returns numeric language sql immutable as $$
  select case
    when p_pay_type = 'Percent' then round(coalesce(p_net, 0) * coalesce(p_pay_value, 0) / 100.0, 2)
    when p_pay_type = 'Flat'    then coalesce(p_pay_value, 0)
    else 0
  end;
$$;

-- Carrier sets the driver-pay plan + fuel cost for a load.
create or replace function public.set_load_settlement(
  p_load_id uuid, p_pay_type text, p_pay_value numeric, p_fuel_cost numeric default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;
  if not (
    (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the carrier company can set settlement' using errcode = '42501';
  end if;
  if p_pay_type is not null and p_pay_type not in ('Percent', 'Flat') then
    raise exception 'invalid pay type';
  end if;
  update public.loads
    set driver_pay_type = p_pay_type,
        driver_pay_value = p_pay_value,
        fuel_cost = coalesce(p_fuel_cost, fuel_cost),
        updated_at = now()
    where id = p_load_id;
end;
$$;
grant execute on function public.set_load_settlement(uuid, text, numeric, numeric) to authenticated;

-- Carrier marks a delivered load as settled / unsettled with the driver.
create or replace function public.mark_load_settled(p_load_id uuid, p_settled boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;
  if not (
    (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the carrier company can settle loads' using errcode = '42501';
  end if;
  update public.loads
    set driver_settled = p_settled,
        driver_settled_at = case when p_settled then now() else null end,
        updated_at = now()
    where id = p_load_id;
end;
$$;
grant execute on function public.mark_load_settled(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
