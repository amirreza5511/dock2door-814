-- 0045_gate_event_appointment_status_enum.sql
-- Fixes confirmed bug in gate_record_event (0014):
--
-- BUG — appointment_status enum is missing 4 values that gate_record_event maps to.
--   0002 defined appointment_status as:
--     ('Requested', 'Approved', 'CheckedIn', 'Completed', 'NoShow', 'Cancelled')
--   0014 gate_record_event maps:
--     'at_gate'   -> 'AtGate'
--     'at_door'   -> 'AtDoor'
--     'loading'   -> 'Loading'
--     'unloading' -> 'Unloading'
--   These 4 values do NOT exist in the enum. Any call to gate_record_event with
--   p_kind = 'at_gate', 'at_door', 'loading', or 'unloading' crashes with:
--     ERROR: invalid input value for enum appointment_status: "AtGate" (etc.)
--   0037_schema_catchup.sql did not add these values.
--
-- FIX: add the 4 missing enum values.
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent (no-op if already present).

do $$ begin
  alter type public.appointment_status add value if not exists 'AtGate';
exception when others then null; end $$;

do $$ begin
  alter type public.appointment_status add value if not exists 'AtDoor';
exception when others then null; end $$;

do $$ begin
  alter type public.appointment_status add value if not exists 'Loading';
exception when others then null; end $$;

do $$ begin
  alter type public.appointment_status add value if not exists 'Unloading';
exception when others then null; end $$;
