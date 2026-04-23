# Dock2Door — Deployment Guide

This document contains the exact steps to deploy the Dock2Door platform to production.

Everything runs on Supabase (Auth + Postgres + Storage + Edge Functions). There is
no Node/Bun/Docker server. The Expo app is published through EAS.

---

## 1. Prerequisites

- Supabase project created (hosted)
- `supabase` CLI installed and logged in (`supabase login`)
- Stripe account (live mode, Connect enabled)
- EasyPost account (production API key)
- Expo project with access token for push

---

## 2. Required secrets

Set these via `supabase secrets set KEY=VALUE` (or the Supabase dashboard ▸ Edge
Functions ▸ Secrets).

| Secret | Used by | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | `create-payment-intent`, `process-payouts`, `stripe-webhook` | Stripe live secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | `whsec_...` from Stripe dashboard ▸ Webhooks |
| `EASYPOST_API_KEY` | `purchase-shipping-label` | Production API key |
| `TRACKING_WEBHOOK_SECRET` | `tracking-webhook` | Shared secret sent as `x-webhook-secret` header from the carrier relay |
| `EXPO_ACCESS_TOKEN` | `push-notifications` | Personal access token for Expo Push |
| `SUPABASE_URL` | All functions | Auto-injected by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | Auto-injected by Supabase |

Client-side env (already configured via project env):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

---

## 3. Apply database migrations

From the project root:

```bash
supabase db push
```

This applies `supabase/migrations/0001_init.sql` through
`supabase/migrations/0014_yard_notifications.sql` in order. All migrations are
idempotent — re-running is safe.

Migration index:

| File | Purpose |
|---|---|
| `0001_init.sql` | Profiles, companies, company_users, base enums |
| `0002_more_tables.sql` | Listings, bookings, services, disputes, messages |
| `0003_ownership_fix.sql` | `user_roles`, helpers, `set_active_company` GUC |
| `0004_booking_state_machine.sql` | Booking transitions + audit |
| `0005_certifications_access.sql` | Worker certification RLS |
| `0006_storage.sql` | 5 private buckets + storage RLS + `storage_files` |
| `0007_admin_rpcs.sql` | Audited admin RPCs |
| `0008_jobs_shifts_admin.sql` | Service jobs + shifts lifecycle |
| `0009_final_hardening.sql` | Signed URL predicate, orphan cleanup |
| `0010_reviews.sql` | Reviews & rating summaries |
| `0011_finance.sql` | Invoices, payments, refunds, payouts, commission/tax rules |
| `0012_inventory_wms.sql` | WMS (locations, stock, receipts, cycle counts) |
| `0013_oms_shipping.sql` | OMS, shipments, RMA, tracking events |
| `0014_yard_notifications.sql` | Gate events, PODs, notifications, push tokens |

---

## 4. Deploy Edge Functions

```bash
supabase functions deploy get-signed-url
supabase functions deploy cleanup-orphan-files
supabase functions deploy push-notifications
supabase functions deploy stripe-webhook         --no-verify-jwt
supabase functions deploy tracking-webhook       --no-verify-jwt
supabase functions deploy create-payment-intent
supabase functions deploy purchase-shipping-label
supabase functions deploy process-payouts        --no-verify-jwt
```

| Function | Auth | Notes |
|---|---|---|
| `get-signed-url` | JWT | Re-runs `can_read_storage_object` server-side |
| `cleanup-orphan-files` | Service role | Nightly cron |
| `push-notifications` | Service role | Every-minute cron |
| `stripe-webhook` | Stripe sig | `--no-verify-jwt` (public) |
| `tracking-webhook` | Shared secret | `--no-verify-jwt` (public) |
| `create-payment-intent` | JWT | Called from app before Stripe PaymentSheet |
| `purchase-shipping-label` | JWT | Provider-side label purchase via EasyPost |
| `process-payouts` | Service role | Cron or manual via CLI |

---

## 5. Schedule cron jobs

In the Supabase Dashboard ▸ Edge Functions ▸ Schedules:

| Function | Schedule | Body |
|---|---|---|
| `push-notifications` | `* * * * *` (every minute) | `{"batch":true,"limit":50}` |
| `cleanup-orphan-files` | `0 3 * * *` (03:00 daily) | `{}` |
| `process-payouts` | `0 */4 * * *` (every 4h) | `{"limit":50}` |

---

## 6. Configure Stripe

1. Dashboard ▸ Webhooks ▸ Add endpoint
   - URL: `https://<project-ref>.functions.supabase.co/stripe-webhook`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `payout.paid`, `payout.failed`, `account.updated`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
2. Enable Connect (Express) for provider onboarding.
3. Each provider company must have `companies.stripe_connect_account_id` set
   (onboarding flow uses `/connect/onboard` link generated at provider signup).

---

## 7. Configure EasyPost

1. Create production API key → set as `EASYPOST_API_KEY`.
2. Dashboard ▸ Webhooks ▸ Add URL
   - URL: `https://<project-ref>.functions.supabase.co/tracking-webhook`
   - Secret: value of `TRACKING_WEBHOOK_SECRET` (sent as `x-webhook-secret` by
     a lightweight relay worker, since EasyPost itself doesn't sign its webhooks).
3. Warehouse providers enter their EasyPost account reference in
   `carrier_accounts` (one row per provider company).

---

## 8. Push notifications (Expo)

1. `eas credentials` to attach APNs + FCM keys.
2. Generate a personal access token at https://expo.dev ▸ Account ▸ Access Tokens
   → set as `EXPO_ACCESS_TOKEN` (used by the `push-notifications` function).
3. On first launch the app calls `register_push_token` RPC with the Expo
   push token obtained from `expo-notifications`.

---

## 9. Final checks

- [ ] All 14 migrations applied, no errors.
- [ ] All 8 Edge Functions deployed with secrets set.
- [ ] Cron schedules active.
- [ ] Stripe live webhook receiving `payment_intent.succeeded` in test event.
- [ ] EasyPost webhook receiving tracker updates.
- [ ] Push token registered for at least one account (via the mobile app).
- [ ] Seed admin: insert a row into `user_roles(user_id, role)` with `role='admin'`.

---

## 10. Legacy backend removal

The old `backend/` tRPC+Hono server has been removed. All runtime behaviour is
served by Supabase RPCs and the Edge Functions listed above. The app's
`expo/lib/trpc.ts` is a thin client shim that dispatches to Supabase; it
keeps the original screen call sites working without a Node server.

No `backend/` folder, `docker-compose.yml`, or `nginx/` config is required for
production. The `docker-compose.yml` and `nginx/` directories remaining in the
repo are development-only and are not referenced by the live platform.
