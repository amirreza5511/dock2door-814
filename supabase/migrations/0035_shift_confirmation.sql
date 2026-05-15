-- Migration 0035: Add worker shift confirmation columns to shift_assignments

alter table public.shift_assignments
  add column if not exists worker_confirmed boolean default null,
  add column if not exists worker_confirmed_at timestamptz,
  add column if not exists cancellation_reason text;

comment on column public.shift_assignments.worker_confirmed is
  'null = not yet confirmed, true = worker confirmed attendance, false = worker cancelled';
comment on column public.shift_assignments.worker_confirmed_at is
  'Timestamp when worker confirmed or cancelled';
comment on column public.shift_assignments.cancellation_reason is
  'Reason provided by worker when cancelling a confirmed shift';
