-- 0080_labour_stabilization.sql
-- Labour Stabilization release — Critical + High fixes for the Worker/Employer domain.
-- Idempotent and additive. No enum/RLS removals; only one additive column set.
--
-- Contents:
--   A) CRITICAL — fix issue_invoice_for_shift (broken column/enum references).
--   B) CRITICAL — reconcile worker_payables on shift cancel / no-show.
--   C) HIGH     — mark_shift_no_show sets 'NoShow' (not 'Cancelled') + notifies worker.
--   D) HIGH     — server-side GPS capture on clock-in/out + open-entry guard.

-- =========================================================================
-- A) CRITICAL — issue_invoice_for_shift
-- =========================================================================
-- Bugs fixed vs 0063:
--   * sa.hourly_rate          -> shift_assignments has only `confirmed_rate` (0001:312)
--   * p.full_name             -> profiles has only `name` (0001:138)
--   * status in ('Completed','HoursConfirmed') -> 'HoursConfirmed' is not in the
--     assignment_status enum; only 'Completed' is valid.
create or replace function public.issue_invoice_for_shift(p_shift_id uuid, p_due_days int default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shift_posts;
  v_company public.companies;
  v_invoice_id uuid;
  v_existing uuid;
  v_number text;
  v_subtotal numeric := 0;
  v_commission_pct numeric := 0;
  v_commission numeric := 0;
  v_due int;
  r record;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_shift from public.shift_posts where id = p_shift_id;
  if v_shift is null then raise exception 'shift not found'; end if;
  if not (public.is_member_of(v_shift.employer_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  -- Reuse existing invoice if already issued for this shift
  select id into v_existing
    from public.invoices
   where customer_company_id = v_shift.employer_company_id
     and (subtotal_amount > 0)
     and exists (
       select 1 from public.worker_payables wp where wp.invoice_id = invoices.id and wp.shift_id = p_shift_id
     )
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_company from public.companies where id = v_shift.employer_company_id;
  v_due := coalesce(p_due_days, coalesce(v_company.payment_terms_days, 14));

  -- Sum confirmed hours × rate across all completed assignments on this shift
  for r in
    select sa.id as assignment_id,
           sa.worker_user_id,
           coalesce(sum(coalesce(te.employer_confirmed_hours, 0)), 0) as hours,
           coalesce(nullif(sa.confirmed_rate, 0), v_shift.hourly_rate, 0) as rate
      from public.shift_assignments sa
      left join public.time_entries te on te.assignment_id = sa.id
     where sa.shift_id = p_shift_id
       and sa.status = 'Completed'
     group by sa.id, sa.worker_user_id, sa.confirmed_rate
  loop
    if r.hours > 0 then
      v_subtotal := v_subtotal + (r.hours * r.rate);
    end if;
  end loop;

  if v_subtotal <= 0 then raise exception 'no confirmed hours to invoice'; end if;

  -- Commission from platform_settings (labour_commission_percentage)
  select coalesce(labour_commission_percentage, 0) into v_commission_pct from public.platform_settings limit 1;
  v_commission := round(v_subtotal * (v_commission_pct / 100.0), 2);

  v_number := 'INV-SHF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, due_date, issued_at
  ) values (
    v_shift.employer_company_id, null,
    v_number, v_subtotal, 0, v_subtotal + v_commission,
    'CAD', 'Issued', (current_date + make_interval(days => v_due)), now()
  ) returning id into v_invoice_id;

  -- Create lines per assignment + a commission line
  for r in
    select sa.id as assignment_id,
           sa.worker_user_id,
           coalesce(sum(coalesce(te.employer_confirmed_hours, 0)), 0) as hours,
           coalesce(nullif(sa.confirmed_rate, 0), v_shift.hourly_rate, 0) as rate,
           coalesce(p.name, 'Worker') as worker_name
      from public.shift_assignments sa
      left join public.time_entries te on te.assignment_id = sa.id
      left join public.profiles p on p.id = sa.worker_user_id
     where sa.shift_id = p_shift_id
       and sa.status = 'Completed'
     group by sa.id, sa.worker_user_id, sa.confirmed_rate, p.name
  loop
    if r.hours > 0 then
      insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
      values (v_invoice_id,
              r.worker_name || ' — ' || r.hours || 'h @ $' || r.rate,
              r.hours, r.rate, round(r.hours * r.rate, 2), 0);

      insert into public.worker_payables (
        assignment_id, shift_id, worker_user_id, employer_company_id,
        invoice_id, confirmed_hours, hourly_rate, gross_pay, status
      ) values (
        r.assignment_id, p_shift_id, r.worker_user_id, v_shift.employer_company_id,
        v_invoice_id, r.hours, r.rate, round(r.hours * r.rate, 2), 'Approved'
      )
      on conflict (assignment_id) do update set
        invoice_id = excluded.invoice_id,
        confirmed_hours = excluded.confirmed_hours,
        hourly_rate = excluded.hourly_rate,
        gross_pay = excluded.gross_pay,
        status = case when worker_payables.status = 'Paid' then 'Paid'::worker_payable_status else 'Approved'::worker_payable_status end,
        updated_at = now();
    end if;
  end loop;

  if v_commission > 0 then
    insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
    values (v_invoice_id, 'Platform fee (' || v_commission_pct || '%)', 1, v_commission, v_commission, 99);
  end if;

  update public.shift_posts set status = 'Completed' where id = p_shift_id and status not in ('Cancelled','Completed');

  perform public.write_audit('invoice_issued_shift', 'invoices', v_invoice_id::text, null,
    jsonb_build_object('shift_id', p_shift_id, 'subtotal', v_subtotal, 'commission', v_commission, 'total', v_subtotal + v_commission), '');

  return v_invoice_id;
end; $$;
grant execute on function public.issue_invoice_for_shift(uuid, int) to authenticated;

-- =========================================================================
-- B) CRITICAL — reconcile worker_payables on shift cancel
-- =========================================================================
-- cancel_shift_with_reason previously left worker_payables untouched, so a
-- cancelled shift kept showing as owed earnings. We now cancel any payable that
-- is still 'Pending' (not yet invoiced/approved/paid — those represent real work
-- already billed and must NOT be clawed back here).
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

  -- Reconcile payouts: void any not-yet-invoiced payable for this shift.
  update public.worker_payables
     set status='Cancelled', updated_at=now()
   where shift_id = p_shift_id
     and status = 'Pending';

  perform public.notify_shift_participants(p_shift_id, 'shift_cancelled', 'Shift cancelled', p_reason);
  perform public.write_audit('shift.cancel','shift_posts',p_shift_id::text,to_jsonb(v_old),(select to_jsonb(s) from public.shift_posts s where s.id=p_shift_id),p_reason,v_old.employer_company_id);
end; $$;
grant execute on function public.cancel_shift_with_reason(uuid,text) to authenticated;

-- =========================================================================
-- C) HIGH — mark_shift_no_show: correct status + worker notification + payable
-- =========================================================================
-- Bugs fixed vs 0023:
--   * assignment was set to 'Cancelled' instead of the dedicated 'NoShow' enum value.
--   * worker was never notified.
--   * pending payable for the assignment was left dangling.
create or replace function public.mark_shift_no_show(
  p_shift_id uuid,
  p_worker_user_id uuid,
  p_reason text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_title text;
begin
  select employer_company_id, title into v_emp, v_title from public.shift_posts where id = p_shift_id;
  if v_emp is null then raise exception 'Shift not found' using errcode='P0002'; end if;
  if not public.is_admin() and not public.is_member_of(v_emp) then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  insert into public.shift_no_shows (shift_id, worker_user_id, employer_company_id, reason, recorded_by)
  values (p_shift_id, p_worker_user_id, v_emp, coalesce(p_reason,''), auth.uid())
  returning id into v_id;

  update public.shift_assignments
     set status = 'NoShow'
   where shift_id = p_shift_id and worker_user_id = p_worker_user_id;

  -- Void any pending payable for this worker's assignment on this shift.
  update public.worker_payables wp
     set status='Cancelled', updated_at=now()
    from public.shift_assignments sa
   where sa.id = wp.assignment_id
     and sa.shift_id = p_shift_id
     and sa.worker_user_id = p_worker_user_id
     and wp.status = 'Pending';

  -- auto-add at-risk badge
  insert into public.worker_badges(worker_user_id, code)
  values (p_worker_user_id, 'no_show_risk')
  on conflict do nothing;

  -- Notify the worker they were recorded as a no-show.
  perform public.queue_notification(
    p_worker_user_id,
    'shift_changed',
    'Marked as no-show',
    'You were recorded as a no-show for "' || coalesce(v_title, 'a shift') || '"'
      || case when coalesce(trim(p_reason),'') <> '' then '. Reason: ' || p_reason else '.' end,
    'shift_posts', p_shift_id::text,
    jsonb_build_object('shift_id', p_shift_id, 'reason', p_reason)
  );

  perform public.write_audit('shift.no_show','shift_posts', p_shift_id::text,
    null, jsonb_build_object('worker', p_worker_user_id, 'reason', p_reason),
    p_reason, v_emp);
  return v_id;
end;
$$;
grant execute on function public.mark_shift_no_show(uuid, uuid, text) to authenticated;

-- =========================================================================
-- D) HIGH — server-side GPS capture on clock-in/out + open-entry guard
-- =========================================================================
alter table public.time_entries add column if not exists clock_in_lat numeric;
alter table public.time_entries add column if not exists clock_in_lng numeric;
alter table public.time_entries add column if not exists clock_in_accuracy numeric;
alter table public.time_entries add column if not exists clock_out_lat numeric;
alter table public.time_entries add column if not exists clock_out_lng numeric;

