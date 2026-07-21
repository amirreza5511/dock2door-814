-- =========================================================================
-- 0165 — Live parcel labels (Shippo / EasyPost)
-- Idempotent & additive. Safe to run multiple times.
--
-- Upgrades the consumer parcel flow from placeholder rates to real carrier
-- rate-shopping + label purchase via edge functions (parcel-rate-shop /
-- parcel-buy-label). This migration adds the columns + RPC used to persist a
-- purchased label back onto a parcel_shipments row.
-- =========================================================================

-- ─── 1) Columns for the purchased label ──────────────────────────────────────
alter table public.parcel_shipments
  add column if not exists carrier_code text not null default '';
alter table public.parcel_shipments
  add column if not exists carrier_shipment_id text not null default '';
alter table public.parcel_shipments
  add column if not exists label_format text not null default 'PDF';
alter table public.parcel_shipments
  add column if not exists rate_raw jsonb not null default '{}'::jsonb;

-- ─── 2) Allow 'live' as a rate source ────────────────────────────────────────
do $$
begin
  alter table public.parcel_shipments drop constraint if exists parcel_shipments_rate_source_check;
  alter table public.parcel_shipments
    add constraint parcel_shipments_rate_source_check
    check (rate_source in ('placeholder','canada_post','live'));
exception when others then null;
end $$;

-- ─── 3) Attach a purchased label to a parcel shipment ────────────────────────
-- Called by the parcel-buy-label edge function (service role) after a carrier
-- returns a real tracking number + label URL. Overwrites the placeholder.
create or replace function public.parcel_attach_label(
  p_id uuid,
  p_carrier_code text,
  p_tracking text,
  p_label_url text,
  p_label_format text,
  p_carrier_shipment_id text,
  p_price numeric,
  p_currency text,
  p_rate_raw jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.parcel_shipments;
begin
  select * into v_row from public.parcel_shipments where id = p_id for update;
  if v_row is null then raise exception 'Parcel not found' using errcode='P0002'; end if;
  if not (public.is_member_of(v_row.customer_company_id) or public.is_admin()) then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  update public.parcel_shipments set
    carrier_code = coalesce(nullif(trim(p_carrier_code),''), carrier_code),
    tracking_number = coalesce(nullif(trim(p_tracking),''), tracking_number),
    label_url = coalesce(nullif(trim(p_label_url),''), label_url),
    label_format = coalesce(nullif(trim(p_label_format),''), label_format),
    carrier_shipment_id = coalesce(nullif(trim(p_carrier_shipment_id),''), carrier_shipment_id),
    price = case when p_price is not null and p_price > 0 then p_price else price end,
    currency = coalesce(nullif(trim(p_currency),''), currency),
    rate_raw = coalesce(p_rate_raw, rate_raw),
    rate_source = 'live',
    is_placeholder = false,
    updated_at = now()
  where id = p_id;
end;
$$;
grant execute on function public.parcel_attach_label(
  uuid, text, text, text, text, text, numeric, text, jsonb
) to authenticated;
