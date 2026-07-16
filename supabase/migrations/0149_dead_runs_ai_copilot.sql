-- Dock2Door — Dead runs (empty miles), street turns, AI copilot
-- ==========================================================================
-- Additive + idempotent. Builds on 0002 (fleet), 0100 (drayage), 0148 (equipment).
--   1) cost-per-mile on trucks + company default
--   2) street-turn pairing columns on drayage_orders
--   3) haversine helper
--   4) dead-run analytics RPC (empty legs + deadhead gaps, costed per truck)
--   5) street-turn suggestions + link/unlink RPCs
--   6) AI copilot tables: events (alerts/errors), memories, chat history
--   7) AI RPCs: log event, watchdog scan, live context snapshot
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1) COST PER MILE
-- --------------------------------------------------------------------------
alter table public.trucks
  add column if not exists cost_per_mile numeric not null default 0;

alter table public.companies
  add column if not exists default_cost_per_mile numeric not null default 0;

create or replace function public.set_company_cost_per_mile(p_rate numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null or not public.is_member_of(v_company) then
    raise exception 'no company context' using errcode = '42501';
  end if;
  update public.companies set default_cost_per_mile = greatest(0, coalesce(p_rate, 0)) where id = v_company;
end;
$$;
grant execute on function public.set_company_cost_per_mile(numeric) to authenticated;

-- --------------------------------------------------------------------------
-- 2) STREET TURN pairing on drayage_orders
-- --------------------------------------------------------------------------
alter table public.drayage_orders
  add column if not exists street_turn_order_id uuid references public.drayage_orders(id) on delete set null,
  add column if not exists street_turn_role text not null default '',        -- 'provider' (returns empty) | 'receiver' (load picked up)
  add column if not exists street_turn_saved_miles numeric not null default 0,
  add column if not exists street_turn_linked_at timestamptz;

create index if not exists idx_drayage_orders_street_turn on public.drayage_orders(street_turn_order_id);

