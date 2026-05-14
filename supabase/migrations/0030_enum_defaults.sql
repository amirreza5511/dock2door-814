-- 0030_enum_defaults.sql
-- Applies column defaults that depend on enum values added in 0029.
-- Must run in a separate transaction AFTER 0029 commits, so the new
-- notification_kind values ('info', 'thread_message', etc.) are visible.

-- Set default kind on notifications to 'info' (added in 0029 via ALTER TYPE ADD VALUE).
alter table public.notifications
  alter column kind set default 'info';
