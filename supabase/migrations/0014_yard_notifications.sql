-- Dock2Door — Yard/Gate/POD + Notifications + Messaging extensions
-- Idempotent.

-- =========================================================================
-- GATE EVENTS (append-only log per appointment)
-- =========================================================================
do $$ begin
  create type gate_event_kind as enum (
    'check_in','check_out','at_gate','at_door','loading','unloading','no_show','hold','released','seal_check'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.gate_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.dock_appointments(id) on delete cascade,
  kind gate_event_kind not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  driver_name text default '',
  truck_plate text default '',
  trailer_number text default '',
  seal_number text default '',
  reference_number text default '',
  notes text default '',
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);
create index if not exists idx_gate_events_appt on public.gate_events(appointment_id, occurred_at desc);
alter table public.gate_events enable row level security;

drop policy if exists "gate_events_read" on public.gate_events;
create policy "gate_events_read" on public.gate_events for select using (
  exists (
    select 1 from public.dock_appointments a
    left join public.warehouse_listings l on l.id = a.warehouse_listing_id
    where a.id = gate_events.appointment_id
      and (
        public.is_member_of(a.trucking_company_id)
        or public.is_member_of(l.company_id)
        or public.is_admin()
      )
  )
);

-- =========================================================================
-- YARD MOVES
-- =========================================================================
create table if not exists public.yard_moves (
  id uuid primary key default gen_random_uuid(),
  warehouse_company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid references public.dock_appointments(id) on delete set null,
  truck_id uuid references public.trucks(id) on delete set null,
  trailer_id uuid references public.trailers(id) on delete set null,
  container_id uuid references public.containers(id) on delete set null,
  from_location text default '',
  to_location text default '',
  actor_user_id uuid references public.profiles(id) on delete set null,
  notes text default '',
  occurred_at timestamptz not null default now()
);
create index if not exists idx_yard_moves_wh on public.yard_moves(warehouse_company_id, occurred_at desc);
alter table public.yard_moves enable row level security;

drop policy if exists "yard_moves_read" on public.yard_moves;
create policy "yard_moves_read" on public.yard_moves for select using (public.is_member_of(warehouse_company_id) or public.is_admin());
drop policy if exists "yard_moves_write" on public.yard_moves;
create policy "yard_moves_write" on public.yard_moves for insert with check (public.is_member_of(warehouse_company_id));

-- =========================================================================
-- PODs (proofs of delivery) linked to appointments or shipments
-- =========================================================================
create table if not exists public.pods (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.dock_appointments(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  storage_file_id uuid references public.storage_files(id) on delete set null,
  captured_by uuid references public.profiles(id) on delete set null,
  signed_by_name text default '',
  signature_path text default '',
  photo_paths jsonb not null default '[]'::jsonb,
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_pods_appt on public.pods(appointment_id);
create index if not exists idx_pods_ship on public.pods(shipment_id);
alter table public.pods enable row level security;

drop policy if exists "pods_read" on public.pods;
create policy "pods_read" on public.pods for select using (
  exists (
    select 1 from public.dock_appointments a
    left join public.warehouse_listings l on l.id = a.warehouse_listing_id
    where a.id = pods.appointment_id
      and (public.is_member_of(a.trucking_company_id) or public.is_member_of(l.company_id) or public.is_admin())
  )
  or exists (
    select 1 from public.shipments s
    where s.id = pods.shipment_id
      and (public.is_member_of(s.customer_company_id) or public.is_member_of(s.provider_company_id) or public.is_admin())
  )
);

-- =========================================================================
-- NOTIFICATIONS — extend existing
-- =========================================================================
alter table public.notifications add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.notifications add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.notifications add column if not exists kind text not null default 'info';
alter table public.notifications add column if not exists title text default '';
alter table public.notifications add column if not exists body text default '';
alter table public.notifications add column if not exists entity_type text;
alter table public.notifications add column if not exists entity_id text;
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.notifications add column if not exists payload jsonb not null default '{}'::jsonb;

create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread on public.notifications(user_id) where read_at is null;

drop policy if exists "notif_read_own" on public.notifications;
create policy "notif_read_own" on public.notifications for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "notif_update_own" on public.notifications;
create policy "notif_update_own" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- NOTIFICATION PREFERENCES
-- =========================================================================
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  channels jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
drop policy if exists "np_read_own" on public.notification_preferences;
create policy "np_read_own" on public.notification_preferences for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "np_upsert_own" on public.notification_preferences;
create policy "np_upsert_own" on public.notification_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- PUSH TOKENS (Expo push)
-- =========================================================================
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text default '',
  device_id text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, token)
);
create index if not exists idx_push_tokens_user on public.push_tokens(user_id);
alter table public.push_tokens enable row level security;
drop policy if exists "pt_read_own" on public.push_tokens;
create policy "pt_read_own" on public.push_tokens for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "pt_write_own" on public.push_tokens;
create policy "pt_write_own" on public.push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- RPCs
-- =========================================================================