-- --------------------------------------------------------------------------
-- 3) HAVERSINE (miles); null when any coordinate missing
-- --------------------------------------------------------------------------
create or replace function public.haversine_miles(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric language sql immutable as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else (3958.8 * 2 * asin(least(1::double precision, sqrt(
      power(sin(radians((lat2 - lat1)::double precision / 2)), 2) +
      cos(radians(lat1::double precision)) * cos(radians(lat2::double precision)) *
      power(sin(radians((lng2 - lng1)::double precision / 2)), 2)
    ))))::numeric
  end;
$$;
grant execute on function public.haversine_miles(numeric, numeric, numeric, numeric) to authenticated;

-- --------------------------------------------------------------------------
-- 4) DEAD RUN analytics — empty legs (EmptyReturn/EmptyPickup/YardMove) plus
--    deadhead gaps between consecutive moves of the same driver, costed with
--    the truck's cost_per_mile (fallback: company default, then $2/mi).
-- --------------------------------------------------------------------------
create or replace function public.drayage_dead_runs(p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_default_rate numeric := 2.0;
  v_runs jsonb := '[]'::jsonb;
  v_truck_agg jsonb := '{}'::jsonb;
  v_driver_agg jsonb := '{}'::jsonb;
  v_empty numeric := 0;
  v_dead numeric := 0;
  v_loaded numeric := 0;
  v_cost numeric := 0;
  v_savings_miles numeric := 0;
  r record;
  prev_driver uuid := null;
  prev_tlat numeric := null;
  prev_tlng numeric := null;
  prev_ref text := '';
  v_gap numeric;
  v_move_miles numeric;
  v_is_empty boolean;
  k text;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null or not public.is_member_of(v_company) then
    return jsonb_build_object(
      'summary', jsonb_build_object('empty_miles',0,'deadhead_miles',0,'loaded_miles',0,'dead_cost',0,'pct_empty',0,'savings_miles',0,'savings_cost',0,'default_rate',2.0),
      'runs','[]'::jsonb,'by_truck','{}'::jsonb,'by_driver','{}'::jsonb);
  end if;
  select coalesce(nullif(default_cost_per_mile, 0), 2.0) into v_default_rate from public.companies where id = v_company;

  for r in (
    select m.id,
      m.move_type::text as move_type,
      m.driver_user_id,
      coalesce(m.completed_at, m.delivered_at, m.picked_up_at, m.started_at, m.assigned_at, m.created_at) as t,
      coalesce(nullif(m.from_lat,0), ft.geo_lat) as flat,
      coalesce(nullif(m.from_lng,0), ft.geo_lng) as flng,
      coalesce(nullif(m.to_lat,0), tt.geo_lat) as tlat,
      coalesce(nullif(m.to_lng,0), tt.geo_lng) as tlng,
      o.reference_code as ref,
      coalesce(nullif(tr.plate,''), 'No truck') as truck_plate,
      coalesce(nullif(tr.cost_per_mile, 0), v_default_rate) as rate,
      coalesce(nullif(p.name,''), 'Driver') as driver_name
    from public.drayage_moves m
    join public.drayage_orders o on o.id = m.order_id
    left join public.terminals ft on ft.id = m.from_terminal_id
    left join public.terminals tt on tt.id = m.to_terminal_id
    left join public.trucks tr on tr.id = o.truck_id
    left join public.profiles p on p.id = m.driver_user_id
    where o.drayage_company_id = v_company
      and m.driver_user_id is not null
      and m.status::text not in ('Cancelled')
      and coalesce(m.completed_at, m.delivered_at, m.picked_up_at, m.started_at, m.assigned_at, m.created_at)
          >= now() - make_interval(days => greatest(1, coalesce(p_days, 7)))
    order by m.driver_user_id, t asc
  ) loop
    v_is_empty := r.move_type in ('EmptyReturn','EmptyPickup','YardMove');

    -- Deadhead: gap between the previous move's end and this move's start (same driver)
    if prev_driver is not null and prev_driver = r.driver_user_id then
      v_gap := public.haversine_miles(prev_tlat, prev_tlng, r.flat, r.flng);
      if v_gap is not null and v_gap >= 0.5 then
        v_dead := v_dead + v_gap;
        v_cost := v_cost + v_gap * r.rate;
        k := r.truck_plate;
        v_truck_agg := jsonb_set(v_truck_agg, array[k], jsonb_build_object(
          'miles', round(coalesce((v_truck_agg->k->>'miles')::numeric,0) + v_gap, 1),
          'cost',  round(coalesce((v_truck_agg->k->>'cost')::numeric,0) + v_gap * r.rate, 2)));
        k := r.driver_name;
        v_driver_agg := jsonb_set(v_driver_agg, array[k], jsonb_build_object(
          'miles', round(coalesce((v_driver_agg->k->>'miles')::numeric,0) + v_gap, 1),
          'cost',  round(coalesce((v_driver_agg->k->>'cost')::numeric,0) + v_gap * r.rate, 2)));
        if jsonb_array_length(v_runs) < 60 then
          v_runs := v_runs || jsonb_build_object(
            'kind','deadhead','miles', round(v_gap,1),'cost', round(v_gap * r.rate,2),
            'driver', r.driver_name,'truck', r.truck_plate,'from_ref', prev_ref,'to_ref', r.ref,'at', r.t);
        end if;
      end if;
    end if;

    -- The move's own distance: empty legs count as dead-run miles, revenue legs as loaded
    v_move_miles := public.haversine_miles(r.flat, r.flng, r.tlat, r.tlng);
    if v_move_miles is not null and v_move_miles >= 0.2 then
      if v_is_empty then
        v_empty := v_empty + v_move_miles;
        v_cost := v_cost + v_move_miles * r.rate;
        k := r.truck_plate;
        v_truck_agg := jsonb_set(v_truck_agg, array[k], jsonb_build_object(
          'miles', round(coalesce((v_truck_agg->k->>'miles')::numeric,0) + v_move_miles, 1),
          'cost',  round(coalesce((v_truck_agg->k->>'cost')::numeric,0) + v_move_miles * r.rate, 2)));
        k := r.driver_name;
        v_driver_agg := jsonb_set(v_driver_agg, array[k], jsonb_build_object(
          'miles', round(coalesce((v_driver_agg->k->>'miles')::numeric,0) + v_move_miles, 1),
          'cost',  round(coalesce((v_driver_agg->k->>'cost')::numeric,0) + v_move_miles * r.rate, 2)));
        if jsonb_array_length(v_runs) < 60 then
          v_runs := v_runs || jsonb_build_object(
            'kind','empty_leg','move_type', r.move_type,'miles', round(v_move_miles,1),'cost', round(v_move_miles * r.rate,2),
            'driver', r.driver_name,'truck', r.truck_plate,'ref', r.ref,'at', r.t);
        end if;
      else
        v_loaded := v_loaded + v_move_miles;
      end if;
    end if;

    prev_driver := r.driver_user_id;
    if r.tlat is not null then prev_tlat := r.tlat; prev_tlng := r.tlng; end if;
    prev_ref := r.ref;
  end loop;

  -- Estimated savings from street turns linked in the window
  select coalesce(sum(street_turn_saved_miles), 0) into v_savings_miles
  from public.drayage_orders
  where drayage_company_id = v_company
    and street_turn_role = 'provider'
    and street_turn_linked_at >= now() - make_interval(days => greatest(1, coalesce(p_days, 7)));

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'empty_miles', round(v_empty, 1),
      'deadhead_miles', round(v_dead, 1),
      'loaded_miles', round(v_loaded, 1),
      'dead_cost', round(v_cost, 2),
      'pct_empty', case when (v_empty + v_dead + v_loaded) > 0
        then round((v_empty + v_dead) / (v_empty + v_dead + v_loaded) * 100, 0) else 0 end,
      'savings_miles', round(v_savings_miles, 1),
      'savings_cost', round(v_savings_miles * v_default_rate, 2),
      'default_rate', v_default_rate),
    'runs', v_runs,
    'by_truck', v_truck_agg,
    'by_driver', v_driver_agg);
