-- =========================================================================
-- 0159 — Fix: fleet_status enum is missing 'PendingApproval'
-- Idempotent.
--
-- Bug found during automated role-by-role QA:
--   Driver self-registration with a fleet code crashed the whole signup
--   ("Database error saving new user") because handle_new_user (0112+)
--   inserts public.drivers with status 'PendingApproval', but the
--   fleet_status enum only had ('Active','Maintenance','Retired','Suspended').
--   join_fleet_by_code and approve_fleet_driver reference the same value.
-- =========================================================================

alter type fleet_status add value if not exists 'PendingApproval';
