# WEB_PARITY.md — Mobile → Web port tracker

> **Rule for future turns:** To continue the web parity work, read ONLY this file
> (and PROJECT_MAP.md if needed). Do NOT re-audit the whole repo. Pick the next
> unchecked item, read just the matching mobile screen + the closest existing web
> page as a pattern, build it, then mark it `- [x]` here. This file is the single
> source of truth for what's done vs. remaining.

## How to work through this (cheap loop)

1. Open the top unchecked role below.
2. Read the mobile screen: `expo/app/<role>/<screen>.tsx`.
3. Read ONE similar finished web page as a pattern (see "Reuse" hints).
4. Build `apps/web/app/(app)/<webrole>/<screen>/page.tsx`, wire it into
   `apps/web/components/sidebar.tsx`, reuse shared views/hooks where noted.
5. Run the web build to verify: `cd apps/web && bun install && bun run build`.
6. Mark the item `- [x]` and add any new shared hook/view under "Shared building blocks".

Data layer: web talks to the SAME Supabase tables/RPCs as mobile (direct client +
RLS). Mirror the mobile screen's queries exactly; don't invent columns.

## Shared building blocks (reuse — do not rebuild)

- `apps/web/components/rates-view.tsx` — rate cards / zones / add-ons (uses `use-pricing.ts`)
- `apps/web/components/invoicing-view.tsx` — invoices list/detail (uses `use-invoicing.ts`)
- `apps/web/components/team-view.tsx` — member invite/role/status (company_* RPCs)
- `apps/web/lib/hooks/use-pricing.ts` — pricing verticals (drayage/service/freight/trucking…)
- `apps/web/lib/hooks/use-invoicing.ts`, `use-loads.ts`, `use-sales.ts`, `use-pricing.ts`
- Pattern pages already built: `drayage-company/*`, `service-provider/rates|invoicing|team`.

---

## Roles — remaining gaps (mobile has it, web does not)

Web folder names differ from mobile: `trucking-company→trucking`,
`warehouse-provider→warehouse`.

### super-admin  (biggest gap)
- [x] certifications  (re-exports web `admin/certifications`)
- [x] companies       (re-exports web `admin/companies`)
- [x] compliance      (re-exports web `admin/compliance`)
- [x] finance   (Supabase-direct port of SuperAdminFinance: payment-engine mode via admin_set_payments_mode, overview totals, settle queue via settle_drayage_order/settle_booking_invoice/settle_service_job_invoice, provider payouts via sandbox_pay_payout, worker pay via sandbox_pay_worker)
- [x] operations      (direct Supabase: drayage_moves + shift_assignments log)
- [x] support    (Supabase-direct port: list_support_threads RPC inbox, admin_join_thread on open, deep-links into /messages?thread=<id>)
- [x] users           (re-exports web `admin/users`)

