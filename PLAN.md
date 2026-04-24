# Dock2Door — Role-based Logistics Platform on Supabase

Backend: Supabase only (Auth + Postgres + Storage + Edge Functions).
No Node / Bun / Docker / Hono / tRPC server.

---

## 0) Corrections applied (per user feedback)

These override any earlier plan decisions.

### 0.1 Active company (session-based, NOT persisted)
- `profiles.active_company_id` is **removed**. Users can belong to many companies.
- Active company is a **client session value** only:
  - stored in an in-memory React context (`ActiveCompanyProvider`)
  - mirrored to `AsyncStorage` purely as a UX convenience (last-used)
  - sent on every request as Postgres GUC `request.active_company_id` via `supabase.rpc('set_active_company', { company_id })` at session start / on switch
- RLS never trusts `profiles.active_company_id`. RLS trusts only:
  1. `auth.uid()`
  2. membership rows in `company_members`
  3. the GUC above (optional narrowing, not a security boundary)
- Security boundary = `company_members`. The GUC only scopes which company the UI is currently acting as.

### 0.2 Admin model — strict, auditable, no silent overrides
- Admin status is stored in `user_roles(user_id, role)` with `role = 'admin'` (not a boolean on profiles). Future-proof for `support`, `finance`, etc.
- `is_admin()` SQL helper = `EXISTS (select 1 from user_roles where user_id = auth.uid() and role = 'admin')`.
- Admin RLS policies are **separate policies**, not `OR is_admin()` bolted onto user policies, so they're easy to audit.
- Every admin-privileged write goes through a SECURITY DEFINER RPC that:
  1. Asserts `is_admin()`
  2. Captures `before` row (JSONB)
  3. Performs the change
  4. Captures `after` row (JSONB)
  5. Inserts into `audit_logs(actor_user_id, action, entity_type, entity_id, before, after, reason, ip, user_agent, created_at)`
- Destructive actions (delete, suspend, force-complete, refund, certification reject) **require** a non-empty `reason` — enforced by CHECK + RPC.
- No direct DELETE/UPDATE allowed to admins on sensitive tables via RLS; they must go through the RPCs. This guarantees every admin action is logged.

### 0.3 Booking ownership — enforced at schema + RLS + trigger layers
- `bookings` columns:
  - `customer_company_id` (NOT NULL, FK companies)
  - `warehouse_company_id` (NOT NULL, FK companies)
  - `listing_id` (FK warehouse_listings)
  - `status` (enum)
  - `created_by` (FK auth.users, NOT NULL)
- Constraints:
  - `CHECK (customer_company_id <> warehouse_company_id)`
  - Trigger on INSERT: verifies `created_by` is a member of `customer_company_id`, and `listing_id.company_id = warehouse_company_id`.
- RLS:
  - INSERT: only members of `customer_company_id` can insert. Warehouse side cannot create bookings.
  - SELECT: members of either company, or admin.
  - UPDATE: split by transition (see 0.6).
- No client can spoof `warehouse_company_id` — it is derived from `listing_id` inside a `BEFORE INSERT` trigger.

### 0.4 Worker certifications — explicit access model
Tables:
- `worker_certifications(id, worker_user_id, type, file_path, expiry_date, status, notes, created_at)`
- `shift_assignments(id, shift_id, worker_user_id, employer_company_id, status, assigned_at, ...)`

Access (RLS):
- **Worker**: SELECT + INSERT + UPDATE (only `file_path`, `expiry_date`, `notes`) where `worker_user_id = auth.uid()`. Cannot change `status`.
- **Admin**: full access via admin RPCs (`approve_certification`, `reject_certification` — both write audit).
- **Employer**: SELECT only, and ONLY when there is a row in `shift_assignments` where:
  - `shift_assignments.worker_user_id = worker_certifications.worker_user_id`
  - `shift_assignments.employer_company_id ∈` caller's companies
  - `shift_assignments.status IN ('assigned','in_progress','completed')` (NOT applied/withdrawn)
