# Dock2Door — Live Production Deployment & Launch Runbook

Launch-ready. Copy-paste exact. No guessing.

Backend = Supabase only (Auth + Postgres + Storage + Edge Functions).
Client = Expo (published via EAS).

Replace `<PROJECT_REF>` with your Supabase project ref (e.g. `abcd1234`).

---

## 1. Full Deployment Checklist

### 1.1 Prerequisites
- Supabase CLI logged in: `supabase login`
- Project linked: `supabase link --project-ref <PROJECT_REF>`
- Stripe live mode account with Connect (Express) enabled
- EasyPost production account
- Expo account + personal access token

### 1.2 Apply database migrations (exact order)

```bash
supabase db push
```

This applies every file in `supabase/migrations/` in lexical order:

| Order | File | Can be skipped if already applied? |
|---|---|---|
| 0001 | `0001_init.sql` | Yes (idempotent) |
| 0002 | `0002_more_tables.sql` | Yes |
| 0003 | `0003_ownership_fix.sql` | Yes |
| 0004 | `0004_booking_state_machine.sql` | Yes |
| 0005 | `0005_certifications_access.sql` | Yes |
| 0006 | `0006_storage.sql` | Yes |
| 0007 | `0007_admin_rpcs.sql` | Yes |
| 0008 | `0008_jobs_shifts_admin.sql` | Yes |
| 0009 | `0009_final_hardening.sql` | Yes |
| 0010 | `0010_reviews.sql` | Yes |
| 0011 | `0011_finance.sql` | Yes |
| 0012 | `0012_inventory_wms.sql` | Yes |
| 0013 | `0013_oms_shipping.sql` | Yes |
| 0014 | `0014_yard_notifications.sql` | Yes |

All migrations are idempotent; re-running is safe.

**Verification queries** (run in Supabase SQL editor):

```sql
-- All expected tables exist
select count(*) = 14 as ok
from (values
  ('profiles'),('companies'),('company_users'),('user_roles'),
  ('warehouse_listings'),('warehouse_bookings'),('booking_status_history'),
  ('worker_certifications'),('shift_assignments'),
  ('invoices'),('payments'),('payouts'),
  ('shipments'),('tracking_events')
) t(n)
where exists (select 1 from information_schema.tables
              where table_schema='public' and table_name=t.n);

-- All expected RPCs exist
select count(*) = 10 as ok
from (values
  ('transition_booking'),('transition_service_job'),
  ('admin_approve_certification'),('admin_reject_certification'),
  ('issue_invoice_for_booking'),('record_payment'),
  ('schedule_pending_payouts'),('record_tracking_event'),
  ('register_push_token'),('queue_notification')
) t(n)
where exists (select 1 from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=t.n);

-- 5 private buckets exist
select count(*) = 5 as ok
from storage.buckets
where id in ('certifications','warehouse-docs','booking-docs','invoices','attachments')
and public = false;
```

Every row must return `ok = true`.

### 1.3 Deploy Edge Functions (exact commands)

```bash
supabase functions deploy get-signed-url
supabase functions deploy cleanup-orphan-files
supabase functions deploy push-notifications
supabase functions deploy create-payment-intent
supabase functions deploy purchase-shipping-label
supabase functions deploy process-payouts         --no-verify-jwt
supabase functions deploy stripe-webhook          --no-verify-jwt
supabase functions deploy tracking-webhook        --no-verify-jwt
```

