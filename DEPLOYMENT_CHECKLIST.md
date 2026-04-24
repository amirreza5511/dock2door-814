# Dock2Door — Production Deployment Checklist

Use this to take the current build from "everything compiles" to "a real operator can run a shift on it." Every item below maps to something already wired in code; this checklist is purely for configuring the live environment.

---

## 1. Supabase — database & storage

- [ ] Apply all migrations in order: `supabase/migrations/0001 … 0016` (`supabase db push` or SQL editor).
- [ ] Confirm 5 private buckets exist: `certifications`, `warehouse-docs`, `booking-docs`, `invoices`, `attachments`.
- [ ] Grant `authenticated` EXECUTE on every `public.*` RPC (migration `0009` does this; re-run if a new RPC was added).
- [ ] Seed at least one row in `user_roles(user_id, role='admin')` for the first platform admin.
- [ ] Verify RLS is **enabled** on every table (`select relname from pg_class where relrowsecurity = false` should return 0 rows in the `public` schema).
- [ ] Backups: turn on Supabase PITR (or daily dumps) before go-live.

## 2. Edge Functions — deploy + secrets

Deploy:

```
supabase functions deploy get-signed-url
supabase functions deploy cleanup-orphan-files
supabase functions deploy stripe-webhook
supabase functions deploy stripe-connect-onboard
supabase functions deploy stripe-connect-dashboard
supabase functions deploy create-checkout-session
supabase functions deploy process-payouts
supabase functions deploy tracking-webhook
supabase functions deploy push-notifications
supabase functions deploy purchase-shipping-label
```

Set secrets (`supabase secrets set …`):

- [ ] `STRIPE_SECRET_KEY` (live `sk_live_…`)
- [ ] `STRIPE_WEBHOOK_SECRET` (from Stripe dashboard, **live mode** endpoint)
- [ ] `STRIPE_CONNECT_CLIENT_ID` (if Express onboarding requires it)
- [ ] `EASYPOST_API_KEY` (live, not test)
- [ ] `TRACKING_WEBHOOK_SECRET` (random string; same one you hand to EasyPost)
- [ ] `EXPO_ACCESS_TOKEN` (for Expo Push)
- [ ] `APP_BASE_URL` (used in Stripe return_url/success_url)

Cron schedules:

- [ ] `cleanup-orphan-files` — daily (e.g. 03:00 UTC).
- [ ] `push-notifications` — every 1 minute.
- [ ] `process-payouts` — hourly.

## 3. Stripe — live verification checklist

