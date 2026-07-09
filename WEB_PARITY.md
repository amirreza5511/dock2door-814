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
- [ ] finance   (BLOCKED: mobile uses tRPC `finance.*` procedures; web has no tRPC client, needs Supabase-direct port or backend RPCs)
- [x] operations      (direct Supabase: drayage_moves + shift_assignments log)
- [ ] support    (BLOCKED: mobile uses tRPC `messaging.listSupportThreads`/`adminJoinThread`; web has no tRPC, needs port)
- [x] users           (re-exports web `admin/users`)

### admin
- [ ] billing
- [ ] bookings
- [ ] entities
- [ ] freight-pricing
- [ ] sales-agents
- [ ] shipping-carriers
- [ ] system-health (web has `health` — confirm it covers system + notifications health; if not, add)

### employer
- [ ] account
- [ ] company-profile
- [x] invoicing  (reuse `invoicing-view.tsx`)
- [x] rates      (added `labor` vertical to web `use-pricing.ts` + reuse `rates-view.tsx`)
- [ ] shifts     (mobile uses tRPC shifts.* + messaging — web has employer page w/ Supabase RPCs; port remaining accept/reject/hours already partly on `/employer` + `/employer/hours`)
- [x] team       (reuse `team-view.tsx`)

### customer
- [ ] billing (web has `invoices` — confirm parity, add billing if distinct)
- [ ] drayage  (list)
- [ ] drayage/[orderId]  (detail)
- [ ] loads
- [ ] post-load
- [ ] team  (reuse `team-view.tsx`)

### warehouse (warehouse-provider)
- [ ] invoicing  (reuse `invoicing-view.tsx`)
- [ ] rates      (reuse `rates-view.tsx`)
- [ ] stripe-connect

### trucking (trucking-company)
- [ ] loads
- [ ] my-loads
- [ ] post-load
- [ ] messages

### service-provider
- [ ] billing
- [ ] jobs

### worker
- [ ] earnings
- [ ] profile
- [ ] [id]  (public profile)
- [ ] arrive
- [ ] shift-confirm

### sales-agent
- [ ] welcome  (first-run walkthrough — see approved sales-agent plan)

### Detail/sub-pages (lower priority)
- [ ] drayage-company/[orderId]
- [ ] freight-forwarder/[orderId]
- [ ] fulfillment/[bookingId], fulfillment/bol/[bookingId], fulfillment/grn/[bookingId]

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

- Last verified web build: GREEN.
- super-admin: certifications/companies/compliance/users (re-export admin) + operations
  (direct Supabase) DONE and wired into sidebar. finance & support BLOCKED — they depend
  on tRPC procedures the web app doesn't have; revisit if we add a Supabase-direct path.
- employer: rates (new `labor` pricing vertical) + invoicing + team DONE and wired into
  sidebar. account/company-profile/shifts remain (shifts leans on tRPC shifts.* + messaging).
- Next up: **customer** sub-pages (loads, post-load, drayage, drayage/[orderId], team),
  then **warehouse** invoicing/rates (reuse shared views).