| Function | `--no-verify-jwt` | Required secrets | Test request |
|---|---|---|---|
| `get-signed-url` | no | — | `curl -X POST https://<PROJECT_REF>.functions.supabase.co/get-signed-url -H "Authorization: Bearer <USER_JWT>" -H "Content-Type: application/json" -d '{"bucket":"booking-docs","path":"<booking_id>/<company_id>/file.pdf"}'` |
| `cleanup-orphan-files` | no (service role) | — | `curl -X POST https://<PROJECT_REF>.functions.supabase.co/cleanup-orphan-files -H "Authorization: Bearer <SERVICE_ROLE_KEY>" -d '{}'` |
| `push-notifications` | no (service role) | `EXPO_ACCESS_TOKEN` | `curl -X POST https://<PROJECT_REF>.functions.supabase.co/push-notifications -H "Authorization: Bearer <SERVICE_ROLE_KEY>" -H "Content-Type: application/json" -d '{"batch":true,"limit":50}'` |
| `create-payment-intent` | no | `STRIPE_SECRET_KEY` | `curl -X POST https://<PROJECT_REF>.functions.supabase.co/create-payment-intent -H "Authorization: Bearer <USER_JWT>" -H "Content-Type: application/json" -d '{"invoice_id":"<INV_UUID>"}'` |
| `purchase-shipping-label` | no | `EASYPOST_API_KEY` | `curl -X POST https://<PROJECT_REF>.functions.supabase.co/purchase-shipping-label -H "Authorization: Bearer <USER_JWT>" -H "Content-Type: application/json" -d '{"shipment_id":"<SHP_UUID>","rate_id":"rate_..."}'` |
| `process-payouts` | **yes** | `STRIPE_SECRET_KEY` | `curl -X POST https://<PROJECT_REF>.functions.supabase.co/process-payouts -H "Authorization: Bearer <SERVICE_ROLE_KEY>" -H "Content-Type: application/json" -d '{"limit":50}'` |
| `stripe-webhook` | **yes** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Triggered by Stripe; local: `stripe listen --forward-to https://<PROJECT_REF>.functions.supabase.co/stripe-webhook` |
| `tracking-webhook` | **yes** | `TRACKING_WEBHOOK_SECRET` | `curl -X POST https://<PROJECT_REF>.functions.supabase.co/tracking-webhook -H "x-webhook-secret: <TRACKING_WEBHOOK_SECRET>" -H "Content-Type: application/json" -d '{"tracking_code":"EZ1000000001","status":"in_transit","event_code":"arrived_at_facility","description":"Arrived","occurred_at":"2026-04-23T12:00:00Z"}'` |

### 1.4 Cron schedules (Supabase Dashboard ▸ Edge Functions ▸ Schedules)

| Function | Cron | Body |
|---|---|---|
| `push-notifications` | `* * * * *` | `{"batch":true,"limit":50}` |
| `cleanup-orphan-files` | `0 3 * * *` | `{"older_than":"24 hours","limit":500}` |
| `process-payouts` | `0 */4 * * *` | `{"limit":50}` |

**Verification** (Supabase SQL editor):
```sql
select jobname, schedule, command
from cron.job
where jobname in ('push-notifications','cleanup-orphan-files','process-payouts');
```
Three rows expected.

### 1.5 Seed first admin

```sql
insert into public.user_roles (user_id, role)
values ('<AUTH_USER_UUID>', 'admin')
on conflict do nothing;
```

---

## 2. Required Secrets (complete list)

Set via `supabase secrets set KEY=VALUE` or Supabase Dashboard ▸ Edge Functions ▸ Secrets.

| Secret | Used by | Example format | Where to get |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `create-payment-intent`, `stripe-webhook`, `process-payouts` | `sk_live_51M...` | Stripe Dashboard ▸ Developers ▸ API keys |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | `whsec_7Hk...` | Stripe Dashboard ▸ Developers ▸ Webhooks ▸ (your endpoint) ▸ Signing secret |
| `STRIPE_CONNECT_CLIENT_ID` | `create-payment-intent`, `process-payouts` | `ca_Ni...` | Stripe Dashboard ▸ Settings ▸ Connect settings |
| `EASYPOST_API_KEY` | `purchase-shipping-label` | `EZAK...` | EasyPost Dashboard ▸ API keys ▸ Production |
| `TRACKING_WEBHOOK_SECRET` | `tracking-webhook` | any 32-char random hex | Generate: `openssl rand -hex 32` — also configured in the EasyPost→Supabase relay worker |
| `EXPO_ACCESS_TOKEN` | `push-notifications` | `xZQy...` | https://expo.dev ▸ Account ▸ Access Tokens |
| `SUPABASE_URL` | all | `https://<ref>.supabase.co` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | all | `eyJ...` | Auto-injected |

Client env (Expo — already in project env):
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

---

## 3. Stripe — Full Live Flow

### 3.1 Payment creation (client → Edge Function)

Client call (authenticated user):
```ts
const { data } = await supabase.functions.invoke('create-payment-intent', {
  body: { invoice_id: invoice.id },
});
// data = { client_secret: 'pi_..._secret_...', payment_intent_id: 'pi_...' }
```