end;
$$;
grant execute on function public.drayage_dead_runs(int) to authenticated;

-- --------------------------------------------------------------------------
-- 5) STREET TURN suggestions + link / unlink
-- --------------------------------------------------------------------------
create or replace function public.drayage_street_turn_suggestions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_rate numeric := 2.0;
  v_out jsonb := '[]'::jsonb;
  v_saved numeric;
  r record;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null or not public.is_member_of(v_company) then return v_out; end if;
  select coalesce(nullif(default_cost_per_mile, 0), 2.0) into v_rate from public.companies where id = v_company;

  for r in (
    select
      po.id as provider_id, po.reference_code as provider_ref, po.container_number as provider_container,
      ro.id as receiver_id, ro.reference_code as receiver_ref, ro.container_number as receiver_container,
      coalesce(nullif(t1.name,''), nullif(t2.name,''), 'Same terminal') as terminal_name,
      coalesce(nullif(pm.to_lat,0), t1.geo_lat) as term_lat,
      coalesce(nullif(pm.to_lng,0), t1.geo_lng) as term_lng,
      coalesce(nullif(pm.from_lat,0), nullif(po.delivery_lat,0)) as src_lat,
      coalesce(nullif(pm.from_lng,0), nullif(po.delivery_lng,0)) as src_lng
    from public.drayage_moves pm
    join public.drayage_orders po on po.id = pm.order_id
    left join public.terminals t1 on t1.id = pm.to_terminal_id
    join public.drayage_moves rm
      on rm.move_type::text in ('Pickup','EmptyPickup')
     and rm.status::text = 'Pending'
     and rm.driver_user_id is null
    join public.drayage_orders ro on ro.id = rm.order_id and ro.id <> po.id
    left join public.terminals t2 on t2.id = rm.from_terminal_id
    where pm.move_type::text = 'EmptyReturn'
      and pm.status::text in ('Pending','Assigned')
      and po.drayage_company_id = v_company
      and ro.drayage_company_id = v_company
      and po.street_turn_order_id is null
      and ro.street_turn_order_id is null
      and po.status::text not in ('Cancelled','EmptyReturned')
      and ro.status::text not in ('Cancelled','Delivered','EmptyReturned')
      and (
        (pm.to_terminal_id is not null and pm.to_terminal_id = rm.from_terminal_id)
        or coalesce(public.haversine_miles(
             coalesce(nullif(pm.to_lat,0), t1.geo_lat), coalesce(nullif(pm.to_lng,0), t1.geo_lng),
             coalesce(nullif(rm.from_lat,0), t2.geo_lat), coalesce(nullif(rm.from_lng,0), t2.geo_lng)), 1e9) <= 5
      )
    limit 20
  ) loop
    v_saved := round(coalesce(public.haversine_miles(r.src_lat, r.src_lng, r.term_lat, r.term_lng), 0), 1);
    v_out := v_out || jsonb_build_object(
      'provider_order_id', r.provider_id, 'provider_ref', r.provider_ref, 'provider_container', r.provider_container,
      'receiver_order_id', r.receiver_id, 'receiver_ref', r.receiver_ref, 'receiver_container', r.receiver_container,
      'terminal', r.terminal_name, 'saved_miles', v_saved, 'saved_cost', round(v_saved * v_rate, 2));
  end loop;
  return v_out;