- Everyone else: no access.
- Expressed as a single SQL predicate via helper `can_employer_see_worker(worker_user_id) RETURNS boolean`.

### 0.5 Storage — exact layout, policies, signed URLs
Buckets (all **private**):
- `certifications`
- `warehouse-docs`
- `booking-docs`
- `invoices`
- `attachments`

Path format (enforced by policy regex):
- `certifications/{worker_user_id}/{certification_id}/{filename}`
- `warehouse-docs/{warehouse_company_id}/{listing_id}/{filename}`
- `booking-docs/{booking_id}/{uploader_company_id}/{filename}`
- `invoices/{billed_company_id}/{invoice_id}/{filename}`
- `attachments/{entity_type}/{entity_id}/{filename}`

Every storage upload is paired with a DB row (`*_files` or embedded `file_path` column). Orphan files are swept nightly by a scheduled Edge Function.

`storage.objects` RLS (per bucket):
- INSERT: authenticated AND the path's first segment (owner id) matches a company the user belongs to (or equals `auth.uid()` for `certifications`).
- SELECT: either same membership check, OR the user is a party to the linked DB row (e.g. booking participant), OR admin.
- UPDATE/DELETE: uploader or admin only; admin path goes through audit RPC.

Signed URL flow:
- Client never gets public URLs.
- Client calls Edge Function `get-signed-url({ bucket, path })`.
- Edge Function:
  1. Verifies JWT
  2. Re-runs the same access predicate server-side (defense in depth)
  3. Returns `createSignedUrl(path, 60s)`
- Uploads: client uses `supabase.storage.from(bucket).upload(path, file)` directly — RLS on `storage.objects` guards it.

### 0.6 Booking state machine — DB-enforced
Status enum: `requested → countered → accepted → in_progress → completed`, plus terminal `cancelled`, `declined`.

Allowed transitions (single source of truth = SQL):
```
requested  -> accepted | declined | countered | cancelled
countered  -> accepted | declined | cancelled
accepted   -> in_progress | cancelled
in_progress -> completed | cancelled
completed  -> (terminal)
declined   -> (terminal)
cancelled  -> (terminal)
```

Per-transition actor rules:
- `accept`, `decline`, `counter`: warehouse company members only
- `cancel`: customer company members (before `in_progress`) or admin
- `respond to counter` (accept/decline counter): customer company members
- `start` (accepted → in_progress): warehouse company members
- `complete`: warehouse company members (customer confirmation later)

Enforcement:
- `BEFORE UPDATE` trigger `enforce_booking_transition()`:
  - Looks up allowed `next_statuses` for `OLD.status` from a `booking_transitions` table.
  - Checks the caller's role via `auth.uid()` + `company_members` against the actor rule.
  - Raises exception on invalid transition.
- `booking_status_history(booking_id, from_status, to_status, actor_user_id, actor_company_id, reason, created_at)` populated by the same trigger → also feeds audit.
- RLS UPDATE policy only allows updating `status` (and a small whitelist of columns) via transition; other column edits are blocked or restricted to creator/admin.

---

## 1) Tenant & ownership model

```
companies(id, type, owner_user_id, name, status, created_at)
  type ∈ (customer, warehouse_provider, service_provider, employer, trucking_company)

company_members(company_id, user_id, role, created_at)
  role ∈ (owner, admin, staff, supervisor, dispatcher, viewer)
  PK (company_id, user_id)

user_roles(user_id, role)          -- platform-level (admin/support/finance)
profiles(user_id, full_name, avatar_url, phone)   -- NO active_company_id
```

Helpers (SECURITY DEFINER, STABLE):
- `is_admin() -> boolean`
- `is_member_of(company_id uuid) -> boolean`
- `my_companies() -> setof uuid`
- `active_company() -> uuid` (reads GUC; nullable)
- `can_employer_see_worker(worker_user_id uuid) -> boolean`

