-- 0079_payable_on_confirm_hours.sql
-- Fixes "pay never shows up" for workers.
--
-- Before this migration a worker_payables row (the source of the worker
-- Earnings screen) was ONLY created when an employer issued a full invoice for
-- the shift (issue_invoice_for_shift). So when an employer merely confirmed
-- hours, the shift was marked Completed but the worker's Earnings screen stayed
-- empty forever — making it look like the app "lost" their pay.
--
-- This recreates employer_confirm_hours() so that confirming hours ALSO upserts
-- a Pending worker_payables row right away. Issuing an invoice later still works
-- and simply promotes the same row to Approved (it upserts on assignment_id).
-- Idempotent and additive; no schema/enum/RLS changes.

create or replace function public.employer_confirm_hours(
  p_time_entry_id uuid,
  p_hours numeric,
  p_notes text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_ass uuid;
  v_worker uuid;
  v_shift uuid;
  v_title text;
  v_rate numeric;
begin
  select a.id, a.employer_company_id, a.worker_user_id, a.shift_id, sp.title,
         coalesce(nullif(a.confirmed_rate, 0), sp.hourly_rate, 0)
    into v_ass, v_emp, v_worker, v_shift, v_title, v_rate
    from public.time_entries te
    join public.shift_assignments a on a.id = te.assignment_id
    left join public.shift_posts sp on sp.id = a.shift_id
   where te.id = p_time_entry_id;

  if v_emp is null then raise exception 'Entry not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_emp) then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  update public.time_entries
     set employer_confirmed_hours = p_hours, employer_notes = coalesce(p_notes,'')
   where id = p_time_entry_id;

  update public.shift_assignments set status = 'Completed' where id = v_ass;

  -- Create / refresh the worker's payable so it appears on their Earnings screen
  -- immediately. Keep it 'Pending' until an invoice promotes it to 'Approved'
  -- (and never downgrade a payable that's already been Paid).
  insert into public.worker_payables (
    assignment_id, shift_id, worker_user_id, employer_company_id,
    confirmed_hours, hourly_rate, gross_pay, status
  ) values (
    v_ass, v_shift, v_worker, v_emp,
    p_hours, v_rate, round(p_hours * v_rate, 2), 'Pending'
  )
  on conflict (assignment_id) do update set
    confirmed_hours = excluded.confirmed_hours,
    hourly_rate = excluded.hourly_rate,
    gross_pay = excluded.gross_pay,
    status = case
      when worker_payables.status in ('Paid','Approved') then worker_payables.status
      else 'Pending'::worker_payable_status
    end,
    updated_at = now();

  if v_worker is not null then
    perform public.queue_notification(
      v_worker,
      'shift',
      'Hours confirmed',
      'Your employer confirmed ' || p_hours::text || ' hour(s) for "'
        || coalesce(v_title, 'your shift') || '".',
      'time_entries', p_time_entry_id::text,
      jsonb_build_object(
        'time_entry_id', p_time_entry_id,
        'assignment_id', v_ass,
        'shift_id', v_shift,
        'hours', p_hours,
        'notes', p_notes
      )
    );
  end if;

  perform public.write_audit('shift.confirm_hours','time_entries', p_time_entry_id::text,
    null, jsonb_build_object('hours', p_hours, 'notes', p_notes), null, v_emp);
end; $$;
grant execute on function public.employer_confirm_hours(uuid, numeric, text) to authenticated;

-- Backfill: create Pending payables for already-confirmed time entries that
-- never got one (assignments confirmed before this fix). This is what makes
-- existing "completed but no pay" shifts finally show up under Earnings.
insert into public.worker_payables (
  assignment_id, shift_id, worker_user_id, employer_company_id,
  confirmed_hours, hourly_rate, gross_pay, status
)
select a.id,
       a.shift_id,
       a.worker_user_id,
       a.employer_company_id,
       te.employer_confirmed_hours,
       coalesce(nullif(a.confirmed_rate, 0), sp.hourly_rate, 0),
       round(te.employer_confirmed_hours * coalesce(nullif(a.confirmed_rate, 0), sp.hourly_rate, 0), 2),
       'Pending'
  from public.time_entries te
  join public.shift_assignments a on a.id = te.assignment_id
  left join public.shift_posts sp on sp.id = a.shift_id
 where te.employer_confirmed_hours is not null
   and a.worker_user_id is not null
   and a.employer_company_id is not null
on conflict (assignment_id) do nothing;
