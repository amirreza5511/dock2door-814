-- ---------------------------------------------------------------------------
-- 0135 — Add "crane_service" as a distinct marketplace service type.
-- ---------------------------------------------------------------------------
-- Operated crane service (a crane + operator is dispatched, performs the lift,
-- then leaves) is a different offering from renting an unoperated crane under
-- 'equipment_rental'. Additive & idempotent — only widens the check constraint.

alter table public.service_listings drop constraint if exists service_listings_service_type_chk;
alter table public.service_listings
  add constraint service_listings_service_type_chk
  check (service_type in ('service', 'equipment_rental', 'crane_service', 'mobile_repair', 'cargo_insurance'));
