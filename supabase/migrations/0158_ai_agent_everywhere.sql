-- 0158_ai_agent_everywhere.sql
-- The AI copilot becomes a role-aware agent for every user:
--   * support_tickets — human-handoff tickets filed by the AI (admin inbox).
--   * ai_forward_intake — open a chat thread with a provider company and
--     deliver an AI-prepared intake summary (guest insurance intake,
--     freight-forwarder coordination, etc.).
--   * ai_list_provider_companies — approved provider directory for matching.
--   * ai_copilot_context() — extended with role-specific live data blocks
--     (employer shifts + past workers, worker assignments, loads, providers).
-- Additive and idempotent. No enum changes.

-- =========================================================================
-- 1) support_tickets
-- =========================================================================
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  subject text not null,
  summary text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  thread_id uuid references public.chat_threads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_user on public.support_tickets(user_id);
create index if not exists idx_support_tickets_status on public.support_tickets(status);

alter table public.support_tickets enable row level security;

drop policy if exists "tickets_read_own" on public.support_tickets;
create policy "tickets_read_own" on public.support_tickets
  for select using (user_id = auth.uid() or public.is_admin());

-- Writes go through SECURITY DEFINER RPCs only (no insert/update policies).

-- Create a ticket: opens (or reuses) the caller's Support thread, escalates it
-- to humans, posts the AI summary into the thread, and files the ticket row.
create or replace function public.create_support_ticket(p_subject text, p_summary text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_thread uuid;
  v_ticket uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'Ticket subject required';
  end if;

  select company_id into v_company from public.profiles where id = v_uid;

  v_thread := public.open_support_thread();
  perform public.escalate_support_thread(v_thread);

  insert into public.thread_messages (thread_id, sender_user_id, body, author_kind)
  values (
    v_thread, v_uid,
    '🎫 Support ticket: ' || trim(p_subject) ||
      case when coalesce(trim(p_summary), '') <> '' then E'\n\n' || trim(p_summary) else '' end,
    'ai'
  );

  insert into public.support_tickets (user_id, company_id, subject, summary, thread_id)
  values (v_uid, v_company, trim(p_subject), coalesce(trim(p_summary), ''), v_thread)
  returning id into v_ticket;

  update public.chat_threads set updated_at = now() where id = v_thread;

  return jsonb_build_object('ticketId', v_ticket, 'threadId', v_thread);
end;
$$;
grant execute on function public.create_support_ticket(text, text) to authenticated;

-- List tickets: 'mine' for the requester, 'all' for admins.
create or replace function public.list_support_tickets(p_scope text default 'mine')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_scope = 'all' then
    if not public.is_admin() then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(x order by (x->>'createdAt') desc), '[]'::jsonb) into v_out from (
      select jsonb_build_object(
        'id', t.id, 'subject', t.subject, 'summary', t.summary, 'status', t.status,
        'threadId', t.thread_id, 'createdAt', t.created_at, 'updatedAt', t.updated_at,
        'requesterId', t.user_id, 'requesterName', coalesce(p.name, ''),
        'requesterEmail', coalesce(p.email, ''), 'companyName', coalesce(c.name, '')
      ) as x
      from public.support_tickets t
      join public.profiles p on p.id = t.user_id
      left join public.companies c on c.id = t.company_id
      order by t.created_at desc
      limit 200
    ) s;
  else
    select coalesce(jsonb_agg(x order by (x->>'createdAt') desc), '[]'::jsonb) into v_out from (
      select jsonb_build_object(
        'id', t.id, 'subject', t.subject, 'summary', t.summary, 'status', t.status,
        'threadId', t.thread_id, 'createdAt', t.created_at, 'updatedAt', t.updated_at
      ) as x
      from public.support_tickets t
      where t.user_id = v_uid
      order by t.created_at desc
      limit 50
    ) s;
  end if;

  return v_out;
end;
$$;
grant execute on function public.list_support_tickets(text) to authenticated;

-- Update ticket status: owner or admin.
create or replace function public.set_support_ticket_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_status not in ('open','in_progress','resolved') then
    raise exception 'Invalid ticket status: %', p_status;
  end if;
  update public.support_tickets
     set status = p_status, updated_at = now()
   where id = p_id and (user_id = auth.uid() or public.is_admin());
  if not found then
    raise exception 'Ticket not found or not authorized' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.set_support_ticket_status(uuid, text) to authenticated;

