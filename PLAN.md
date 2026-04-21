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
- [ ] Edge Function `get-signed-url` (defense-in-depth; storage RLS is the primary guard — defer until first cross-company signed download is wired)
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

Next flow (per section 6 order): Service Jobs — customer creates `service_jobs` request → provider accept/decline/complete with audit.