- [ ] Switch dashboard to **Live** mode.
- [ ] Create webhook endpoint → URL = your `stripe-webhook` Edge Function URL. Events to enable:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.refunded`
  - `account.updated` (optional, for Connect onboarding sync)
- [ ] Copy the signing secret into `STRIPE_WEBHOOK_SECRET` secret.
- [ ] Enable **Stripe Connect (Express)**; set branding + support email.
- [ ] Test end-to-end in live mode with one small real charge:
  1. Provider onboards via `warehouse-provider/stripe-connect.tsx` → `accounts.create` + `accountLinks.create`.
  2. After onboarding, provider sees "Open Stripe dashboard" link (calls `stripe-connect-dashboard`).
  3. Customer pays invoice via `FinanceScreen` → `create-checkout-session` → completes Checkout.
  4. Webhook fires → `record_payment` RPC → invoice `Paid`, payout queued.
  5. Cron `process-payouts` runs → transfer to connected account appears in Stripe.
  6. Force a refund from Stripe dashboard → `charge.refunded` webhook → invoice `Refunded`/`PartiallyRefunded`.

## 4. EasyPost — live verification checklist

- [ ] Switch EasyPost to production API keys.
- [ ] Set `EASYPOST_API_KEY` to the **production** key.
- [ ] In EasyPost dashboard → Webhooks → add the `tracking-webhook` URL; attach header `x-webhook-secret: <TRACKING_WEBHOOK_SECRET>`.
- [ ] Verify at least one real shipment end-to-end:
  1. Provider buys label via `purchase-shipping-label` Edge Function from `fulfillment/shipments`.
  2. `shipments.label_url` + `tracking_code` stored; label PDF opens.
  3. Tracking webhook hits → `record_tracking_event` writes rows into `tracking_events` and advances `shipments.status` (InTransit → OutForDelivery → Delivered).
  4. Customer-facing `customer/tracking` reflects status in near real time (polling + push).

## 5. Push notifications — real-device verification

- [ ] Build the app with an EAS production profile OR run in Expo Go on a physical device (Expo Go works for push in dev).
- [ ] Log in → `expo/providers/PushProvider` (or equivalent) calls `register_push_token` with the device's Expo token. Confirm a row appears in `push_tokens`.
- [ ] Trigger a booking transition (provider accepts a request). Confirm:
  - row appears in `notifications` (via `tr_notify_booking_status` trigger);
  - within ~1 minute the `push-notifications` cron delivers it;
  - the device shows the banner, tap opens the booking;
  - `notifications.payload.delivered_at` is stamped.
- [ ] Send a thread message → recipient receives push (`tr_notify_thread_message`).
- [ ] In `admin/notifications-health.tsx`: queued / delivered / failed counts match expectation.

## 6. Cron verification

After deploying, confirm each job runs at least once:

- [ ] `push-notifications` — watch `notifications` rows flip to `delivered_at != null` within a minute.
- [ ] `cleanup-orphan-files` — create a test orphan (upload to storage without a `storage_files` row), age it past the threshold in staging, confirm it's removed and an `audit_logs` entry is written.
- [ ] `process-payouts` — queue a payout via a paid invoice, confirm a Stripe transfer is created within an hour.

## 7. Operator smoke test (run before go-live)

Run this sequence as a real user on a real device. Everything must work **without developer intervention**:

1. **Booking**
   - [ ] Customer submits a booking request (provider identity hidden in customer UI).
   - [ ] Admin routes it from `admin/bookings.tsx` to a specific warehouse listing.
   - [ ] Warehouse provider accepts / counters / declines from `warehouse-provider/bookings.tsx`.
2. **Gate + dock**
   - [ ] Dispatcher assigns a driver from `trucking-company/appointments.tsx` (Kanban board, auto-refreshes every 15 s).
   - [ ] Driver opens `driver/index.tsx` on mobile — sees the job, taps **Start trip → Arrive at gate → Pull to door → Begin loading → Depart**. Haptics fire on every advance; a confirmation prompts before Depart.
   - [ ] Gate staff see the truck move through `gate-staff/index.tsx` and `gate-staff/yard.tsx` (door board updates live).
   - [ ] POD captured via `driver/pod.tsx` — file uploads to the `attachments` bucket and links via `attach_pod` RPC.
3. **WMS**
   - [ ] Warehouse staff receive inventory via `warehouse-provider/wms.tsx` (3-step wizard, putaway to a real bin).
   - [ ] Transfer between bins, run a cycle count, confirm the variance banner + movement ledger entries.
4. **Shipment**
   - [ ] Provider purchases a real label in `fulfillment/shipments.tsx` (EasyPost live).
   - [ ] Tracking webhook updates status; customer sees the timeline.
5. **Money**
   - [ ] Invoice generated via `issue_invoice_for_booking` / `issue_invoice_for_service_job`.
   - [ ] Customer pays via Checkout (live card).
   - [ ] Payout arrives to provider's Stripe Connect account.
6. **Exceptions**
   - [ ] Flag a no-show from dispatcher — prompt asks for reason, status moves to NoShow, notification fires.
   - [ ] Admin force-cancels a booking from `admin/bookings.tsx` — reason prompt + audit log entry.

## 8. Observability

- [ ] `admin/audit-logs.tsx` shows every privileged write (admin mutations, force transitions, refunds).
- [ ] `admin/notifications-health.tsx` shows queued / delivered / failed push counts.
- [ ] Supabase dashboard → Logs → filter by Edge Function name for each function listed in §2.
- [ ] Stripe dashboard → Events tab — no repeated `webhook.failed` entries.

## 9. Hardening already applied in-app (for reference)

- Dispatcher board, driver app, gate/yard — auto-refresh every 15–30 s + pull-to-refresh.
- Haptics (`expo-haptics`, polyfilled on web) on every status advance, success, and error.
- Confirmation prompts before: driver Depart, gate check-out, no-show flag, manual WMS adjust, admin force cancel / force complete (with reason required).
- Dispatcher supports **reassign** on already-assigned jobs, not just initial assign.
- WMS stock board has live search (SKU / location / lot).
- All destructive admin paths go through audited RPCs (`admin_force_booking_status`, `admin_initiate_refund`, etc.) — no raw table writes.

When every box above is checked, the system is cleared for real operations.
