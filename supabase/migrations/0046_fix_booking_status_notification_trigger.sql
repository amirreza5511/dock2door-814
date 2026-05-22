-- 0046_fix_booking_status_notification_trigger.sql
-- Fixes confirmed bug in tg_notify_booking_status (0014):
--
-- BUG — trigger queries companies.owner_user_id which does not exist.
--   0014 defines:
--     SELECT owner_user_id INTO v_customer_owner FROM public.companies WHERE id = new.customer_company_id;
--     SELECT owner_user_id INTO v_wh_owner       FROM public.companies WHERE id = new.warehouse_company_id;
--   But the companies table (0001) has NO owner_user_id column.
--   Columns defined in 0001: id, name, type, address, city, status, created_at.
--   PLAN.md mentions owner_user_id but it was never added to the actual migration.
--   Result: the trigger fails silently on EVERY booking status transition —
--   no booking status notifications are ever sent to either party.
--
-- FIX: look up the company owner via company_users (company_role = 'Owner')
--   which is where the ownership relationship actually lives.
-- Idempotent — drop + recreate function, drop + recreate trigger.

create or replace function public.tg_notify_booking_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_owner uuid;
  v_wh_owner       uuid;
  v_title          text;
begin
  if old.status is distinct from new.status then

    -- FIX: look up owner via company_users — companies has no owner_user_id column.
    select cu.user_id into v_customer_owner
    from public.company_users cu
    where cu.company_id  = new.customer_company_id
      and cu.company_role = 'Owner'
      and cu.status       = 'Active'
    limit 1;

    select cu.user_id into v_wh_owner
    from public.company_users cu
    where cu.company_id  = new.warehouse_company_id
      and cu.company_role = 'Owner'
      and cu.status       = 'Active'
    limit 1;

    v_title := 'Booking ' || substr(new.id::text, 1, 8) || ' → ' || new.status::text;

    if v_customer_owner is not null then
      perform public.queue_notification(
        v_customer_owner,
        'booking_status',
        v_title,
        '',
        'warehouse_bookings',
        new.id::text,
        jsonb_build_object('from', old.status, 'to', new.status)
      );
    end if;

    -- Only notify warehouse owner if different user from customer owner.
    if v_wh_owner is not null and v_wh_owner is distinct from v_customer_owner then
      perform public.queue_notification(
        v_wh_owner,
        'booking_status',
        v_title,
        '',
        'warehouse_bookings',
        new.id::text,
        jsonb_build_object('from', old.status, 'to', new.status)
      );
    end if;

  end if;

  return new;
end; $$;

-- Re-attach trigger (idempotent drop + recreate).
drop trigger if exists tr_notify_booking_status on public.warehouse_bookings;
create trigger tr_notify_booking_status
  after update on public.warehouse_bookings
  for each row execute function public.tg_notify_booking_status();
