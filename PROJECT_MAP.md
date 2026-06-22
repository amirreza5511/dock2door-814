# PROJECT_MAP.md

> **Rule for future debugging:** Before fixing any bug, read PROJECT_MAP.md first.
> Then inspect only the files listed under the relevant issue area. Do not scan the
> full repo unless the map is missing or wrong. If more files are needed, explain
> why before opening them.

Dock2Door — role-based logistics platform. Backend is **Supabase only** (Auth +
Postgres + Storage + Edge Functions). There is **no Node/tRPC server**:
`expo/lib/trpc.ts` is a shim that maps `trpc.*` calls straight to Supabase
queries/RPCs.

---

## 1. App structure

**Expo mobile app (`expo/`)**
- `app/` — expo-router screens, one folder per role (see Role map). Root: `_layout.tsx`, `index.tsx` (landing), `auth/`.
- `components/` — shared UI (e.g. `BookingDocs.tsx`, `FinanceScreen.tsx`, `ReviewModal.tsx`, `ui/`).
- `constants/` — `types.ts` (domain types + bootstrap mappers), theme/config.
- `hooks/` — `useDockBootstrap.ts` (all-data query), `useDockData.ts`, `useBreakpoint.ts`.
- `lib/` — `supabase.ts` (client), `trpc.ts` (Supabase shim — the real data layer), `storage-files.ts` (uploads + signed URLs + path builders).
- `providers/` — `ActiveCompanyProvider.tsx` (session-only active company, syncs pg GUC via `set_active_company`).
- `store/` — `auth.ts` (`useAuthStore`: login/logout/session/role).

**Web app (`apps/web/`)** — Next.js app-router
- `app/(app)/<role>/...` — role pages mirroring mobile (see Role map).
- `app/login/`, `middleware.ts` (auth/role gate), `lib/` (supabase + helpers), `components/`, `providers/`.

**Supabase (`supabase/`)**
- `migrations/` — `0001` … `0072` (idempotent, applied in order). Schema, RLS, enums, RPCs, triggers.
- `functions/` — Edge Functions: `get-signed-url`, `cleanup-orphan-files`, `stripe-webhook`, `tracking-webhook`, `push-notifications`, `stripe-connect-onboard`, `stripe-connect-dashboard`, `create-checkout-session`, `process-payouts`, `purchase-shipping-label`, `shopify-*`, `amazon-*`, `channel-sync-worker`.

**Shared/cross-cutting**
- Data access: `expo/lib/trpc.ts` (shim) + `expo/lib/supabase.ts`.
- Types: `expo/constants/types.ts`.

---

## 1b. Domain (world) layer

The app is grouped into two **worlds** plus a shared **Admin** layer. This is pure
UI/routing grouping — no backend, RLS, or access-rule impact. Source of truth:
`expo/lib/access.ts` (`DOMAIN_BY_ROLE`, `LABOUR_ROLES`, `LOGISTICS_ROLES`, `ADMIN_ROLES`,
`visibleDomains()`, `domainForSegment()`, `ENABLE_DOMAINS` flag).

- **Labour** → `Worker`, `Employer`.
- **Logistics & Warehousing** → `Customer`, `WarehouseProvider`, `ServiceProvider`, `TruckingCompany`, `GateStaff`, `Driver` (Fulfillment is a feature area here).
- **Shared Admin (both worlds)** → `Admin`, `SuperAdmin`.

Key files:
- `expo/providers/CurrentWorldProvider.tsx` — session-only active world (not persisted; re-inferred from route via `domainForSegment`).
- `expo/components/WorldSwitcher.tsx` — header pill, shown only when `visibleDomains(user).length > 1` (dual-role users + admins). Placed in `worker/employer/customer/admin` home headers.
- Post-login routing: `expo/app/_layout.tsx` `resolveHome()` (world-aware, behind `ENABLE_DOMAINS`).
- Landing & sign-up grouped by world: `expo/app/index.tsx`, `expo/app/auth/signup.tsx`.
- Web parity (landing/middleware/switcher in `apps/web`) is NOT done yet.

---

## 2. Role map

Mobile path = `expo/app/<role>/`. Web path = `apps/web/app/(app)/<role>/`.

### Super Admin (`super-admin/`)
- Screens: `index` (overview), `controls`, `data-manager`, `analytics`, `billing`, (web also `roles`).
- Hooks: `useDockBootstrap`, `useAuthStore`.
- RPCs: `admin_set_company_status`, `admin_set_company_approval`, `admin_set_user_status`, `admin_grant_role`, `admin_revoke_role`, `admin_force_booking_status`.
- Tables: `companies`, `users`/`profiles`, `user_roles`, `audit_logs`, all business tables (read).