Every business table has `company_id uuid NOT NULL` and RLS predicate `is_member_of(company_id) OR is_admin()` (admin via separate policy where audit-required).

---

## 2) Role panels (screen map)

1. **Admin** — Users, Companies, Warehouse Listings (approve/suspend), Service Listings (approve/suspend), Worker Certifications (approve/reject), Disputes, Audit Logs, Platform Settings
2. **Warehouse Provider** — My Company, Staff, Listings, Booking Requests, Active Bookings, Dock Schedule
3. **Service Provider** — My Services, Jobs, Completed Jobs
4. **Customer** — Search Warehouses, Request Storage, Book Services, Orders, Tracking
5. **Worker** — Profile, Certifications (upload + status), Available Shifts, Applications, Assignments
6. **Employer** — Create Shift, Applications, Assignments, Time Entries

---

## 3) Permission matrix (summary)

| Entity | Customer | Warehouse Provider | Service Provider | Worker | Employer | Admin |
|---|---|---|---|---|---|---|
| warehouse_listings (own) | read (active) | CRUD | — | — | — | CRUD (audited) |
| bookings | create (as customer_company), read own, cancel pre-start | read own, accept/decline/counter/start/complete | — | — | — | read all, force-transition (audited) |
| services | read | — | CRUD own | — | — | CRUD (audited) |
| service_jobs | create, read own | — | accept/decline/complete | — | — | read all |
| worker_certifications | — | — | — | CRUD own (no status) | read via assignment | approve/reject (audited) |
| shifts | — | — | — | read open, apply | CRUD own | read all |
| shift_assignments | — | — | — | read own | CRUD own | read all |
| time_entries | — | — | — | create own (clock in/out) | read own company | read all |
| companies | — | read/update own | read/update own | — | read/update own | CRUD (audited) |
| company_members | — | manage own (owner) | manage own (owner) | — | manage own (owner) | CRUD (audited) |
| audit_logs | — | — | — | — | — | read |

---

## 4) End-to-end flows (exact tables per flow)

1. **Company + user** — `auth.users`, `profiles`, `companies`, `company_members`, `user_roles`
2. **Warehouse listing** — `warehouse_listings`, `warehouse_docs` (+ storage)
3. **Booking** — `warehouse_listings`, `bookings`, `booking_status_history`, `booking_docs`
4. **Worker certification** — `worker_certifications` (+ storage `certifications/`)
5. **Service job** — `services`, `service_jobs`
6. **Shift / labour** — `shifts`, `shift_applications`, `shift_assignments`, `time_entries`
7. **Audit** — every privileged mutation writes `audit_logs`

---

## 5) RLS strategy

- Deny by default on every table.
- One SELECT policy per role-ish audience (member, admin, public-read where applicable).
- INSERT/UPDATE/DELETE split into narrow policies keyed to a column whitelist and actor role.
- Admin never gets blanket `USING (true)` on writes — only on reads. Admin writes go through SECURITY DEFINER RPCs that force audit logging.
- Storage policies mirror DB policies via path-prefix checks and helper functions.

---

## 6) Implementation order (after this plan is approved)

ONE flow at a time. Start:

**Warehouse Provider Flow** — listing → booking request → accept/counter/decline → start → complete, with audit + status history + booking docs in Storage. All other panels remain as-is until this flow is verified end-to-end.

