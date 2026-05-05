-- Dock2Door — Labour Calendar operational hardening
-- Photos, shift edits/cancellations, admin assignment, payroll approval notifications.

insert into storage.buckets (id, name, public)
values ('worker-photos','worker-photos', false), ('shift-attachments','shift-attachments', false)
on conflict (id) do update set public = false;

alter table public.worker_profiles
  add column if not exists profile_photo_path text default '',
  add column if not exists completed_shift_count integer not null default 0,
  add column if not exists rating_average numeric(3,2) not null default 0;

alter table public.work_photos
  add column if not exists moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected')),
  add column if not exists rejection_reason text default '';

create table if not exists public.shift_attachments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shift_posts(id) on delete cascade,
  employer_company_id uuid references public.companies(id) on delete cascade,
  file_path text not null,
  caption text default '',
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.shift_attachments enable row level security;
drop policy if exists shift_attach_read_parties on public.shift_attachments;
create policy shift_attach_read_parties on public.shift_attachments for select using (
  public.is_admin() or public.is_member_of(employer_company_id) or exists (
    select 1 from public.shift_assignments a where a.shift_id = shift_attachments.shift_id and a.worker_user_id = auth.uid()
  ) or exists (
    select 1 from public.shift_applications ap where ap.shift_id = shift_attachments.shift_id and ap.worker_user_id = auth.uid()
  )
);
drop policy if exists shift_attach_company_insert on public.shift_attachments;
create policy shift_attach_company_insert on public.shift_attachments for insert with check (
  uploaded_by = auth.uid() and public.is_member_of(employer_company_id)
);

alter table public.time_entries
  add column if not exists admin_approved_at timestamptz,
  add column if not exists admin_approved_by uuid references public.profiles(id),
  add column if not exists payroll_status text not null default 'pending' check (payroll_status in ('pending','company_approved','admin_approved','invoice_ready','paid','disputed'));

