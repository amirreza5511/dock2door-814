-- 0021_channel_fulfillment_push.sql
-- Outbound fulfillment sync for sales channels (Shopify + Amazon).
-- When a local fulfillment_orders / shipments row reaches Shipped, queue a
-- fulfillment_push for the linked channel_orders row. A worker edge function
-- (channel-fulfillment-worker) drains the queue.
-- Idempotent.

-- =====================================================================
-- ENUM: push status
-- =====================================================================
do $$ begin
  create type channel_push_status as enum ('not_required', 'pending', 'synced', 'failed');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- COLUMNS on channel_orders
-- =====================================================================
alter table public.channel_orders
  add column if not exists push_status channel_push_status not null default 'not_required',
  add column if not exists push_attempts int not null default 0,
  add column if not exists push_last_error text,
  add column if not exists push_last_attempt_at timestamptz,
  add column if not exists fulfillment_pushed_at timestamptz,
  add column if not exists tracking_number text,
  add column if not exists tracking_carrier text,
  add column if not exists external_fulfillment_id text;

create index if not exists idx_channel_orders_push_pending
  on public.channel_orders (push_status, push_last_attempt_at)
  where push_status = 'pending' or push_status = 'failed';

-- =====================================================================
-- TRIGGER: when a shipment becomes shippable (label purchased / in transit /
-- delivered), populate the linked channel_order with carrier+tracking and
-- mark it pending for outbound push.
-- =====================================================================
create or replace function public.tg_channel_order_on_shipment_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_co_id uuid;
begin
  -- only act when tracking gets attached or status advances to shipped+
  if (new.status = 'LabelPurchased' or new.status = 'InTransit'
      or new.status = 'OutForDelivery' or new.status = 'Delivered')
     and coalesce(new.tracking_code, '') <> '' then

    -- Resolve channel_order via direct shipment_id link, then via order_id.
    select id into v_co_id from public.channel_orders
      where shipment_id = new.id
      limit 1;

    if v_co_id is null and new.order_id is not null then
      select id into v_co_id from public.channel_orders
        where fulfillment_order_id = new.order_id
        limit 1;
    end if;

    if v_co_id is not null then
      update public.channel_orders
        set tracking_number   = coalesce(tracking_number, new.tracking_code),
            tracking_carrier  = coalesce(tracking_carrier, new.carrier_code),
            shipment_id       = coalesce(shipment_id, new.id),
            push_status       = case
                                  when push_status = 'synced' then 'synced'
                                  else 'pending'::channel_push_status
                                end,
            push_last_error   = null,
            updated_at        = now()
        where id = v_co_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tr_channel_order_on_shipment on public.shipments;
create trigger tr_channel_order_on_shipment
  after update of status, tracking_code on public.shipments
  for each row execute function public.tg_channel_order_on_shipment_change();

-- =====================================================================
-- TRIGGER: when a fulfillment_order flips to 'Shipped', mark channel_order
-- pending even if no shipment row was attached (merchant may have shipped
-- manually outside the carrier flow).
-- =====================================================================
create or replace function public.tg_channel_order_on_order_shipped()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Shipped' and (old.status is distinct from new.status) then
    update public.channel_orders
      set push_status = case
                          when push_status = 'synced' then 'synced'
                          else 'pending'::channel_push_status
                        end,
          push_last_error = null,
          updated_at = now()
      where fulfillment_order_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists tr_channel_order_on_order_shipped on public.fulfillment_orders;
create trigger tr_channel_order_on_order_shipped
  after update of status on public.fulfillment_orders
  for each row execute function public.tg_channel_order_on_order_shipped();

-- =====================================================================
-- RPCs
-- =====================================================================

-- Member-callable: manual retry of a failed push.
create or replace function public.channel_retry_fulfillment_push(p_channel_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.channel_orders where id = p_channel_order_id;
  if v_company is null then raise exception 'not_found'; end if;
  if not (public.is_member_of(v_company) or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.channel_orders
    set push_status     = 'pending',
        push_last_error = null,
        updated_at      = now()
    where id = p_channel_order_id
      and push_status in ('failed', 'pending', 'not_required');

  perform public.write_audit('channel_fulfillment.retry', 'channel_order',
    p_channel_order_id, null, jsonb_build_object('reason', 'manual_retry'), null);
end $$;

grant execute on function public.channel_retry_fulfillment_push(uuid) to authenticated;

-- Service-role only: mark result of a push attempt.
create or replace function public.channel_mark_fulfillment_pushed(
  p_channel_order_id uuid,
  p_success boolean,
  p_external_fulfillment_id text,
  p_error text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden_service_role_only' using errcode = '42501';
  end if;

  update public.channel_orders
    set push_status            = case when p_success then 'synced'::channel_push_status
                                       else 'failed'::channel_push_status end,
        push_attempts          = push_attempts + 1,
        push_last_attempt_at   = now(),
        push_last_error        = case when p_success then null else p_error end,
        external_fulfillment_id = coalesce(p_external_fulfillment_id, external_fulfillment_id),
        fulfillment_pushed_at  = case when p_success then now() else fulfillment_pushed_at end,
        status                 = case when p_success then 'fulfilled'::channel_order_status
                                       else status end,
        updated_at             = now()
    where id = p_channel_order_id;
end $$;

grant execute on function public.channel_mark_fulfillment_pushed(uuid, boolean, text, text) to service_role;

-- Service-role: list pending pushes (used by worker fn).
create or replace function public.channel_list_pending_fulfillment(p_limit int default 25)
returns table (
  channel_order_id uuid,
  connection_id uuid,
  company_id uuid,
  kind sales_channel_kind,
  external_order_id text,
  tracking_number text,
  tracking_carrier text,
  shipment_id uuid,
  push_attempts int
)
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden_service_role_only' using errcode = '42501';
  end if;

  return query
    select co.id, co.connection_id, co.company_id, co.kind, co.external_order_id,
           co.tracking_number, co.tracking_carrier, co.shipment_id, co.push_attempts
    from public.channel_orders co
    where co.push_status in ('pending', 'failed')
      and coalesce(co.tracking_number, '') <> ''
      and co.push_attempts < 6
      and (co.push_last_attempt_at is null
           or co.push_last_attempt_at < now() - interval '2 minutes')
    order by co.push_last_attempt_at nulls first
    limit greatest(coalesce(p_limit, 25), 1);
end $$;

grant execute on function public.channel_list_pending_fulfillment(int) to service_role;