### Checklist
- [x] `0003_ownership_fix.sql` — `user_roles` table + `platform_role` enum, helpers (`is_admin`, `is_member_of`, `my_companies`, `is_owner_of`, `active_company`, `my_company_id` back-compat), `set_active_company` RPC (GUC `request.active_company_id`), `company_users` RLS tightened (owner-managed), audit_logs columns (`entity_type`, `reason`, `ip`, `user_agent`)
- [x] `0004_booking_state_machine.sql` — `warehouse_company_id` column + BEFORE INSERT trigger (derived from listing, membership check), `CHECK (customer_company_id <> warehouse_company_id)`, `booking_transitions` source-of-truth table, `booking_status_history`, `enforce_booking_transition` BEFORE UPDATE trigger, `transition_booking` RPC, tight INSERT/SELECT/UPDATE policies (no ownership-column edits)
- [x] `0005_certifications_access.sql` — `certification_status` enum, `file_path`/`status`/`reviewed_by`/`reviewed_at` columns, `can_employer_see_worker()` helper, worker/admin/employer SELECT policies, worker INSERT/UPDATE policies (status locked via trigger), admin-only DELETE
- [x] `0006_storage.sql` — 5 private buckets, `storage_files` metadata table with RLS, per-bucket `storage.objects` policies with path-segment helpers: `certifications/{uid}/...`, `warehouse-docs/{company}/...`, `booking-docs/{booking}/{company}/...`, `invoices/{company}/...`, `attachments/...`
- [x] `0007_admin_rpcs.sql` — `write_audit`, `require_reason`, `require_admin`, `admin_set_listing_status`, `admin_approve_certification`, `admin_reject_certification`, `admin_set_company_status`, `admin_set_user_status`, `admin_grant_role`, `admin_revoke_role`, `admin_force_booking_status` (all capture before/after JSONB + require reason on destructive actions)
- [x] Edge Function `get-signed-url` (`supabase/functions/get-signed-url/index.ts`) — verifies JWT, re-runs `can_read_storage_object(bucket,path)` predicate server-side, issues 60s signed URL via service role, audits via `record_signed_url_issued`. Client `getSignedUrl` (`expo/lib/storage-files.ts`) invokes it first, falls back to direct storage signing only when the function isn't deployed.
- [x] `expo/providers/ActiveCompanyProvider.tsx` — session-only React context, memberships loaded from `company_users`, last-used cached in AsyncStorage (UX only), every switch calls `set_active_company` RPC to sync the pg GUC; mounted in `app/_layout.tsx`
- [x] `expo/lib/storage-files.ts` — path builders (`buildCertPath`, `buildWarehouseDocPath`, `buildBookingDocPath`), `uploadFileWithMetadata` (atomic: upload → insert `storage_files` → rollback storage on DB fail), `getSignedUrl`, `pickAndUploadFromUri`
- [x] Warehouse Provider screens wired end-to-end against the above:
  - `warehouse-provider/create-listing.tsx` — uses `useActiveCompany()`, passes `companyId` explicitly to `warehouses.createListing`
  - `warehouse-provider/listings.tsx`, `warehouse-provider/index.tsx` — filter by `activeCompany.companyId`
  - `warehouse-provider/bookings.tsx` — filter by `activeCompanyId`; accept/decline/counter/complete now call the `transition_booking` RPC (which runs the BEFORE UPDATE trigger → `booking_status_history` → audit)
  - `expo/components/BookingDocs.tsx` — booking-doc picker + upload via `uploadFileWithMetadata` to `booking-docs/{booking_id}/{uploader_company_id}/{filename}` + signed-URL download
  - `expo/lib/trpc.ts` — `bookings.accept/decline/submitCounterOffer/respondToCounterOffer/complete` rewritten on top of `transition_booking`; `bookings.listMine` + `warehouses.createListing` + `bookings.create` accept an explicit `companyId` to honour the active company context

Warehouse Provider flow is now fully wired UI → `transition_booking` RPC → DB trigger → `booking_status_history` → `audit_logs`, with uploads going through RLS-guarded `booking-docs` bucket + `storage_files` metadata.