-- =========================================================================
-- 2) ai_forward_intake — deliver an AI-prepared package to a provider company
-- =========================================================================
create or replace function public.ai_forward_intake(
  p_target_company_id uuid,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread uuid;
  r record;
  v_members int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Message body required';
  end if;
  if not exists (
    select 1 from public.companies c
    where c.id = p_target_company_id and c.status = 'Approved'
  ) then
    raise exception 'Target company not found or not approved';
  end if;

  insert into public.chat_threads (scope, company_id, subject, created_by)
  values ('Direct', p_target_company_id, coalesce(nullif(trim(p_subject), ''), 'New request'), v_uid)
  returning id into v_thread;

  insert into public.thread_participants (thread_id, user_id)
  values (v_thread, v_uid)
  on conflict (thread_id, user_id) do nothing;

  for r in
    select id from public.profiles
    where company_id = p_target_company_id and status = 'Active'
    limit 20
  loop
    insert into public.thread_participants (thread_id, user_id)
    values (v_thread, r.id)
    on conflict (thread_id, user_id) do nothing;
    v_members := v_members + 1;
  end loop;

  if v_members = 0 then
    raise exception 'The target company has no active members to receive the request';
  end if;

  insert into public.thread_messages (thread_id, sender_user_id, body, author_kind)
  values (v_thread, v_uid, trim(p_body), 'user');

  update public.chat_threads set updated_at = now() where id = v_thread;

  return v_thread;
end;
$$;
grant execute on function public.ai_forward_intake(uuid, text, text) to authenticated;

-- =========================================================================
-- 3) ai_list_provider_companies — approved provider directory
-- =========================================================================
create or replace function public.ai_list_provider_companies(p_types text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
      'companyId', c.id, 'name', c.name, 'type', c.type::text, 'city', coalesce(c.city, '')
    ) as x
    from public.companies c
    where c.status = 'Approved'
      and coalesce(c.is_guest, false) = false
      and (p_types is null or c.type::text = any(p_types))
    order by c.name
    limit 40
  ) s;
  return v_out;
end;
$$;
grant execute on function public.ai_list_provider_companies(text[]) to authenticated;

