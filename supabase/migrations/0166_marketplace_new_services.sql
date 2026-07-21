-- ---------------------------------------------------------------------------
-- 0166 — Add flat-deck transport, junk removal, and tow truck as marketplace
-- service types.
-- ---------------------------------------------------------------------------
-- These reuse the existing service_listings / service_jobs flow (browse, quote,
-- book, chat, invoice). Additive & idempotent — only widens the check
-- constraint so the new service_type values are accepted.

alter table public.service_listings drop constraint if exists service_listings_service_type_chk;
alter table public.service_listings
  add constraint service_listings_service_type_chk
  check (service_type in (
    'service',
    'equipment_rental',
    'crane_service',
    'mobile_repair',
    'cargo_insurance',
    'flat_deck',
    'junk_removal',
    'tow_truck'
  ));