`create-payment-intent` behavior:
1. Verifies JWT, resolves caller.
2. Loads invoice; asserts caller is member of `invoices.customer_company_id`.
3. Creates Stripe PaymentIntent with:
   - `amount = invoice.total * 100` (cents)
   - `currency = 'cad'`
   - `metadata.invoice_id = invoice.id` ← **required**
   - `metadata.customer_company_id`, `metadata.provider_company_id`
   - `transfer_data.destination = provider_stripe_connect_account_id` (if set)
   - `application_fee_amount = commission_from_rule * 100`
4. Inserts `payments` row with `status='Pending'`, `stripe_payment_intent_id`, `invoice_id`.
5. Returns `client_secret` to the client.

### 3.2 Webhook handling (`stripe-webhook`)

Events handled:

| Stripe event | DB effect |
|---|---|
| `payment_intent.succeeded` | `record_payment(invoice_id, payment_intent_id, charge_id, amount)` → `payments.status='Captured'`, `invoices.status='Paid'`, inserts `payouts` row with `status='Pending'` |
| `payment_intent.payment_failed` | `payments.status='Failed'`, `payments.failure_reason=event.last_payment_error.message` |
| `charge.refunded` | `payments.status='Refunded'` or `'PartiallyRefunded'`, writes `refunds` row, updates `invoices.status` accordingly |
| `payout.paid` | matched `payouts.status='Paid'`, `paid_at=now()` |
| `payout.failed` | `payouts.status='Failed'`, `failure_reason=event.failure_message` |
| `account.updated` | `companies.stripe_connect_account_id` onboarding flags refreshed |

Idempotency: every handler upserts keyed on `stripe_payment_intent_id` / `stripe_event_id`; duplicate deliveries are no-ops. The `payments` table has `unique(stripe_payment_intent_id)`.

### 3.3 Payout flow

1. On `payment_intent.succeeded`, `record_payment` inserts `payouts(status='Pending', amount, provider_company_id, …)`.
2. Cron `process-payouts` every 4h:
   - Selects `payouts where status='Pending'` (limit 50).
   - Marks each `status='Processing'`.
   - Calls Stripe `transfers.create({ amount, currency, destination: provider_stripe_connect_account_id, transfer_group: 'invoice_<id>' })`.
   - On success → `payouts.status='Paid'`, `stripe_transfer_id=…`, `paid_at=now()`.
   - On failure → `payouts.status='Failed'`, `failure_reason=err.message`.

### 3.4 Stripe test scenario (end-to-end)

```sql
-- 1. Issue invoice for completed booking
select issue_invoice_for_booking('<BOOKING_UUID>');
-- returns { invoice_id: '...' }
```

```bash
# 2. Customer client: create payment intent
curl -X POST https://<PROJECT_REF>.functions.supabase.co/create-payment-intent \
  -H "Authorization: Bearer <USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"invoice_id":"<INV_UUID>"}'
# → { client_secret: "pi_..._secret_..." }
```

```bash
# 3. Confirm using Stripe test card 4242 4242 4242 4242 (via Stripe PaymentSheet in-app)
#    OR simulate with Stripe CLI:
stripe trigger payment_intent.succeeded \
  --add payment_intent:metadata.invoice_id=<INV_UUID>
```

```sql
-- 4. Verify DB state
select status from invoices where id='<INV_UUID>';            -- 'Paid'
select status from payments where invoice_id='<INV_UUID>';    -- 'Captured'
select status from payouts where invoice_id='<INV_UUID>';     -- 'Pending'
```

```bash
# 5. Run payout processor
curl -X POST https://<PROJECT_REF>.functions.supabase.co/process-payouts \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{"limit":50}'
```

```sql
-- 6. After Stripe confirms transfer + payout.paid webhook
select status, stripe_transfer_id from payouts where invoice_id='<INV_UUID>';
-- 'Paid', 'tr_...'
```

---

## 4. Shipping — Full Live Flow (EasyPost)

### 4.1 Label purchase (`purchase-shipping-label`)

Client request:
```ts
await supabase.functions.invoke('purchase-shipping-label', {
  body: { shipment_id, rate_id },
});
```

Behavior:
1. Verifies JWT; caller must belong to `shipments.provider_company_id`.
2. Loads provider's `carrier_accounts` row → EasyPost account token.
3. Calls EasyPost `POST /shipments/{ep_shipment_id}/buy` with `{ rate: { id: rate_id } }`.
4. On success, calls `attach_shipment_label` RPC with:
   - `carrier`, `tracking_code`, `label_url`, `label_path` (stored in `attachments` bucket), `rate_amount`, `rate_currency`, `purchased_at=now()`.