-- =========================================================================
-- 4) ai_copilot_context() — role-aware live snapshot (extended)
-- =========================================================================
create or replace function public.ai_copilot_context()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text; v_name text; v_company uuid; v_company_name text; v_company_type text;
  v_ctx jsonb;
  v_orders jsonb; v_moves jsonb; v_drivers jsonb; v_trucks jsonb; v_chassis jsonb;
  v_events jsonb; v_st jsonb; v_dead jsonb; v_my_moves jsonb; v_my_orders jsonb;
  v_shifts jsonb; v_past_workers jsonb; v_applications jsonb;
  v_my_assignments jsonb; v_open_shifts jsonb;
  v_company_loads jsonb; v_my_loads jsonb; v_providers jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;
  select role::text, name, company_id into v_role, v_name, v_company from public.profiles where id = v_uid;
  if v_company is not null then
    select name, type::text into v_company_name, v_company_type from public.companies where id = v_company;
  end if;
  v_ctx := jsonb_build_object(
    'today', current_date, 'role', coalesce(v_role,'guest'),
    'userName', coalesce(v_name,''), 'companyName', coalesce(v_company_name,''),
    'companyType', coalesce(v_company_type,''));

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

    -- Employer block: recent shift posts + previously booked workers + pending applications
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_shifts from (
      select jsonb_build_object(
        'shiftId', p.id, 'title', p.title, 'date', p.date, 'start', p.start_time, 'end', p.end_time,
        'workersNeeded', p.workers_needed, 'hourlyRate', p.hourly_rate, 'status', p.status,
        'city', p.location_city, 'category', p.category) as x
      from public.shift_posts p
      where p.employer_company_id = v_company
      order by p.created_at desc limit 12) s;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_past_workers from (
      select jsonb_build_object(
        'workerUserId', sa.worker_user_id, 'name', coalesce(pr.name, pr.email),
        'timesWorked', count(*)) as x
      from public.shift_assignments sa
      join public.shift_posts sp on sp.id = sa.shift_id
      join public.profiles pr on pr.id = sa.worker_user_id
      where sp.employer_company_id = v_company and sa.status::text <> 'Cancelled'
      group by sa.worker_user_id, pr.name, pr.email
      order by count(*) desc limit 15) s;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_applications from (
      select jsonb_build_object(
        'applicationId', a.id, 'shiftTitle', sp.title, 'shiftDate', sp.date,
        'workerName', coalesce(pr.name, pr.email)) as x
      from public.shift_applications a
      join public.shift_posts sp on sp.id = a.shift_id
      join public.profiles pr on pr.id = a.worker_user_id
      where sp.employer_company_id = v_company and a.status::text = 'Applied'
      order by sp.date limit 15) s;

    if jsonb_array_length(v_shifts) > 0
       or jsonb_array_length(v_past_workers) > 0
       or jsonb_array_length(v_applications) > 0 then
      v_ctx := v_ctx || jsonb_build_object(
        'recentShifts', v_shifts, 'pastWorkers', v_past_workers,
        'pendingApplications', v_applications);
    end if;

    -- Loads visible to the company (posted or accepted, still active)
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_company_loads from (
      select jsonb_build_object(
        'loadId', l.id, 'status', l.status, 'pickupCity', l.pickup_city,
        'dropoffCity', l.dropoff_city, 'vehicle', l.vehicle_type, 'price', l.freight_price,
        'hasDriver', l.accepted_driver_user_id is not null) as x
      from public.loads l
      where (l.poster_company_id = v_company or l.accepted_company_id = v_company)
        and l.status::text not in ('Delivered','Cancelled')
      order by l.created_at desc limit 15) s;
    if jsonb_array_length(v_company_loads) > 0 then
      v_ctx := v_ctx || jsonb_build_object('companyLoads', v_company_loads);
    end if;
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

  -- Driver: freight loads assigned to me
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_my_loads from (
    select jsonb_build_object(
      'loadId', l.id, 'status', l.status, 'pickupCity', l.pickup_city,
      'dropoffCity', l.dropoff_city, 'price', l.provider_net) as x
    from public.loads l
    where l.accepted_driver_user_id = v_uid
      and l.status::text not in ('Delivered','Cancelled')
    order by l.created_at desc limit 10) s;
  if jsonb_array_length(v_my_loads) > 0 then
    v_ctx := v_ctx || jsonb_build_object('myLoads', v_my_loads);
  end if;

  -- Customer context (their own drayage orders)
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_my_orders from (
    select jsonb_build_object('ref', o.reference_code, 'status', o.status, 'container', o.container_number) as x
    from public.drayage_orders o
    where o.customer_user_id = v_uid and o.status::text not in ('Cancelled')
    order by o.created_at desc limit 10) s;
  if jsonb_array_length(v_my_orders) > 0 then
    v_ctx := v_ctx || jsonb_build_object('myOrders', v_my_orders);
  end if;

  -- Worker context: my upcoming assignments + open shifts I could apply to
  if v_role = 'Worker' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_my_assignments from (
      select jsonb_build_object(
        'assignmentId', sa.id, 'title', sp.title, 'date', sp.date,
        'start', sp.start_time, 'end', sp.end_time, 'rate', sa.confirmed_rate,
        'status', sa.status) as x
      from public.shift_assignments sa
      join public.shift_posts sp on sp.id = sa.shift_id
      where sa.worker_user_id = v_uid and sa.status::text in ('Scheduled','InProgress')
      order by sp.date limit 10) s;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_open_shifts from (
      select jsonb_build_object(
        'shiftId', sp.id, 'title', sp.title, 'date', sp.date, 'start', sp.start_time,
        'end', sp.end_time, 'hourlyRate', sp.hourly_rate, 'city', sp.location_city,
        'category', sp.category) as x
      from public.shift_posts sp
      where sp.status::text = 'Posted' and sp.date >= current_date
        and not exists (
          select 1 from public.shift_applications a
          where a.shift_id = sp.id and a.worker_user_id = v_uid)
      order by sp.date limit 10) s;

    v_ctx := v_ctx || jsonb_build_object(
      'myAssignments', v_my_assignments, 'openShifts', v_open_shifts);
  end if;

  -- Provider directory for roles that request services through the AI
  if v_role in ('Guest','Customer','Shipper','FreightForwarder','MarketplaceBuyer','CustomsBroker') then
    v_providers := public.ai_list_provider_companies(
      array['CargoInsurer','CustomsBroker','ServiceProvider','DrayageCompany','TruckingCompany','WarehouseProvider','EmploymentAgency']);
    v_ctx := v_ctx || jsonb_build_object('providerCompanies', v_providers);
  end if;

  return v_ctx;
end;
$$;
grant execute on function public.ai_copilot_context() to authenticated;

notify pgrst, 'reload schema';
