-- 0059_close_shift_notifications.sql
-- Adds worker notifications to employer_close_shift_post.
-- When an employer closes a shift, notify:
--   1. Workers with non-terminal applications (Pending / Withdrawn) — shift closed before they were selected.
--   2. Workers with assignments (any status not already Cancelled/NoShow) — shift they were scheduled on closed.
-- Each worker is notified at most once per close (DISTINCT user).
-- Re-declares the function with the same signature + audit behaviour from 0049,
-- only adding the notification step.
--
-- Idempotent — CREATE OR REPLACE.

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
  v_title     text;
  v_body      text;
begin
  select * into v_shift from public.shift_posts where id = p_shift_id;
  if not found then
    raise exception 'shift_post % not found', p_shift_id using errcode = 'P0002';
  end if;

  -- Must be employer company member or admin
  if not (public.is_admin() or public.is_member_of(v_shift.employer_company_id)) then
    raise exception 'Access denied: not a member of the employer company' using errcode = '42501';
  end if;

  -- Only Posted / Filled / InProgress / Completed shifts can be closed
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

  -- ───────────────────────────────────────────────────────────────────────────
  -- Notify affected workers (applicants + assignees), deduped per user.
  -- ───────────────────────────────────────────────────────────────────────────
  v_title := 'Shift closed';
  v_body  := 'The shift "' || coalesce(v_shift.title, 'a shift') || '" has been closed.'
             || case when p_reason is not null and length(trim(p_reason)) > 0
                     then ' Reason: ' || p_reason
                     else '' end;

  perform public.queue_notification(
    aff.user_id,
    'shift',
    v_title,
    v_body,
    'shift_posts', p_shift_id::text,
    jsonb_build_object(
      'shift_id', p_shift_id,
      'shift_title', v_shift.title,
      'reason', p_reason,
      'source', aff.source
    )
  )
  from (
    -- Applicants who never got selected (terminal Rejected applicants already got their own notification)
    select distinct sa.worker_user_id as user_id, 'application'::text as source
      from public.shift_applications sa
     where sa.shift_id = p_shift_id
       and sa.status in ('Pending', 'Withdrawn')
       and sa.worker_user_id is not null
    union
    -- Workers who had an assignment on this shift (any non-terminal-at-close status)
    select distinct asg.worker_user_id as user_id, 'assignment'::text as source
      from public.shift_assignments asg
     where asg.shift_id = p_shift_id
       and asg.worker_user_id is not null
  ) aff;

  perform public.write_audit(
    'shift.close', 'shift_posts', p_shift_id::text,
    v_before, v_after, p_reason,
    v_shift.employer_company_id
  );
end;
$$;

grant execute on function public.employer_close_shift_post(uuid, text) to authenticated;