5. `shipments.status='label_purchased'`, `tracking_code` unique.

Response mapping:

| EasyPost field | DB column |
|---|---|
| `tracking_code` | `shipments.tracking_code` |
| `postage_label.label_url` | `shipments.label_url` |
| `selected_rate.carrier` | `shipments.carrier` |
| `selected_rate.rate` | `shipments.rate_amount` |
| `selected_rate.currency` | `shipments.rate_currency` |

### 4.2 Tracking (`tracking-webhook`)

EasyPost webhook payload is normalized by a relay (since EasyPost doesn't sign). Expected body at the Supabase endpoint:

```json
{
  "tracking_code": "EZ1000000001",
  "status": "in_transit",
  "event_code": "arrived_at_facility",
  "description": "Arrived at carrier facility",
  "occurred_at": "2026-04-23T12:00:00Z",
  "payload": { "...": "full EasyPost tracker event" }
}
```

Header: `x-webhook-secret: <TRACKING_WEBHOOK_SECRET>`.

Behavior:
1. Validates header.
2. Calls `record_tracking_event(tracking_code, status, event_code, description, occurred_at, payload)`.
3. RPC appends to `tracking_events` and updates `shipments.status` via status mapping:
   - `pre_transit` → `label_purchased`
   - `in_transit` → `in_transit`
   - `out_for_delivery` → `out_for_delivery`
   - `delivered` → `delivered`, sets `delivered_at`
   - `return_to_sender` / `failure` → `exception`

### 4.3 Shipping test scenario

```sql
-- 1. Create shipment for order
select create_shipment_for_order('<ORDER_UUID>');
-- returns shipment id
```

```bash
# 2. Provider buys label
curl -X POST https://<PROJECT_REF>.functions.supabase.co/purchase-shipping-label \
  -H "Authorization: Bearer <PROVIDER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"shipment_id":"<SHP_UUID>","rate_id":"rate_abc123"}'
```

```sql
-- 3. Verify
select status, tracking_code, label_url from shipments where id='<SHP_UUID>';
-- 'label_purchased', 'EZ...', 'https://easypost...'
```

```bash
# 4. Simulate tracking update
curl -X POST https://<PROJECT_REF>.functions.supabase.co/tracking-webhook \
  -H "x-webhook-secret: <TRACKING_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"tracking_code":"EZ...","status":"delivered","event_code":"delivered","description":"Delivered","occurred_at":"2026-04-23T15:30:00Z"}'
```

```sql
-- 5. Verify
select status, delivered_at from shipments where tracking_code='EZ...';
-- 'delivered', '2026-04-23 15:30:00+00'
select count(*) from tracking_events where shipment_id='<SHP_UUID>';
-- >= 1
```

---

## 5. Push Notifications — Full Flow

### 5.1 Device registration (Expo client)

```ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

async function registerForPush() {
  if (!Device.isDevice) return;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
  })).data;

  await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS,
  });
}
```

### 5.2 Storage

- `push_tokens(user_id, token, platform, created_at)` — unique on `(user_id, token)`.
- `register_push_token` RPC upserts.

### 5.3 Queuing

Notifications are inserted via `queue_notification(user_id, kind, title, body, entity_type, entity_id, payload)` (service-role only). Booking status transitions auto-queue via trigger `tr_notify_booking_status`.

### 5.4 Delivery (`push-notifications` cron)

Runs every minute:
1. Selects `notifications where payload->>'delivered_at' is null and created_at > now() - interval '7 days'` (limit 50).
2. For each: looks up tokens in `push_tokens`, posts to `https://exp.host/--/api/v2/push/send` with `Authorization: Bearer $EXPO_ACCESS_TOKEN`.
3. On 200: updates `payload = payload || jsonb_build_object('delivered_at', now(), 'tickets', response)`.
4. On `DeviceNotRegistered` error: deletes the stale token.

### 5.5 Push test scenario

```sql
-- 1. Queue a test notification
select queue_notification(
  '<USER_UUID>', 'test', 'Hello', 'This is a test', null, null, '{}'::jsonb
);
```

```bash
# 2. Force dispatch
curl -X POST https://<PROJECT_REF>.functions.supabase.co/push-notifications \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{"batch":true,"limit":50}'
```

```sql
-- 3. Verify
select payload->>'delivered_at' from notifications
where user_id='<USER_UUID>' order by created_at desc limit 1;
-- non-null timestamp
```

---

## 6. Final System Validation Checklist

Each scenario has an exact PASS condition.

### A) Warehouse booking flow
1. Customer creates booking → row in `warehouse_bookings` with correct `customer_company_id`, `warehouse_company_id` (derived), `status='Requested'`.
2. Warehouse accepts via `transition_booking` → `status='Accepted'`; `booking_status_history` row appended.
3. Warehouse starts → `InProgress`. Completes → `Completed`.
4. Both parties post reviews via `post_review` → 2 rows in `reviews`.
**PASS:** `status='Completed'`, 4 `booking_status_history` rows, 2 `reviews` rows.

### B) Service job flow
1. Customer creates service_job → `provider_company_id` derived, `status='Requested'`.
2. Provider accepts, checks in, completes → 3 transitions logged.
**PASS:** `service_jobs.status='Completed'`, 3 `service_job_history` rows.

### C) Labour flow
1. Worker uploads certification → `worker_certifications.status='Pending'`, file in `certifications/{uid}/{id}/…`.
2. Admin approves → `status='Approved'`, `audit_logs` row with action `certification.approve`.
3. Employer posts shift requiring that cert. Worker applies → `shift_applications` row.
4. Employer accepts → `shift_assignments.status='Assigned'`.
5. Worker clocks in/out → `time_entries` row with `clock_in` and `clock_out`.
6. Employer confirms hours → `time_entries.confirmed=true`.
**PASS:** all above rows exist; `worker_clock_in` succeeds only because cert is Approved.

### D) Payment flow
See §3.4. **PASS:** `invoices.status='Paid'`, `payments.status='Captured'`, `payouts.status` reaches `'Paid'`.

### E) Shipment flow
See §4.3. **PASS:** `shipments.status='delivered'`, `delivered_at` set, ≥1 `tracking_events` row.

### F) File upload / signed URL
1. Upload booking doc via `uploadFileWithMetadata` → row in `storage_files`, object in `booking-docs`.
2. Call `get-signed-url` → returns `{ signedUrl }` with 60s TTL.
3. Unauthorized user calls → 403.
**PASS:** authorized download 200; unauthorized 403; `audit_logs` contains `storage.signed_url` action.

### G) Admin actions / audit logs
1. Admin suspends company via `admin_set_company_status(reason='fraud')`.
2. `companies.status='Suspended'`.
3. `audit_logs` row: `action='company.set_status'`, `before.status='Active'`, `after.status='Suspended'`, `reason='fraud'`, `actor_user_id` = admin.
**PASS:** exactly one matching audit row.

---

## 7. Failure Handling Rules

| Failure | System behavior |
|---|---|
| **Payment intent fails** (`payment_intent.payment_failed`) | `payments.status='Failed'`, `failure_reason` set, `invoices.status` stays `Issued`, customer can retry; no payout created |
| **Stripe webhook retry (duplicate delivery)** | Idempotent: `record_payment` is a no-op if `stripe_payment_intent_id` already captured; webhook returns 200 |
| **Stripe webhook signature invalid** | Function returns 400, no DB change, Stripe auto-retries |
| **Payout transfer fails** | `payouts.status='Failed'`, `failure_reason` set, admin sees it in `admin/finance`; next cron skips it; retry via `admin_retry_payout` RPC |
| **Label purchase fails (EasyPost error)** | Function returns 4xx with error body, `shipments` unchanged (still `pending`), no label row created |
| **Tracking webhook invalid secret** | 401, no DB change |
| **Invalid booking transition** (e.g. `Completed → Accepted`) | `enforce_booking_transition` trigger raises `invalid_transition`; RPC returns error; UI shows toast; no history row |
| **Unauthorized storage access** | `storage.objects` RLS blocks; `get-signed-url` re-check returns 403 |
| **Unauthorized RPC call** (non-admin calls `admin_*`) | `require_admin()` raises `not_authorized`; no audit row; caller gets 42501 |
| **Orphan storage file** (no metadata row) | `cleanup-orphan-files` cron deletes after 24h; writes `audit_logs` entry |
| **Expo push `DeviceNotRegistered`** | `push-notifications` deletes the stale `push_tokens` row; future notifications skip that token |
| **Cert-gated clock-in without approved cert** | `worker_clock_in` raises `certification_required`; no `time_entries` row |
| **Admin destructive action without reason** | `require_reason()` raises `reason_required`; transaction aborts |

---

End of runbook. System is launch-ready when every check in §6 passes.