### Admin (`admin/`)
- Screens: `index`, `users`, `companies`, `certifications`, `compliance`, `disputes`, `bookings`, `entities`, `audit-logs`, `labour-calendar`, `work-photos`, `platform-settings`, `system-health`, `notifications-health`, `billing`, `shipping-carriers`.
- Hooks: `useDockBootstrap`, `useAuthStore`.
- RPCs: `admin_set_company_status`/`admin_set_company_approval`, `admin_set_user_status`, `admin_set_listing_status`, `admin_approve_certification`, `admin_reject_certification`, `admin_assign_worker_to_shift`, `admin_approve_time_entry`, `admin_moderate_work_photo`.
- Tables: `companies`, `worker_certifications`, `warehouse_listings`, `disputes`, `audit_logs`, `time_entries`, `work_photos`.

### Employer (`employer/`)
- Screens: `index`, `create-shift`, `shifts`, `hours`, `calendar`, `browse-workers`, `billing`.
- Hooks: `useDockBootstrap`.
- RPCs: `shifts.create`/`employer_update_shift`, `employer_accept_applicant`, `employer_reject_applicant`, `employer_confirm_hours`, `cancel_shift_with_reason`.
- Tables: `shifts`, `shift_applications`, `shift_assignments`, `time_entries`, `shift_attachments`, `companies` (status gate: `Approved`).

### Worker (`worker/`)
- Screens: `index`, `browse`, `my-shifts`, `availability`, `earnings`, `profile`, `shift-confirm`, `[id]` (public profile).
- Hooks: `useDockBootstrap`.
- RPCs: `worker_apply_shift`, `worker_clock_in` (cert-enforced), `worker_clock_out`, `certifications.create`.
- Tables: `worker_profiles`, `worker_certifications`, `shifts`, `shift_applications`, `shift_assignments`, `time_entries`. Storage: `certifications/`, `worker-photos/`.

### Customer (`customer/`)
- Screens: `index`, `warehouses`, `bookings`, `services`, `orders`, `inventory`, `billing`, (web also `tracking`, `invoices`).
- Hooks: `useDockBootstrap`.
- RPCs: `bookings.create`/`transition_booking`, `serviceJobs.create`, `request_rma`, `post_review`, `create-checkout-session` (edge fn).
- Tables: `warehouse_listings`, `warehouse_bookings`, `services`, `service_jobs`, `orders`, `stock_levels`, `invoices`.

### Warehouse Provider (`warehouse-provider/`)
- Screens: `index`, `listings`, `create-listing`, `bookings`, `staff`, `billing`, `carriers`, `stripe-connect`, `wms`, `stations` + `station-{receiving,picking,packing,shipping,inventory,dock}`.
- Hooks: `useDockBootstrap`, `useDockData`, `useActiveCompany`.
- RPCs: `transition_booking`, `warehouses.createListing`, `company_add_member`/`company_remove_member`, `wms_receive`, `wms_adjust`, `wms_reserve`, `gate_record_event`.
- Tables: `warehouse_listings`, `warehouse_bookings`, `booking_status_history`, `warehouse_locations`, `stock_levels`, `stock_movements`, `inventory_receipts`, `gate_events`, `company_users`. Storage: `warehouse-docs/`, `booking-docs/`.

### Service Provider (`service-provider/`)
- Screens: `index`, `listings`, `create-listing`, `jobs`, `billing`.
- Hooks: `useDockBootstrap`.
- RPCs: `transition_service_job` (`serviceJobs.{accept,decline,checkIn,complete}`).
- Tables: `services`, `service_jobs`, `service_job_history`.

### Trucking (`trucking-company/` mobile, `trucking/` web)
- Screens: `index`/`dispatch`, `appointments`, `fleet`, `finance`, `messages`, (web also `pod`).
- Hooks: `useDockBootstrap`.
- RPCs: `gate_record_event`, appointment/yard RPCs, `attach_pod`.
- Tables: `appointments`, `yard_moves`, `gate_events`, `pods`, `fleet`/vehicles.

### Fulfillment (`fulfillment/`)
- Screens: `shipments`, `manifest`, `rate-shop`, `returns`, `integrations`, (web also `orders`), `[bookingId]`.
- Hooks: `useDockBootstrap`.
- RPCs/Edge: `create_shipment_for_order`, `attach_shipment_label`, `request_rma`, `channel_*` RPCs + `shopify-*`/`amazon-*` edge functions, `purchase-shipping-label`.
- Tables: `shipments`, `shipment_packages`, `tracking_events`, `return_authorizations`, `carrier_accounts`, `sales_channels`, `channel_orders`, `sku_mappings`.

---

## 3. Debug routing map (check these files first)