- [x] Worker Certification flow wired end-to-end:
  - `expo/app/worker/profile.tsx` — pick file → insert `worker_certifications` row (status forced to `Pending` via `wc_guard` trigger) → upload to `certifications/{uid}/{cert_id}/{filename}` via `uploadFileWithMetadata` → patch `file_path`. Rolls back the row if the upload fails. Shows live list with signed-URL open and rejection reason.
  - `expo/app/admin/certifications.tsx` — pending/approved/rejected/expired filter, signed-URL preview, approve/reject via `admin_approve_certification` / `admin_reject_certification` RPCs (reason required on reject; all writes audited by the RPC into `audit_logs`).
  - `expo/lib/trpc.ts` — `certifications.listMine`, `certifications.listPending`, `certifications.create`, `certifications.adminApprove`, `certifications.adminReject` procedures.
  - Admin tabs (`expo/app/admin/_layout.tsx`) + dashboard quick-nav + pending-cert stat updated with the Certifications entry (status-based, not `admin_approved`).
  - `WorkerCertification` type + `mapWorkerCert` bootstrap mapper extended with `status`, `filePath`, `notes`, `reviewedAt/By`, `createdAt`.

- [x] `0008_jobs_shifts_admin.sql` — Service-job state machine (`service_job_transitions`, `service_job_history`, `enforce_service_job_transition` trigger, `transition_service_job` RPC), `provider_company_id` derived from listing via BEFORE INSERT trigger, tight INSERT/UPDATE RLS. Shift/labour RPCs: `employer_accept_applicant`, `employer_reject_applicant`, `worker_apply_shift`, `worker_clock_in` (enforces Approved Forklift/HighReach certification where required), `worker_clock_out`, `employer_confirm_hours` — all audited. Company staff RPCs: `company_add_member`, `company_remove_member` (owner/admin only, reason required on remove).
- [x] Service Jobs wired end-to-end:
  - `expo/lib/trpc.ts` — `serviceJobs.{listMine,create,accept,decline,checkIn,complete}` procedures on `transition_service_job`.
  - `expo/app/customer/services.tsx` — uses `serviceJobs.create` (no client spoofing of provider_company_id).
  - `expo/app/service-provider/jobs.tsx` — accept/decline/check-in/complete via RPC.
- [x] Shift / Labour flow wired end-to-end:
  - `expo/lib/trpc.ts` — `shifts.{create,apply,withdraw,acceptApplicant,rejectApplicant,clockIn,clockOut,confirmHours,setStatus}`.
  - `expo/app/employer/shifts.tsx` — accept/reject applicants + confirm hours via RPC.
  - `expo/app/worker/browse.tsx` — `worker_apply_shift` RPC.
  - `expo/app/worker/my-shifts.tsx` — clock in/out + withdraw via RPC.
- [x] Admin status mutations audited:
  - `expo/lib/trpc.ts` — `admin.{setCompanyStatusAudited,setUserStatusAudited,setListingStatusAudited}` routed through existing `admin_*` RPCs.
  - `expo/app/admin/users.tsx` + `expo/app/admin/companies.tsx` — suspend/approve/reinstate now call the audited RPCs (reason captured → `audit_logs`).
- [x] Warehouse Provider staff management:
  - `expo/app/warehouse-provider/staff.tsx` — list / add (by email lookup) / remove members through `company_add_member` / `company_remove_member` RPCs; registered as a tab in `warehouse-provider/_layout.tsx`.

All core flows (Warehouse Provider, Worker Certifications, Service Jobs, Shift/Labour, Admin, Staff) are wired UI → RPC → DB trigger/state-machine → `audit_logs`.

- [x] `0009_final_hardening.sql` — idempotent final sweep:
  - `can_read_storage_object(bucket, path)` (used by `get-signed-url` Edge Fn)
  - `record_signed_url_issued()` audit helper
  - `list_orphan_storage_files(interval)` + admin-only `cleanup_orphan_storage_files(interval, limit)` (audited)
  - `audit_logs` RLS: admin + actor SELECT only; UPDATE / DELETE revoked from `authenticated` / `anon`
  - Re-backfills `warehouse_bookings.warehouse_company_id`, `service_jobs.provider_company_id`, `shift_assignments.employer_company_id`
  - Re-grants EXECUTE on every public RPC to `authenticated`