create or replace function public.notify_shift_participants(p_shift_id uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct worker_user_id from public.shift_assignments where shift_id = p_shift_id
           union select distinct worker_user_id from public.shift_applications where shift_id = p_shift_id loop
    insert into public.notifications(user_id, kind, title, body, entity_type, entity_id, payload)
    values (r.worker_user_id, p_kind, p_title, p_body, 'shift', p_shift_id::text, jsonb_build_object('shift_id', p_shift_id));
  end loop;
end; $$;
grant execute on function public.notify_shift_participants(uuid,text,text,text) to authenticated;

create or replace function public.employer_update_shift(
  p_shift_id uuid, p_title text, p_date date, p_start text, p_end text,
  p_workers_needed integer, p_hourly_rate numeric, p_requirements text, p_notes text, p_reason text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare v_old public.shift_posts%rowtype;
begin
  select * into v_old from public.shift_posts where id = p_shift_id;
  if not found then raise exception 'Shift not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_old.employer_company_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if exists(select 1 from public.shift_assignments where shift_id = p_shift_id and status in ('Scheduled','InProgress')) and length(coalesce(p_reason,'')) < 3 then
    raise exception 'Reason required after assignment' using errcode='23514';
  end if;
  update public.shift_posts set title=p_title, date=p_date, start_time=p_start, end_time=p_end, workers_needed=p_workers_needed,
    hourly_rate=p_hourly_rate, requirements=coalesce(p_requirements,''), notes=coalesce(p_notes,'') where id=p_shift_id;
  perform public.notify_shift_participants(p_shift_id, 'shift_changed', 'Shift changed', coalesce(p_reason,'Shift details were updated'));
  perform public.write_audit('shift.update','shift_posts',p_shift_id::text,to_jsonb(v_old),(select to_jsonb(s) from public.shift_posts s where s.id=p_shift_id),p_reason,v_old.employer_company_id);
end; $$;
grant execute on function public.employer_update_shift(uuid,text,date,text,text,integer,numeric,text,text,text) to authenticated;

create or replace function public.cancel_shift_with_reason(p_shift_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old public.shift_posts%rowtype;
begin
  perform public.require_reason(p_reason);
  select * into v_old from public.shift_posts where id = p_shift_id;
  if not found then raise exception 'Shift not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_old.employer_company_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  update public.shift_posts set status='Cancelled' where id=p_shift_id;
  update public.shift_assignments set status='Cancelled' where shift_id=p_shift_id and status <> 'Completed';
  perform public.notify_shift_participants(p_shift_id, 'shift_cancelled', 'Shift cancelled', p_reason);
  perform public.write_audit('shift.cancel','shift_posts',p_shift_id::text,to_jsonb(v_old),(select to_jsonb(s) from public.shift_posts s where s.id=p_shift_id),p_reason,v_old.employer_company_id);
end; $$;
grant execute on function public.cancel_shift_with_reason(uuid,text) to authenticated;

create or replace function public.admin_assign_worker_to_shift(p_shift_id uuid, p_worker_user_id uuid, p_rate numeric default null, p_replace_assignment_id uuid default null, p_reason text default 'Admin assignment')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_shift public.shift_posts%rowtype; v_id uuid;
begin
  perform public.require_admin();
  select * into v_shift from public.shift_posts where id=p_shift_id;
  if not found then raise exception 'Shift not found' using errcode='P0002'; end if;
  if public.shift_has_conflict(p_worker_user_id, v_shift.date, v_shift.start_time, v_shift.end_time, p_shift_id) then
    raise exception 'Worker has overlapping assigned shift' using errcode='23514';
  end if;
  if p_replace_assignment_id is not null then update public.shift_assignments set status='Cancelled' where id=p_replace_assignment_id; end if;
  insert into public.shift_assignments(shift_id, worker_user_id, employer_company_id, confirmed_rate, status)
  values(p_shift_id, p_worker_user_id, v_shift.employer_company_id, coalesce(p_rate, v_shift.hourly_rate), 'Scheduled') returning id into v_id;
  update public.shift_posts set status = case when (select count(*) from public.shift_assignments where shift_id=p_shift_id and status='Scheduled') >= workers_needed then 'Filled' else status end where id=p_shift_id;
  insert into public.notifications(user_id, kind, title, body, entity_type, entity_id, payload)
  values(p_worker_user_id, 'worker_assigned', 'You were assigned to a shift', v_shift.title, 'shift_assignment', v_id::text, jsonb_build_object('shift_id',p_shift_id));
  perform public.write_audit('shift.admin_assign','shift_assignments',v_id::text,null,jsonb_build_object('shift_id',p_shift_id,'worker_user_id',p_worker_user_id),p_reason,v_shift.employer_company_id);
  return v_id;
end; $$;
grant execute on function public.admin_assign_worker_to_shift(uuid,uuid,numeric,uuid,text) to authenticated;

create or replace function public.admin_approve_time_entry(p_time_entry_id uuid, p_reason text default 'Approved for payroll')
returns void language plpgsql security definer set search_path = public as $$
declare v_old public.time_entries%rowtype;
begin
  perform public.require_admin();
  select * into v_old from public.time_entries where id=p_time_entry_id;
  if not found then raise exception 'Time entry not found' using errcode='P0002'; end if;
  update public.time_entries set admin_approved_at=now(), admin_approved_by=auth.uid(), payroll_status='invoice_ready' where id=p_time_entry_id;
  perform public.write_audit('time_entry.admin_approve','time_entries',p_time_entry_id::text,to_jsonb(v_old),(select to_jsonb(t) from public.time_entries t where t.id=p_time_entry_id),p_reason,null);
end; $$;
grant execute on function public.admin_approve_time_entry(uuid,text) to authenticated;

create or replace function public.admin_moderate_work_photo(p_photo_id uuid, p_status text, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_status not in ('approved','rejected') then raise exception 'Invalid status' using errcode='23514'; end if;
  if p_status='rejected' then perform public.require_reason(p_reason); end if;
  update public.work_photos set moderation_status=p_status, rejection_reason=coalesce(p_reason,''), approved_by=case when p_status='approved' then auth.uid() else null end, approved_at=case when p_status='approved' then now() else null end where id=p_photo_id;
end; $$;
grant execute on function public.admin_moderate_work_photo(uuid,text,text) to authenticated;