-- Recreate with optional GPS params (old single-arg signature is dropped).
drop function if exists public.worker_clock_in(uuid);
create or replace function public.worker_clock_in(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_worker uuid; v_shift uuid; v_cat shift_category; v_te uuid;
begin
  select a.worker_user_id, a.shift_id, p.category
    into v_worker, v_shift, v_cat
    from public.shift_assignments a join public.shift_posts p on p.id = a.shift_id
   where a.id = p_assignment_id;
  if v_worker is null then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if v_worker <> auth.uid() then
    raise exception 'Not your assignment' using errcode='42501';
  end if;

  -- Certification gate (forklift / high-reach roles require an approved, unexpired cert).
  if v_cat in ('Forklift','HighReach') then
    if not exists (
      select 1 from public.worker_certifications c
       where c.worker_user_id = v_worker
         and c.type = v_cat::text
         and c.status = 'Approved'
         and (c.expiry_date is null or c.expiry_date > current_date)
    ) then
      raise exception 'Approved % certification required to start this shift', v_cat using errcode='42501';
    end if;
  end if;

  -- Open-entry guard: block a second clock-in while one is still open.
  if exists (
    select 1 from public.time_entries
     where assignment_id = p_assignment_id and end_timestamp is null
  ) then
    raise exception 'You are already clocked in for this shift' using errcode='P0001';
  end if;

  insert into public.time_entries (assignment_id, start_timestamp, clock_in_lat, clock_in_lng, clock_in_accuracy)
  values (p_assignment_id, now(), p_lat, p_lng, p_accuracy)
  returning id into v_te;

  update public.shift_assignments set status = 'InProgress' where id = p_assignment_id;
  return v_te;
end; $$;
grant execute on function public.worker_clock_in(uuid, numeric, numeric, numeric) to authenticated;

drop function if exists public.worker_clock_out(uuid);
create or replace function public.worker_clock_out(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_worker uuid; v_te uuid;
begin
  select worker_user_id into v_worker from public.shift_assignments where id = p_assignment_id;
  if v_worker is null then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if v_worker <> auth.uid() then
    raise exception 'Not your assignment' using errcode='42501';
  end if;

  select id into v_te
    from public.time_entries
   where assignment_id = p_assignment_id and end_timestamp is null
   order by start_timestamp desc
   limit 1;
  if v_te is null then raise exception 'No open time entry' using errcode='P0002'; end if;

  update public.time_entries
     set end_timestamp = now(), clock_out_lat = p_lat, clock_out_lng = p_lng
   where id = v_te;
  update public.shift_assignments set status = 'Completed' where id = p_assignment_id;
end; $$;
grant execute on function public.worker_clock_out(uuid, numeric, numeric) to authenticated;