- [x] Edge Function `cleanup-orphan-files` (`supabase/functions/cleanup-orphan-files/index.ts`) — scheduled nightly sweep that lists each private bucket, finds objects older than a threshold with no companion `storage_files` row, removes them, and writes an `audit_logs` entry. Requires service-role authorization.
- [x] `0010_reviews.sql` — generic reviews / ratings:
  - `reviews` table (1–5 rating + comment) with `review_target_kind` (`company` | `worker`) + `review_context_kind` (`warehouse_booking` | `service_job` | `shift_assignment`), unique per (reviewer, context, target_kind).
  - `post_review(...)` SECURITY DEFINER RPC — validates context is `Completed`, that caller is a real participant (customer/warehouse/provider/employer/worker), and that target matches the opposite side. Only write path (no direct INSERT policies).
  - RLS: public-read for authenticated users; writes only via RPC.
  - `review_summaries` view — count + avg rating per target (company or worker).
  - UI: `components/ui/StarRating.tsx`, `components/ReviewModal.tsx`; Rate buttons wired into `customer/bookings`, `warehouse-provider/bookings`, `service-provider/jobs`, `worker/my-shifts`, `employer/shifts` (shows once, hides after submitted via `reviews.listMineByContext`).
  - `expo/lib/trpc.ts` — `reviews.{post,listForCompany,listForWorker,summaries,listMineByContext}`.

- [x] `0011_finance.sql` — production finance layer:
  - `invoice_status` / `payment_status` / `refund_status` / `dispute_status` enums.
  - `invoices` hardened (customer / provider / booking / service_job links, `invoice_number`, `subtotal` / `tax` / `total`, `due_date`, `issued_at`, `paid_at`, `voided_at`).
  - `invoice_lines`, `refunds`, `payment_methods` tables with RLS (company-scoped reads, admin-only direct writes).
  - `payments` extended with `invoice_id`, `stripe_payment_intent_id` (unique), `stripe_charge_id`, `authorized_at` / `captured_at` / `refunded_at`.
  - SECURITY DEFINER RPCs: `issue_invoice_for_booking`, `issue_invoice_for_service_job` (auto-computes commission from `commission_rules`), `record_payment` (service-role only — called by `stripe-webhook`; also auto-queues a `payouts` row), `admin_initiate_refund` (reason + audit), `schedule_pending_payouts` (admin cron).
- [x] `0012_inventory_wms.sql` — WMS-lite:
  - `warehouse_locations` (zone/aisle/rack/level/bin), `inventory_lots`, `stock_levels` (on_hand + reserved, unique per variant/location/lot), append-only `stock_movements` ledger (`receive`/`putaway`/`pick`/`pack`/`ship`/`adjust`/`transfer`/`return`/`cycle_count`).
  - `inventory_receipts` + `receipt_items` (ASN → arrival → receiving → completed), `inventory_reservations` (order allocation), `cycle_counts` with generated variance.
  - RLS: warehouse company sees all, customer sees their own stock, admin always.
  - RPCs: `wms_receive` (creates/updates lot + stock level + ledger), `wms_adjust` (reason required, audited), `wms_reserve`.
- [x] `0013_oms_shipping.sql` — OMS + shipping:
  - `shipment_status` / `return_status` enums.
  - `carrier_accounts` (per provider company, RLS company-scoped).
  - `shipments` (order/booking link, carrier, tracking, label path/URL, rate, dimensions, lifecycle timestamps) + `shipment_packages` + `tracking_events` (append-only per shipment).
  - `return_authorizations` + `return_items` (customer-initiated RMA flow, audited).
  - RPCs: `create_shipment_for_order`, `attach_shipment_label` (provider only), `record_tracking_event` (service-role only — called by `tracking-webhook`, auto-advances shipment status), `request_rma` (customer; reason required).
