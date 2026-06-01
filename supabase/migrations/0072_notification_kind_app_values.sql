-- 0072_notification_kind_app_values.sql
-- Idempotent. Adds the notification_kind enum values that the app inserts
-- directly into `notifications` (via expo/lib/trpc.ts). Without these the
-- best-effort notification inserts fail with "invalid input value for enum".
--
-- Kinds inserted by the app that were missing from the enum:
--   company_pending, booking_counter_offer, shift_accepted, shift_rejected,
--   hours_confirmed, cert_approved, cert_rejected
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe (no-op if already present).
-- Each wrapped in its own DO block so a single failure can't abort the batch.

do $$ begin
  alter type public.notification_kind add value if not exists 'company_pending';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'booking_counter_offer';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'shift_accepted';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'shift_rejected';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'hours_confirmed';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'cert_approved';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'cert_rejected';
exception when others then null; end $$;