### admin
- [x] billing  (Supabase-direct port of FinanceScreen: payments/invoices/payouts tabs, totals + reconciliation + commission, CSV export, refund via create-refund fn, pay via create-checkout-session, mark-paid via admin_mark_invoice_paid_manual, retry payout via process-payouts, Stripe Express dashboard)
- [x] entities  (Supabase-direct port of admin.listEntity allowlist; read-only oversight console mirroring mobile's audit/state-machine guard)
- [x] sales-agents  (Supabase-direct port of sales.admin*: sales_agents+profiles+commission_entries+agent_attributions, commission_plans; RPCs admin_update_agent, admin_set_commission_status, admin_award_commission, admin_upsert_commission_plan)
- [x] shipping-carriers  (Supabase-direct port of carriers.list/upsert/delete on carrier_accounts scope=platform via upsert_carrier_account RPC)
- [x] bookings   (warehouse_bookings/listings/companies + admin_force_booking_status RPC + broker routing update)
- [ ] entities
- [x] freight-pricing  (load_rate_cards + load_commission_overrides + admin_upsert/delete_rate_card, admin_upsert/delete_commission_override, admin_update_platform_settings 7-arg)
- [x] system-health  (added `/admin/system-health` Diagnostics — Supabase-direct probes for RPC/RLS/storage/Stripe/EasyPost/push/realtime)

### employer
- [x] account  (profiles read/update + avatar upload to worker-photos bucket)
- [x] company-profile  (companies + shift_posts + reviews + company_update_profile/company_submit_for_approval RPCs)
- [x] invoicing  (reuse `invoicing-view.tsx`)
- [x] rates      (added `labor` vertical to web `use-pricing.ts` + reuse `rates-view.tsx`)
- [x] shifts     (per-shift console: applicants accept/reject, assignments clock in/out + confirm hours + no-show, message thread via open_shift_thread, complete via employer_close_shift_post, cancel via cancel_shift_with_reason, duplicate)
- [x] team       (reuse `team-view.tsx`)

### customer
- [x] billing  (invoices + payments history + create-checkout-session; distinct from invoices list)
- [x] drayage  (list — customer's own drayage_orders)
- [x] drayage/[orderId]  (detail — Supabase-direct port of tRPC drayage.getOrderDetails/listOrderQuotes/acceptQuote; live tracking, quotes accept, moves+proof photos via get-signed-url)
- [x] loads       (reuse `use-loads.ts` useMyPostedLoads)
- [x] post-load   (reuse `use-loads.ts` quote/post)
- [x] team  (reuse `team-view.tsx`, companyType Customer)

### warehouse (warehouse-provider)
- [x] invoicing  (reuse `invoicing-view.tsx`)
- [x] rates      (added `warehouse` vertical to web `use-pricing.ts` + reuse `rates-view.tsx`)
- [ ] stripe-connect  (covered by existing `warehouse/billing` Stripe Connect card — confirm if a separate page is still wanted)

### trucking (trucking-company)
- [x] loads      (dispatch board — reuse `use-loads.ts` useOpenLoads/accept)
- [x] my-loads   (reuse `use-loads.ts` useMyTrips + advance flow)
- [x] post-load  (reuse `use-loads.ts` quote/post, redirects to my-loads)
- [ ] messages   (covered by global `/messages`; add trucking-scoped thread list only if needed)

### service-provider
- [x] billing  (mirror of `warehouse/billing`: Stripe Connect + invoices)
- [x] jobs     (re-exports existing `/service-provider` index which is the jobs console)

### worker
- [x] earnings  (reuse `worker_earnings_overview` view; paid/pending totals + DataTable)
- [x] profile  (worker_profiles + update_my_worker_profile RPC, worker_private_info + encrypt_pii, review_summaries; uploads deferred to /worker/certifications)
- [x] [id]  (public profile — worker_profiles + certs + work_photos via get-signed-url + reviews + availability)
- [x] arrive  (browser geolocation + Nominatim geocode + haversine check-in banner)
- [x] shift-confirm  (worker_confirm_attendance RPC via ?assignmentId= query param)

### sales-agent
- [x] welcome  (first-run walkthrough — 4-step slides mirroring mobile, localStorage WELCOME_SEEN_KEY, redirects to onboard/home)

### Detail/sub-pages (lower priority)
- [x] drayage-company/[orderId]  (Supabase-direct port of tRPC drayage.getOrderDetails + updatePortReservation (update_port_reservation RPC) + dispatchMove (dispatch_drayage_move RPC); ops console with driver-fleet dispatch, port reservation edit, moves + proof photos via get-signed-url, live tracking. Board/dispatch rows already linked here.)
- [x] freight-forwarder/[orderId]  (re-exports the customer/drayage/[orderId] Supabase-direct detail, matching mobile which re-exports the same screen)
- [x] fulfillment/[bookingId]  (Supabase-direct port of fulfillment.getBooking: inventory add + outbound order create + pick/pack/ship/complete via advance_fulfillment_order RPC; customer/provider role split; BOL/GRN quick links)
- [x] fulfillment/bol/[bookingId]  (Bill of Lading doc: warehouse_booking_set_transport RPC, transport-mode picker, QR, printable HTML via window.print)
- [x] fulfillment/grn/[bookingId]  (Goods Received Note: goods_received_notes read + warehouse_issue_grn RPC, inspection form, QR, printable HTML, on-hand → fulfillment CTA)

---

## Done (web complete or near-complete — do NOT redo)

- [x] sales-agent — dashboard, onboard, clients, clients/[id], leads, earnings, profile
- [x] shipper — index, loads, post-load, track/[id]
- [x] driver — index, loads, my-loads, drayage, pod, documents, dropoff
- [x] drayage-company — dispatch, terminals, board, rates, invoicing, fleet
- [x] gate-staff — index, yard
- [x] freight-forwarder — index, rates, invoicing
- [x] trucking — dispatch, appointments, fleet, finance, rates, invoicing, team, pod
- [x] service-provider — index, listings, create-listing, rates, invoicing, team
- [x] warehouse — index, listings(+new/edit), bookings, staff, carriers, wms, stations/*, billing
- [x] customer — index, warehouses(+[id]), bookings, services, orders, inventory, invoices, tracking
- [x] Warehouse inventory schema fixes (cycle_counts / stock_movements column names)

---

## Progress note (update each turn)

- Last verified web build: GREEN (after freight-forwarder/[orderId] + fulfillment ×3 detail pages).
- This batch (4): freight-forwarder/[orderId] (re-export drayage detail) + fulfillment/[bookingId]
  (inventory & orders console) + fulfillment/bol/[bookingId] (Bill of Lading) + fulfillment/grn/[bookingId]
  (Goods Received Note). All Supabase-direct against the same tables/RPCs the mobile tRPC procedures wrap
  (warehouse_booking_set_transport, warehouse_issue_grn, advance_fulfillment_order). Reached via existing
  row links, so no sidebar wiring needed. ALL remaining detail/sub-pages are now DONE — web parity complete.
- Last verified web build (previous): GREEN (after drayage-company/[orderId] detail).
- This batch (1): drayage-company/[orderId] ops detail — Supabase-direct port of the mobile
  tRPC drayage detail (update_port_reservation + dispatch_drayage_move RPCs, drivers from
  fleet, proof photos via get-signed-url). Existing board/dispatch rows already deep-link here.
  Remaining detail pages: freight-forwarder/[orderId], fulfillment ×3.
- This batch (3): admin sales-agents + entities + shipping-carriers. All Supabase-direct against the
  same tables/RPCs the mobile sales.admin*/admin.listEntity/carriers.* tRPC procedures wrap; wired into
  sidebar. Confirmed those "tRPC-only" admin pages were in fact thin Supabase wrappers and are now ported.
  Remaining admin: billing (FinanceScreen port — heavier settle/payout engine). employer/shifts.
  super-admin finance/support still pending (share the FinanceScreen/messaging engines).
- This batch (6): admin bookings + freight-pricing + system-health, employer account + company-profile,
  customer billing. All Supabase-direct against the same tables/RPCs mobile uses; wired into sidebar.
  Remaining admin: billing (FinanceScreen port), entities (generic admin.* tRPC), sales-agents (sales.admin* tRPC),
  shipping-carriers (carriers.* tRPC). employer/shifts (shifts.* + messaging tRPC). These need Supabase-direct
  ports of backend procedures, not just table reads.
- super-admin: certifications/companies/compliance/users (re-export admin) + operations
  (direct Supabase) DONE and wired into sidebar. finance & support BLOCKED — they depend
  on tRPC procedures the web app doesn't have; revisit if we add a Supabase-direct path.
- employer: rates (new `labor` pricing vertical) + invoicing + team DONE and wired into
  sidebar. account/company-profile/shifts remain (shifts leans on tRPC shifts.* + messaging).
- customer: loads + post-load (reuse use-loads) + drayage list + team (team-view) + drayage/
  [orderId] detail DONE and wired into sidebar. drayage list rows now link to detail.
  Remaining: billing (confirm vs existing invoices page).
- warehouse: rates (new `warehouse` pricing vertical) + invoicing DONE and wired into
  sidebar. stripe-connect covered by existing warehouse/billing card.
- trucking: loads (dispatch board) + my-loads + post-load DONE and wired into sidebar.
  messages covered by global /messages.
- service-provider: billing (Stripe Connect + invoices) + jobs (re-export index) DONE and
  wired into sidebar.
- worker: earnings + profile + [id] public profile + arrive + shift-confirm DONE. worker
  role is now fully at parity with mobile. arrive uses browser geolocation + Nominatim
  geocoding; shift-confirm uses worker_confirm_attendance RPC (?assignmentId=).
- Next up (more custom): **customer** billing (confirm vs invoices), **employer**
  account/company-profile/shifts, **admin** pages (billing/bookings/entities/freight-pricing/
  sales-agents/shipping-carriers). super-admin finance/support still BLOCKED (need
  Supabase-direct port of tRPC procedures).