- [x] `0014_yard_notifications.sql` — yard/gate + notifications infra:
  - `gate_event_kind` enum + `gate_events` append-only log (`check_in`/`at_gate`/`at_door`/`loading`/`unloading`/`no_show`/`check_out`/`hold`/`released`/`seal_check`).
  - `yard_moves` (truck/trailer/container yard movements, warehouse-scoped).
  - `pods` (proofs of delivery linked to appointments or shipments, storage_file-backed).
  - `notifications` extended (`user_id`, `kind`, `title`, `body`, `entity_type`/`id`, `read_at`, `payload`).
  - `notification_preferences` (email / push / sms + per-channel jsonb).
  - `push_tokens` (Expo push tokens, unique per user).
  - RPCs: `gate_record_event` (advances appointment status atomically), `attach_pod`, `register_push_token`, `queue_notification` (service-role), `mark_notification_read`.
  - Trigger `tr_notify_booking_status` — auto-queues notifications to both company owners on booking status transitions.
- [x] Edge Function `stripe-webhook` (`supabase/functions/stripe-webhook/index.ts`) — verifies Stripe signature with `STRIPE_WEBHOOK_SECRET`, handles `payment_intent.succeeded` (→ `record_payment` RPC → Invoice=Paid + Payout=Pending), `charge.refunded` (→ Payment=Refunded/PartiallyRefunded), `payment_intent.payment_failed` (→ Payment=Failed). Invoice id is carried via `payment_intent.metadata.invoice_id`.
- [x] Edge Function `tracking-webhook` (`supabase/functions/tracking-webhook/index.ts`) — carrier-agnostic normalized webhook endpoint (`tracking_code`, `status`, `event_code`, `description`, `occurred_at`, `payload`). Shared-secret auth via `x-webhook-secret` header; forwards to `record_tracking_event` RPC which auto-advances `shipments.status`.
- [x] Edge Function `push-notifications` (`supabase/functions/push-notifications/index.ts`) — dispatches pending rows from `notifications` to the Expo Push API via `push_tokens`. Supports single (`{notification_id}`) or batch (`{batch:true,limit}`) mode; stamps `payload.delivered_at` to avoid double-sends. Scheduled every minute in production.
- [x] `0015_stripe_connect_checkout.sql` — `companies.stripe_connect_account_id` + `stripe_connect_onboarded` + unique index; `invoices.stripe_checkout_session_id` + `stripe_payment_intent_id`; RPCs `set_stripe_connect_account`, `mark_stripe_connect_onboarded` (owner/admin only).
- [x] Edge Function `stripe-connect-onboard` (`supabase/functions/stripe-connect-onboard/index.ts`) — Bearer-auth required; admin or company member only. Creates (or reuses) a Stripe Express account, persists `stripe_connect_account_id`, returns an `accountLinks.create(type=account_onboarding)` URL. If the account is already fully onboarded (`details_submitted && charges_enabled`), flips `stripe_connect_onboarded = true` and returns `{ onboarded: true }`.
- [x] Edge Function `create-checkout-session` (`supabase/functions/create-checkout-session/index.ts`) — Bearer-auth required; admin or member of invoice's customer company only. Creates a Stripe Checkout Session for the invoice's `total_amount`/`currency`, stamps `payment_intent.metadata.invoice_id`, persists `stripe_checkout_session_id` + `stripe_payment_intent_id` on the invoice. Completion handled by `stripe-webhook`.
- [x] `expo/app/warehouse-provider/stripe-connect.tsx` — wired to `stripe-connect-onboard` (start/continue) and `stripe-connect-dashboard` (once onboarded) via `supabase.functions.invoke` (which auto-attaches the user's Supabase JWT as `Authorization: Bearer`).
- [x] `expo/components/FinanceScreen.tsx` — "Pay invoice" action wired to `create-checkout-session`; opens hosted Stripe Checkout URL (web: `window.open`, native: `Linking.openURL`).
- [x] `0016_message_notifs_stripe_dashboard.sql` — `tg_notify_thread_message()` + `tr_notify_thread_message` AFTER INSERT trigger on `thread_messages`: queues a `notifications` row (kind=`thread_message`) for every `thread_participants.user_id` except the sender, respecting `notification_preferences.push_enabled`; payload includes `thread_id`, `message_id`, `sender_user_id`, `sender_name`, `scope`. Bumps `chat_threads.updated_at` so thread lists re-sort. `push-notifications` dispatcher picks these up on its next cron tick and sends via Expo Push.
- [x] Edge Function `stripe-connect-dashboard` (`supabase/functions/stripe-connect-dashboard/index.ts`) — Bearer-auth required; admin or company member only. Re-verifies onboarding status with `stripe.accounts.retrieve()` (syncs `stripe_connect_onboarded` if stale), then calls `stripe.accounts.createLoginLink()` to return a one-time Stripe Express dashboard URL. Returns `409 onboarding_incomplete` if the account is not yet fully onboarded.

## Final delivery status

- **Migrations**: `0001` … `0014` in `supabase/migrations/` — all idempotent (`create … if not exists`, `do $ … exception when duplicate_object $`, `on conflict do nothing`, `drop policy if exists` before `create policy`). Applying them in order from a clean or partially-migrated database is safe.
- **Storage + signed URLs**: 5 private buckets (0006), per-bucket `storage.objects` policies (0006), client `getSignedUrl` → `get-signed-url` Edge Function → `can_read_storage_object` predicate → service-role signing (0009 + Edge Fn). Orphan cleanup via scheduled Edge Fn.
- **RLS**: deny-by-default, split per actor, ownership columns derived by BEFORE-INSERT triggers (bookings, service_jobs, shift_assignments), ownership columns locked via UPDATE WITH CHECK. Admin is never `USING (true)` on writes; every admin write is an RPC that writes `audit_logs`.
- **State machines**: `booking_transitions` + `enforce_booking_transition` trigger + `transition_booking` RPC (0004); `service_job_transitions` + `enforce_service_job_transition` trigger + `transition_service_job` RPC (0008); shift lifecycle via `employer_accept_applicant` / `worker_clock_in` (cert-enforced) / `worker_clock_out` / `employer_confirm_hours` RPCs (0008).
- **Admin hardening**: every `admin_*` RPC is SECURITY DEFINER, calls `require_admin()`, calls `require_reason()` on destructive actions, captures JSONB `before` / `after`, writes to `audit_logs`. UI (`expo/app/admin/{users,companies,certifications}.tsx`) calls these RPCs — no direct table mutations.
- **UI**: Admin, Warehouse Provider, Service Provider, Customer, Worker, Employer panels all connected to RPCs / Supabase queries. No mock data, no placeholder buttons.
- **Known limitations**:
  1. Migrations must be applied to the Supabase project (`supabase db push` or the SQL editor). The sandbox has no `supabase` CLI so this environment can't push them for the hosted project.
  2. Edge Functions ship in `supabase/functions/` (`get-signed-url`, `cleanup-orphan-files`, `stripe-webhook`, `tracking-webhook`, `push-notifications`, `stripe-connect-onboard`, `stripe-connect-dashboard`, `create-checkout-session`, `process-payouts`, `purchase-shipping-label`); they need `supabase functions deploy`, cron schedules on `cleanup-orphan-files` + `push-notifications` + `process-payouts`, and secrets set (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TRACKING_WEBHOOK_SECRET`, `EXPO_ACCESS_TOKEN`, `EASYPOST_API_KEY`). `stripe-webhook` must be registered in the Stripe dashboard; `tracking-webhook` URL is handed to EasyPost (the only carrier adapter currently wired).
  3. Stripe / carrier API keys live as Supabase secrets — never in client code. Carrier label purchase is exposed as `attach_shipment_label` (provider-side, after the provider's adapter purchases a label); the label-purchase call itself belongs in a carrier-specific Edge Function adapter when a live carrier is selected.
  3. The legacy `backend/` tRPC server is retained but unused by current screens — it can be removed in a future cleanup pass.