-- Append a gate event and advance appointment status accordingly
create or replace function public.gate_record_event(
  p_appointment_id uuid, p_kind text, p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt public.dock_appointments;
  v_listing public.warehouse_listings;
  v_new_status appointment_status;
  v_event_id uuid;
begin
  select * into v_appt from public.dock_appointments where id = p_appointment_id;
  if v_appt is null then raise exception 'appointment not found'; end if;
  select * into v_listing from public.warehouse_listings where id = v_appt.warehouse_listing_id;
  if not (
    public.is_member_of(v_listing.company_id)
    or public.is_member_of(v_appt.trucking_company_id)
    or public.is_admin()
  ) then
    raise exception 'not authorized for appointment';
  end if;

  insert into public.gate_events (appointment_id, kind, actor_user_id, payload,
    driver_name, truck_plate, trailer_number, seal_number, reference_number, notes)
  values (
    p_appointment_id, p_kind::gate_event_kind, auth.uid(), coalesce(p_payload, '{}'::jsonb),
    coalesce(p_payload->>'driverName', ''),
    coalesce(p_payload->>'truckPlate', ''),
    coalesce(p_payload->>'trailerNumber', ''),
    coalesce(p_payload->>'sealNumber', ''),
    coalesce(p_payload->>'referenceNumber', ''),
    coalesce(p_payload->>'notes', '')
  ) returning id into v_event_id;

  v_new_status := case p_kind
    when 'check_in' then 'CheckedIn'
    when 'at_gate' then 'AtGate'
    when 'at_door' then 'AtDoor'
    when 'loading' then 'Loading'
    when 'unloading' then 'Unloading'
    when 'no_show' then 'NoShow'
    when 'check_out' then 'Completed'
    else null
  end;

  if v_new_status is not null then
    update public.dock_appointments
      set status = v_new_status,
          check_in_ts = case when p_kind = 'check_in' then coalesce(check_in_ts, now()) else check_in_ts end,
          check_out_ts = case when p_kind = 'check_out' then coalesce(check_out_ts, now()) else check_out_ts end,
          updated_at = now()
      where id = p_appointment_id;
  end if;

  return v_event_id;
end; $$;
grant execute on function public.gate_record_event(uuid, text, jsonb) to authenticated;

-- Attach a POD to an appointment
create or replace function public.attach_pod(
  p_appointment_id uuid, p_storage_file_id uuid, p_signed_by text, p_notes text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_pod_id uuid; v_appt public.dock_appointments; v_listing public.warehouse_listings;
begin
  select * into v_appt from public.dock_appointments where id = p_appointment_id;
  if v_appt is null then raise exception 'appointment not found'; end if;
  select * into v_listing from public.warehouse_listings where id = v_appt.warehouse_listing_id;
  if not (public.is_member_of(v_appt.trucking_company_id) or public.is_member_of(v_listing.company_id) or public.is_admin()) then
    raise exception 'not authorized';
  end if;
  insert into public.pods (appointment_id, storage_file_id, captured_by, signed_by_name, notes)
    values (p_appointment_id, p_storage_file_id, auth.uid(), coalesce(p_signed_by, ''), coalesce(p_notes, ''))
  returning id into v_pod_id;
  update public.dock_appointments set pod_file = p_storage_file_id::text, updated_at = now() where id = p_appointment_id;
  return v_pod_id;
end; $$;
grant execute on function public.attach_pod(uuid, uuid, text, text) to authenticated;

-- Register push token
create or replace function public.register_push_token(p_token text, p_platform text, p_device_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  insert into public.push_tokens (user_id, token, platform, device_id, is_active, last_used_at)
    values (auth.uid(), p_token, coalesce(p_platform, ''), coalesce(p_device_id, ''), true, now())
    on conflict (user_id, token) do update set is_active = true, last_used_at = now(), platform = excluded.platform
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.register_push_token(text, text, text) to authenticated;

-- Queue a notification (used by internal triggers / Edge Function)
create or replace function public.queue_notification(
  p_user_id uuid, p_kind text, p_title text, p_body text,
  p_entity_type text, p_entity_id text, p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, payload)
    values (p_user_id, coalesce(p_kind, 'info'), coalesce(p_title, ''), coalesce(p_body, ''),
            p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.queue_notification(uuid, text, text, text, text, text, jsonb) from public, authenticated;

-- Mark notification read
create or replace function public.mark_notification_read(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications set read_at = now() where id = p_id and user_id = auth.uid();
end; $$;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- =========================================================================
-- Auto-notify on booking transitions (notify both parties)
-- =========================================================================
create or replace function public.tg_notify_booking_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_customer_owner uuid; v_wh_owner uuid; v_title text;
begin
  if old.status is distinct from new.status then
    select owner_user_id into v_customer_owner from public.companies where id = new.customer_company_id;
    select owner_user_id into v_wh_owner from public.companies where id = new.warehouse_company_id;
    v_title := 'Booking ' || substr(new.id::text, 1, 8) || ' → ' || new.status::text;
    if v_customer_owner is not null then
      perform public.queue_notification(v_customer_owner, 'booking_status', v_title, '', 'warehouse_bookings', new.id::text,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if v_wh_owner is not null and v_wh_owner <> v_customer_owner then
      perform public.queue_notification(v_wh_owner, 'booking_status', v_title, '', 'warehouse_bookings', new.id::text,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists tr_notify_booking_status on public.warehouse_bookings;
create trigger tr_notify_booking_status
  after update on public.warehouse_bookings
  for each row execute function public.tg_notify_booking_status();