- **Company approval / status** → `expo/lib/trpc.ts` (`admin.setCompanyStatusAudited`), `expo/app/admin/companies.tsx`, `expo/app/super-admin/{data-manager,controls}.tsx`, `expo/app/admin/compliance.tsx`, migrations `0058`/`0068`/`0069`/`0071` (`admin_set_company_status`, `admin_set_company_approval`).
- **Worker certification approval** → `expo/app/admin/certifications.tsx`, `expo/app/worker/profile.tsx`, `expo/lib/trpc.ts` (`certifications.*`), migrations `0005`/`0007` (`admin_approve_certification`, `admin_reject_certification`).
- **Employer shift creation** → `expo/app/employer/create-shift.tsx`, `apps/web/app/(app)/employer/create-shift/page.tsx`, `expo/lib/trpc.ts` (`shifts.*`), migration `0008`/`0024`, company status gate (`Approved`).
- **Login / auth / session** → `expo/store/auth.ts`, `expo/app/_layout.tsx`, `expo/app/auth/*`, `expo/lib/supabase.ts`, `apps/web/middleware.ts`.
- **Notifications** → `expo/app/notifications/*`, migrations `0014`/`0029`/`0037`/`0072` (`notification_kind` enum + `queue_notification`/`tg_notify_*` triggers), Edge fn `push-notifications`, `expo/app/admin/notifications-health.tsx`.
- **Supabase migration / RPC** → `supabase/migrations/` (find the latest `create or replace function`), `expo/lib/trpc.ts` (caller), `supabase/LIVE_VERIFICATION.sql`.
- **RLS / permission** → relevant migration's `create policy` blocks, helpers `is_admin`/`is_member_of`/`can_employer_see_worker` (migrations `0003`/`0005`), `expo/providers/ActiveCompanyProvider.tsx` (`set_active_company` GUC).
- **Payment / Stripe** → `expo/components/FinanceScreen.tsx`, migrations `0011`/`0015`, Edge fns `stripe-webhook`, `create-checkout-session`, `stripe-connect-onboard`, `stripe-connect-dashboard`, `process-payouts`.
- **Warehouse booking** → `expo/app/warehouse-provider/bookings.tsx`, `expo/app/customer/bookings.tsx`, `expo/lib/trpc.ts` (`bookings.*` → `transition_booking`), migration `0004` (`booking_transitions`, `enforce_booking_transition`), `0046`.
- **WMS / inventory** → `expo/app/warehouse-provider/{wms,station-*}.tsx`, `expo/hooks/useDockData.ts`, `expo/lib/trpc.ts` (`wms.*`), migration `0012`.
- **Shipping / tracking** → `expo/app/fulfillment/*`, migration `0013`, Edge fns `tracking-webhook`, `purchase-shipping-label`.

---

## 4. Status enum reference

Source: `supabase/migrations/0001_init.sql` unless noted.

- **company_status**: `PendingApproval`, `Approved`, `Suspended` — (NOT `Active`/`Rejected`).
- **active_status** (users/listings/etc.): `Active`, `Suspended`, `Inactive`.
- **worker_certification_status** (`certification_status`, 0005): `Pending`, `Approved`, `Rejected`, `Expired`.
- **shift_status**: `Draft`, `Posted`, `Filled`, `InProgress`, `Completed`, `Cancelled` (apply only allowed when `Posted`).
- **booking_status**: `Requested`, `Countered`, `Accepted`, `InProgress`, `Completed`, `Cancelled`, `Declined`.
- **payment_status**: base (0001) `Pending`, `Paid`, `Refunded`; extended (0011/0029) `Authorized`, `Captured`, `Failed`, `PartiallyRefunded`.
- **notification_kind**: `system`, `info`, `thread_message`, `booking_status`, `worker_assigned`, `shift_changed`, `shift_cancelled`, `payment`, `review` (0029/0037) + `company_pending`, `booking_counter_offer`, `shift_accepted`, `shift_rejected`, `hours_confirmed`, `cert_approved`, `cert_rejected` (0072).

---

## 5. Key invariants

- Company status is only `PendingApproval`/`Approved`/`Suspended`. Never send `Active`/`Rejected` for companies.
- Two company-approval RPCs exist: `admin_set_company_status` (notifies members, no rejection reason) and `admin_set_company_approval` (stores `approval_rejection_reason`). Both normalize to the enum above.
- Admin writes go through SECURITY DEFINER `admin_*` RPCs that write `audit_logs`; never mutate sensitive tables directly.
- `expo/lib/trpc.ts` is a Supabase shim, not a server — schema column mismatches there surface as `[trpc-shim] procedure error`.
- React Query invalidation keys are plain arrays, e.g. `['dock','bootstrap']` (no `{ type: 'query' }` wrapper).
