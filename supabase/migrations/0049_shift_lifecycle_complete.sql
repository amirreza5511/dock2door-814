-- 0049_shift_lifecycle_complete.sql
-- Adds two missing RPCs to complete the shift lifecycle end-to-end:
--
-- 1. employer_close_shift_post(p_shift_id, p_reason)
--    Marks a shift_post as Completed once all shift_assignments are in a
--    terminal state (Completed, NoShow, Cancelled). Guards against premature
--    closure. Writes audit_logs. Replaces the unsafe direct UPDATE in trpc.ts.
--
-- 2. worker_confirm_attendance(p_assignment_id, p_confirmed, p_reason)
--    Worker confirms or cancels their attendance for an upcoming shift.
--    Sets worker_confirmed + worker_confirmed_at on shift_assignments, queues
--    a notification to the employer, writes audit_logs. Replaces the unaudited
--    direct update that was previously done in the shift-confirm screen.
--
-- Idempotent — CREATE OR REPLACE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. employer_close_shift_post
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.employer_close_shift_post(
  p_shift_id uuid,
  p_reason   text default 'Shift closed by employer'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift     public.shift_posts;
  v_before    jsonb;
  v_after     jsonb;
  v_open_cnt  int;
begin
  select * into v_shift from public.shift_posts where id = p_shift_id;
  if not found then
    raise exception 'shift_post % not found', p_shift_id using errcode = 'P0002';
  end if;

  -- Must be employer company member or admin
  if not (public.is_admin() or public.is_member_of(v_shift.employer_company_id)) then
    raise exception 'Access denied: not a member of the employer company' using errcode = '42501';
  end if;

  -- Only Posted / Filled / InProgress shifts can be closed
  if v_shift.status not in ('Posted', 'Filled', 'InProgress', 'Completed') then
    raise exception 'Cannot close a shift with status %', v_shift.status;
  end if;

  -- Check for still-active assignments
  select count(*) into v_open_cnt
  from public.shift_assignments
  where shift_id = p_shift_id
    and status not in ('Completed', 'NoShow', 'Cancelled', 'Disputed');

  if v_open_cnt > 0 then
    raise exception '% assignment(s) are still active; confirm or mark no-show before closing',
      v_open_cnt;
  end if;

  v_before := to_jsonb(v_shift);

  update public.shift_posts
  set status = 'Completed'
  where id = p_shift_id;

  select to_jsonb(s.*) into v_after
  from public.shift_posts s
  where id = p_shift_id;

  perform public.write_audit(
    'shift.close', 'shift_posts', p_shift_id::text,
    v_before, v_after, p_reason,
    v_shift.employer_company_id
  );
end;
$$;

grant execute on function public.employer_close_shift_post(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. worker_confirm_attendance
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.worker_confirm_attendance(
  p_assignment_id uuid,
  p_confirmed     boolean,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment  public.shift_assignments;
  v_shift       public.shift_posts;
  v_before      jsonb;
  v_after       jsonb;
begin
  select * into v_assignment from public.shift_assignments where id = p_assignment_id;
  if not found then
    raise exception 'shift_assignment % not found', p_assignment_id using errcode = 'P0002';
  end if;

  -- Only the assigned worker may confirm/cancel their own attendance
  if v_assignment.worker_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only the assigned worker can confirm attendance' using errcode = '42501';
  end if;

  -- Only Scheduled assignments can be confirmed / cancelled this way
  if v_assignment.status <> 'Scheduled' then
    raise exception 'Assignment is not in Scheduled state (current: %)', v_assignment.status;
  end if;

  select * into v_shift from public.shift_posts where id = v_assignment.shift_id;

  v_before := to_jsonb(v_assignment);

  if p_confirmed then
    -- Worker confirms — just record confirmation
    update public.shift_assignments
    set worker_confirmed    = true,
        worker_confirmed_at = now()
    where id = p_assignment_id;
  else
    -- Worker cancels — mark assignment Cancelled, free the slot
    if p_reason is null or trim(p_reason) = '' then
      raise exception 'A cancellation reason is required' using errcode = '22023';
    end if;
    update public.shift_assignments
    set status              = 'Cancelled',
        worker_confirmed    = false,
        worker_confirmed_at = now(),
        cancellation_reason = p_reason
    where id = p_assignment_id;
  end if;

  select to_jsonb(sa.*) into v_after
  from public.shift_assignments sa
  where id = p_assignment_id;

  -- Notify employer
  if v_shift.employer_company_id is not null then
    declare v_owner_id uuid;
    begin
      select user_id into v_owner_id
      from public.company_users
      where company_id = v_shift.employer_company_id
        and company_role = 'Owner'
      limit 1;

      if v_owner_id is not null then
        insert into public.notifications (
          user_id, title, body, kind, entity_type, entity_id
        ) values (
          v_owner_id,
          case when p_confirmed
               then 'Worker confirmed attendance'
               else 'Worker cancelled shift'
          end,
          case when p_confirmed
               then 'A worker has confirmed they will attend shift: ' || coalesce(v_shift.title, '')
               else 'A worker cancelled: ' || coalesce(p_reason, '') || ' — ' || coalesce(v_shift.title, '')
          end,
          'shift',
          'shift_assignments',
          p_assignment_id::text
        );
      end if;
    end;
  end if;

  perform public.write_audit(
    case when p_confirmed then 'shift.attendance_confirmed' else 'shift.attendance_cancelled' end,
    'shift_assignments', p_assignment_id::text,
    v_before, v_after,
    coalesce(p_reason, case when p_confirmed then 'Worker confirmed attendance' else null end),
    null
  );
end;
$$;

grant execute on function public.worker_confirm_attendance(uuid, boolean, text) to authenticated;
