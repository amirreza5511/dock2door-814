-- 0060_worker_withdraw_shift.sql
-- SECURITY DEFINER RPC: lets a worker withdraw their own pending application.
-- Verifies ownership, valid status transition, audits, and notifies the employer.

create or replace function public.worker_withdraw_shift(p_application_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_worker  uuid;
  v_status  application_status;
  v_shift   uuid;
  v_emp     uuid;
  v_title   text;
  v_owner   uuid;
begin
  select sa.worker_user_id, sa.status, sa.shift_id, sp.employer_company_id, sp.title
    into v_worker, v_status, v_shift, v_emp, v_title
    from public.shift_applications sa
    join public.shift_posts sp on sp.id = sa.shift_id
   where sa.id = p_application_id;

  if v_worker is null then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;

  if v_worker <> auth.uid() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Only Applied can be withdrawn. Accepted/Rejected/Withdrawn are terminal here.
  if v_status <> 'Applied' then
    raise exception 'Cannot withdraw application in status %', v_status
      using errcode = '22023';
  end if;

  update public.shift_applications
     set status = 'Withdrawn'
   where id = p_application_id;

  -- Notify the employer's company owner (best effort; ignored if helper missing)
  begin
    select cu.user_id into v_owner
      from public.company_users cu
     where cu.company_id = v_emp
       and cu.company_role = 'Owner'
       and cu.status = 'Active'
     limit 1;

    if v_owner is not null then
      perform public.queue_notification(
        v_owner,
        'shift',
        'Applicant withdrew',
        'A worker withdrew their application for "' || coalesce(v_title,'a shift') || '".',
        'shift_applications', p_application_id::text,
        jsonb_build_object(
          'application_id', p_application_id,
          'shift_id', v_shift,
          'worker_user_id', v_worker
        )
      );
    end if;
  exception when undefined_function then
    -- queue_notification not present; skip silently
    null;
  end;

  perform public.write_audit(
    'shift.withdraw_application',
    'shift_applications',
    p_application_id::text,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'Withdrawn'),
    null,
    v_emp
  );
end;
$$;

grant execute on function public.worker_withdraw_shift(uuid) to authenticated;