end;
$$;
grant execute on function public.drayage_street_turn_suggestions() to authenticated;

create or replace function public.link_street_turn(p_provider_order_id uuid, p_receiver_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p public.drayage_orders;
  v_r public.drayage_orders;
  v_saved numeric := 0;
  v_term_lat numeric;
  v_term_lng numeric;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_provider_order_id = p_receiver_order_id then raise exception 'cannot pair an order with itself'; end if;
  select * into v_p from public.drayage_orders where id = p_provider_order_id for update;
  if v_p is null then raise exception 'provider order not found'; end if;
  select * into v_r from public.drayage_orders where id = p_receiver_order_id for update;
  if v_r is null then raise exception 'receiver order not found'; end if;
  perform public.assert_drayage_owner(v_p);
  perform public.assert_drayage_owner(v_r);
  if v_p.street_turn_order_id is not null or v_r.street_turn_order_id is not null then
    raise exception 'one of these orders is already paired';
  end if;

  -- Estimated empty backhaul avoided: consignee (empty origin) -> return terminal
  select coalesce(nullif(m.to_lat,0), t.geo_lat), coalesce(nullif(m.to_lng,0), t.geo_lng)
    into v_term_lat, v_term_lng
  from public.drayage_moves m
  left join public.terminals t on t.id = m.to_terminal_id
  where m.order_id = v_p.id and m.move_type::text = 'EmptyReturn'
  order by m.sequence desc limit 1;

  v_saved := round(coalesce(public.haversine_miles(
    nullif(v_p.delivery_lat,0), nullif(v_p.delivery_lng,0), v_term_lat, v_term_lng), 0), 1);

  update public.drayage_orders set
    street_turn_order_id = v_r.id, street_turn_role = 'provider',
    street_turn_saved_miles = v_saved, street_turn_linked_at = now(), updated_at = now()
  where id = v_p.id;

  update public.drayage_orders set
    street_turn_order_id = v_p.id, street_turn_role = 'receiver',
    street_turn_saved_miles = 0, street_turn_linked_at = now(), updated_at = now()
  where id = v_r.id;

  perform public.write_audit('drayage_order.street_turn_linked', 'drayage_orders', v_p.id::text, null,
    jsonb_build_object('receiver', v_r.id, 'saved_miles', v_saved), '');
end;
$$;
grant execute on function public.link_street_turn(uuid, uuid) to authenticated;

create or replace function public.unlink_street_turn(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_o public.drayage_orders; v_other uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_o from public.drayage_orders where id = p_order_id for update;
  if v_o is null then raise exception 'order not found'; end if;
  perform public.assert_drayage_owner(v_o);
  v_other := v_o.street_turn_order_id;
  update public.drayage_orders set
    street_turn_order_id = null, street_turn_role = '', street_turn_saved_miles = 0,
    street_turn_linked_at = null, updated_at = now()
  where id = p_order_id or (v_other is not null and id = v_other);
end;
$$;
grant execute on function public.unlink_street_turn(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 6) AI COPILOT tables
-- --------------------------------------------------------------------------
create table if not exists public.ai_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,   -- null => user-scoped
  user_id uuid references public.profiles(id) on delete set null,
  source text not null default 'watchdog',   -- watchdog | app_error | assistant | system
  kind text not null default 'alert',        -- alert | error | suggestion | info
  severity text not null default 'medium',   -- low | medium | high | critical
  title text not null,
  body text not null default '',
  entity_type text not null default '',
  entity_id text not null default '',
  dedupe_key text not null default '',
  status text not null default 'open',       -- open | resolved | dismissed
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_ai_events_company on public.ai_events(company_id, status, created_at desc);
create index if not exists idx_ai_events_user on public.ai_events(user_id, created_at desc);
create index if not exists idx_ai_events_dedupe on public.ai_events(company_id, dedupe_key);

alter table public.ai_events enable row level security;
drop policy if exists "ai_events_read" on public.ai_events;
create policy "ai_events_read" on public.ai_events for select using (
  public.is_admin() or user_id = auth.uid() or (company_id is not null and public.is_member_of(company_id))
);
drop policy if exists "ai_events_insert" on public.ai_events;
create policy "ai_events_insert" on public.ai_events for insert with check (
  public.is_admin() or user_id = auth.uid() or (company_id is not null and public.is_member_of(company_id))
);
drop policy if exists "ai_events_update" on public.ai_events;
create policy "ai_events_update" on public.ai_events for update using (
  public.is_admin() or user_id = auth.uid() or (company_id is not null and public.is_member_of(company_id))
);

create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_memories_user on public.ai_memories(user_id, created_at desc);

alter table public.ai_memories enable row level security;
drop policy if exists "ai_memories_owner" on public.ai_memories;
create policy "ai_memories_owner" on public.ai_memories for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'user',         -- user | assistant
  content text not null,
  actions jsonb not null default '[]'::jsonb, -- proposed copilot actions attached to an assistant reply
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_chat_user on public.ai_chat_messages(user_id, created_at asc);

alter table public.ai_chat_messages enable row level security;
drop policy if exists "ai_chat_owner" on public.ai_chat_messages;
create policy "ai_chat_owner" on public.ai_chat_messages for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- 7) AI RPCs
-- --------------------------------------------------------------------------

-- Log a single event (app error, assistant note). Dedupes on open events.
create or replace function public.ai_log_event(
  p_kind text,
  p_severity text,
  p_title text,
  p_body text default '',
  p_entity_type text default '',
  p_entity_id text default '',
  p_dedupe_key text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_id uuid;
begin
  if auth.uid() is null then return null; end if;
  select company_id into v_company from public.profiles where id = auth.uid();
  if coalesce(p_dedupe_key, '') <> '' and exists (
    select 1 from public.ai_events
    where dedupe_key = p_dedupe_key and status = 'open'
      and (company_id = v_company or (company_id is null and user_id = auth.uid()))
  ) then
    return null;
  end if;
  insert into public.ai_events (company_id, user_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  values (
    v_company, auth.uid(),
    case when coalesce(p_kind,'') = 'error' then 'app_error' else 'assistant' end,
    coalesce(nullif(p_kind,''), 'info'),
    coalesce(nullif(p_severity,''), 'medium'),
    left(coalesce(nullif(p_title,''), '(untitled)'), 200),
    left(coalesce(p_body,''), 2000),
    coalesce(p_entity_type,''), coalesce(p_entity_id,''), coalesce(p_dedupe_key,''))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.ai_log_event(text, text, text, text, text, text, text) to authenticated;

-- Watchdog: scan the caller's company operation and record findings as open
-- events. Deduped per finding per day. Returns the number of new events.
create or replace function public.ai_run_watchdog()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_total int := 0;
  v_n int;
  v_st jsonb;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null or not public.is_member_of(v_company) then return 0; end if;

  -- a) Free-day deadlines: per diem
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'alert',
    case when o.per_diem_last_free_day < current_date then 'critical' else 'high' end,
    case when o.per_diem_last_free_day < current_date then 'Per diem accruing — ' else 'Per diem deadline near — ' end || o.reference_code,
    'Last free day ' || o.per_diem_last_free_day::text ||
      case when o.per_diem_last_free_day < current_date
        then '. ~$' || round(greatest(0, (current_date - o.per_diem_last_free_day)) * o.per_diem_daily_rate)::text
          || ' accrued at $' || o.per_diem_daily_rate::text || '/day. Return the empty ASAP or pair a street turn.'
        else '. ' || (o.per_diem_last_free_day - current_date)::text || ' day(s) left — plan the empty return now.' end,
    'drayage_orders', o.id::text, 'lfd:per_diem:' || o.id::text || ':' || current_date::text
  from public.drayage_orders o
  where o.drayage_company_id = v_company
    and o.status::text not in ('Cancelled','EmptyReturned')
    and o.per_diem_last_free_day is not null
    and o.per_diem_last_free_day <= current_date + 2
    and not exists (select 1 from public.ai_events e where e.company_id = v_company
      and e.dedupe_key = 'lfd:per_diem:' || o.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- a2) demurrage
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'alert',
    case when o.demurrage_last_free_day < current_date then 'critical' else 'high' end,
    case when o.demurrage_last_free_day < current_date then 'Demurrage accruing — ' else 'Demurrage deadline near — ' end || o.reference_code,
    'Last free day ' || o.demurrage_last_free_day::text ||
      case when o.demurrage_last_free_day < current_date
        then '. ~$' || round(greatest(0, (current_date - o.demurrage_last_free_day)) * o.demurrage_daily_rate)::text
          || ' accrued at $' || o.demurrage_daily_rate::text || '/day. Pull the container out of the terminal ASAP.'
        else '. ' || (o.demurrage_last_free_day - current_date)::text || ' day(s) left — book a pickup appointment or pre-pull.' end,
    'drayage_orders', o.id::text, 'lfd:demurrage:' || o.id::text || ':' || current_date::text
  from public.drayage_orders o
  where o.drayage_company_id = v_company
    and o.status::text not in ('Cancelled','Delivered','EmptyReturned')
    and o.demurrage_last_free_day is not null
    and o.demurrage_last_free_day <= current_date + 2
    and not exists (select 1 from public.ai_events e where e.company_id = v_company
      and e.dedupe_key = 'lfd:demurrage:' || o.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- a3) storage
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'alert',
    case when o.storage_last_free_day < current_date then 'critical' else 'high' end,
    case when o.storage_last_free_day < current_date then 'Storage accruing — ' else 'Storage deadline near — ' end || o.reference_code,
    'Last free day ' || o.storage_last_free_day::text ||
      case when o.storage_last_free_day < current_date
        then '. ~$' || round(greatest(0, (current_date - o.storage_last_free_day)) * o.storage_daily_rate)::text
          || ' accrued at $' || o.storage_daily_rate::text || '/day.'
        else '. ' || (o.storage_last_free_day - current_date)::text || ' day(s) left.' end,
    'drayage_orders', o.id::text, 'lfd:storage:' || o.id::text || ':' || current_date::text
  from public.drayage_orders o
  where o.drayage_company_id = v_company
    and o.status::text not in ('Cancelled')
    and o.storage_last_free_day is not null
    and o.storage_last_free_day <= current_date + 2
    and not exists (select 1 from public.ai_events e where e.company_id = v_company
      and e.dedupe_key = 'lfd:storage:' || o.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- b) Moves with an appointment today/tomorrow and no driver
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'alert', 'high',
    'Move needs a driver — ' || o.reference_code,
    m.move_type::text || ' appointment ' || m.appt_date::text ||
      coalesce(' ' || nullif(m.appt_time,''), '') || ' has no driver assigned. Dispatch someone now.',
    'drayage_moves', m.id::text, 'unassigned:' || m.id::text || ':' || current_date::text
  from public.drayage_moves m
  join public.drayage_orders o on o.id = m.order_id
  where o.drayage_company_id = v_company
    and m.status::text = 'Pending' and m.driver_user_id is null
    and m.appt_date is not null and m.appt_date <= current_date + 1
    and o.status::text not in ('Cancelled','Delivered','EmptyReturned')
    and not exists (select 1 from public.ai_events e where e.company_id = v_company
      and e.dedupe_key = 'unassigned:' || m.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- c) Dispatched orders without a chassis (bobtail risk)
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'alert', 'medium',
    'No chassis assigned — ' || o.reference_code,
    'Order is ' || o.status::text || ' but has no chassis linked. Assign equipment so the container can move.',
    'drayage_orders', o.id::text, 'nochassis:' || o.id::text || ':' || current_date::text
  from public.drayage_orders o
  where o.drayage_company_id = v_company
    and o.status::text in ('Dispatched','EnRoute','PickedUp','InTransit')
    and o.chassis_id is null
    and not exists (select 1 from public.ai_events e where e.company_id = v_company
      and e.dedupe_key = 'nochassis:' || o.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- d) Delivered imports where the empty (MT) hasn't been reported for 12h+
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'alert', 'medium',
    'Empty not reported — ' || o.reference_code,
    'Delivered ' || to_char(o.delivered_at, 'Mon DD HH24:MI') || ' but no MT container reported yet. Per diem keeps running until the empty goes back.',
    'drayage_orders', o.id::text, 'mt:' || o.id::text || ':' || current_date::text
  from public.drayage_orders o
  where o.drayage_company_id = v_company
    and o.direction::text = 'Import'
    and o.status::text = 'Delivered'
    and o.mt_reported_at is null
    and o.delivered_at is not null and o.delivered_at < now() - interval '12 hours'
    and not exists (select 1 from public.ai_events e where e.company_id = v_company
      and e.dedupe_key = 'mt:' || o.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- e) Rental equipment past its return date
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'alert', 'high',
    'Rental overdue — ' || x.label,
    'Return date ' || x.return_date::text || ' passed. ~$' ||
      round(greatest(0, (current_date - x.return_date)) * x.daily_rate)::text ||
      ' extra at $' || x.daily_rate::text || '/day. Return it or extend the rental.',
    x.entity, x.id::text, 'rental:' || x.entity || ':' || x.id::text || ':' || current_date::text
  from (
    select c.id, 'chassis'::text as entity, 'Chassis ' || c.chassis_number as label, c.rental_return_date as return_date, c.rental_daily_rate as daily_rate
    from public.chassis c
    where c.company_id = v_company and c.is_rental and c.archived_at is null
      and c.rental_return_date is not null and c.rental_return_date < current_date
    union all
    select t.id, 'trailers'::text, 'Trailer ' || t.plate, t.rental_return_date, t.rental_daily_rate
    from public.trailers t
    where t.company_id = v_company and t.is_rental and t.archived_at is null
      and t.rental_return_date is not null and t.rental_return_date < current_date
  ) x
  where not exists (select 1 from public.ai_events e where e.company_id = v_company
    and e.dedupe_key = 'rental:' || x.entity || ':' || x.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- f) Equipment dropped for 3+ days
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'alert', 'medium',
    'Equipment sitting dropped — ' || x.label,
    'Dropped ' || coalesce(nullif(x.place,''), 'at an unknown location') || ' since ' || to_char(x.since, 'Mon DD') || '. Pick it up or put it to work.',
    x.entity, x.id::text, 'dropped:' || x.entity || ':' || x.id::text || ':' || current_date::text
  from (
    select c.id, 'chassis'::text as entity, 'Chassis ' || c.chassis_number as label, c.dropped_label as place, c.dropped_at as since
    from public.chassis c
    where c.company_id = v_company and c.is_dropped and c.archived_at is null
      and c.dropped_at is not null and c.dropped_at < now() - interval '72 hours'
    union all
    select t.id, 'trailers'::text, 'Trailer ' || t.plate, t.dropped_label, t.dropped_at
    from public.trailers t
    where t.company_id = v_company and t.is_dropped and t.archived_at is null
      and t.dropped_at is not null and t.dropped_at < now() - interval '72 hours'
  ) x
  where not exists (select 1 from public.ai_events e where e.company_id = v_company
    and e.dedupe_key = 'dropped:' || x.entity || ':' || x.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- g) Pre-pull suggestion: demurrage LFD close, no port reservation, not prepull
  insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
  select v_company, 'watchdog', 'suggestion', 'medium',
    'Consider a pre-pull — ' || o.reference_code,
    'Demurrage last free day is ' || o.demurrage_last_free_day::text ||
      ' and there is no port reservation yet. Pre-pull to your yard to stop demurrage.',
    'drayage_orders', o.id::text, 'prepull:' || o.id::text || ':' || current_date::text
  from public.drayage_orders o
  where o.drayage_company_id = v_company
    and o.direction::text = 'Import'
    and o.is_prepull = false
    and o.port_reservation_date is null
    and o.status::text in ('Open','Assigned','Dispatched')
    and o.demurrage_last_free_day is not null
    and o.demurrage_last_free_day between current_date and current_date + 2
    and not exists (select 1 from public.ai_events e where e.company_id = v_company
      and e.dedupe_key = 'prepull:' || o.id::text || ':' || current_date::text);
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- h) Street-turn opportunities available
  v_st := public.drayage_street_turn_suggestions();
  if jsonb_array_length(v_st) > 0 and not exists (
    select 1 from public.ai_events e where e.company_id = v_company
      and e.dedupe_key = 'streetturns:' || current_date::text and e.status = 'open'
  ) then
    insert into public.ai_events (company_id, source, kind, severity, title, body, entity_type, entity_id, dedupe_key)
    values (v_company, 'watchdog', 'suggestion', 'medium',
      jsonb_array_length(v_st)::text || ' street-turn pairing(s) available',
      'Pair empty returns with waiting pickups in Dispatch — one loaded round trip instead of two dead runs.',
      '', '', 'streetturns:' || current_date::text);
    v_total := v_total + 1;
  end if;

  return v_total;
end;
$$;
grant execute on function public.ai_run_watchdog() to authenticated;

-- Live context snapshot for the copilot system prompt (role-aware, compact).
create or replace function public.ai_copilot_context()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text; v_name text; v_company uuid; v_company_name text;
  v_ctx jsonb;
  v_orders jsonb; v_moves jsonb; v_drivers jsonb; v_trucks jsonb; v_chassis jsonb;
  v_events jsonb; v_st jsonb; v_dead jsonb; v_my_moves jsonb; v_my_orders jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;
  select role::text, name, company_id into v_role, v_name, v_company from public.profiles where id = v_uid;
  if v_company is not null then
    select name into v_company_name from public.companies where id = v_company;
  end if;
  v_ctx := jsonb_build_object(
    'today', current_date, 'role', coalesce(v_role,'guest'),
    'userName', coalesce(v_name,''), 'companyName', coalesce(v_company_name,''));

  if v_company is not null and public.is_member_of(v_company) then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_orders from (
      select jsonb_build_object(
        'orderId', o.id, 'ref', o.reference_code, 'status', o.status, 'direction', o.direction,
        'container', o.container_number, 'size', o.container_size,
        'perDiemLfd', o.per_diem_last_free_day, 'demurrageLfd', o.demurrage_last_free_day,
        'storageLfd', o.storage_last_free_day, 'hasChassis', o.chassis_id is not null,
        'streetTurn', nullif(o.street_turn_role,''), 'price', o.total_price) as x
      from public.drayage_orders o
      where o.drayage_company_id = v_company
        and o.status::text not in ('Cancelled','EmptyReturned','Delivered')
      order by o.created_at desc limit 25) s;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_moves from (
      select jsonb_build_object(
        'moveId', m.id, 'orderRef', o.reference_code, 'type', m.move_type,
        'status', m.status, 'appt', m.appt_date) as x
      from public.drayage_moves m
      join public.drayage_orders o on o.id = m.order_id
      where o.drayage_company_id = v_company
        and m.status::text = 'Pending' and m.driver_user_id is null
        and o.status::text not in ('Cancelled')
      order by m.appt_date nulls last limit 25) s;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_drivers from (
      select jsonb_build_object('name', d.name, 'driverUserId', d.data->>'userId', 'status', d.status) as x
      from public.drivers d
      where d.company_id = v_company and d.archived_at is null and d.status::text <> 'PendingApproval'
      limit 30) s;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_trucks from (
      select jsonb_build_object('truckId', t.id, 'plate', t.plate, 'costPerMile', t.cost_per_mile) as x
      from public.trucks t where t.company_id = v_company and t.archived_at is null limit 30) s;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_chassis from (
      select jsonb_build_object(
        'chassisId', c.id, 'number', c.chassis_number, 'dropped', c.is_dropped,
        'rental', c.is_rental, 'attached', c.current_truck_id is not null) as x
      from public.chassis c where c.company_id = v_company and c.archived_at is null limit 30) s;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_events from (
      select jsonb_build_object('title', e.title, 'severity', e.severity, 'kind', e.kind) as x
      from public.ai_events e
      where e.company_id = v_company and e.status = 'open'
      order by e.created_at desc limit 10) s;

    v_st := public.drayage_street_turn_suggestions();
    v_dead := public.drayage_dead_runs(7);

    v_ctx := v_ctx || jsonb_build_object(
      'orders', v_orders, 'unassignedMoves', v_moves, 'drivers', v_drivers,
      'trucks', v_trucks, 'chassis', v_chassis, 'openAlerts', v_events,
      'streetTurnSuggestions', v_st, 'deadRuns7d', coalesce(v_dead->'summary', '{}'::jsonb));
  end if;

  -- Driver context (their own active moves)
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_my_moves from (
    select jsonb_build_object(
      'moveId', m.id, 'type', m.move_type, 'status', m.status,
      'appt', m.appt_date, 'ref', o.reference_code) as x
    from public.drayage_moves m
    join public.drayage_orders o on o.id = m.order_id
    where m.driver_user_id = v_uid and m.status::text not in ('Completed')
    order by m.updated_at desc limit 15) s;
  if jsonb_array_length(v_my_moves) > 0 then
    v_ctx := v_ctx || jsonb_build_object('myMoves', v_my_moves);
  end if;

  -- Customer context (their own orders)
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_my_orders from (
    select jsonb_build_object('ref', o.reference_code, 'status', o.status, 'container', o.container_number) as x
    from public.drayage_orders o
    where o.customer_user_id = v_uid and o.status::text not in ('Cancelled')
    order by o.created_at desc limit 10) s;
  if jsonb_array_length(v_my_orders) > 0 then
    v_ctx := v_ctx || jsonb_build_object('myOrders', v_my_orders);
  end if;

  return v_ctx;
end;
$$;
grant execute on function public.ai_copilot_context() to authenticated;

notify pgrst, 'reload schema';
