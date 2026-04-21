# Migrate Dock2Door to Supabase (Auth + Database only)

User approved switching the entire backend to Supabase. No Node/Bun/Docker/Hono/tRPC server.

## Supabase project
- URL: https://hyargzciywqhlcaorwy.supabase.co
- Env used: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Step 1 — SQL migration (schema + enums + RLS + triggers)
- [x] `supabase/migrations/0001_init.sql` (base schema, RLS, trigger)
- [x] `supabase/migrations/0002_more_tables.sql` (inventory, fulfillment, threads, fleet, dock_appointments, payouts, audit_logs, commission/tax/flags)

## Step 2 — Supabase client
- [x] `expo/lib/supabase.ts` with AsyncStorage + web-safe storage

## Step 3 — Auth flow
- [x] `expo/store/auth.ts` rewritten for Supabase Auth
- [x] Login / Signup screens working against Supabase
- [x] Role-based routing via `getRoleRoute`

## Step 4 — tRPC → Supabase shim (so screens keep working)
- [x] `expo/lib/trpc.ts` replaced with a Supabase-backed shim
  - Preserves `trpc.X.Y.useQuery / useMutation / useUtils().X.Y.invalidate()` surface
  - Maps every procedure used in screens to Supabase queries:
    - bookings (create, accept, decline, counter-offer, respond, complete, listMine)
    - warehouses (createListing, updateListing, setListingStatus)
    - services (listMine, createListing, updateListing, setListingStatus)
    - dock (createRecord, updateRecord, updateCompany, updateUser)
    - inventory (listProducts, createProduct, archiveProduct, listVariants, upsertVariant)
    - fulfillment (listMyOrders, getBooking, addInventory, createOrder, pick/pack/ship/complete)
    - operations (trucking/driver/gate, fleet CRUD, dock appointments)
    - payments (list, getPayment, invoices, payouts)
    - messaging (threads + messages)
    - admin (dashboard, entities, audit, rules/flags, platform settings)
    - analytics overview
    - notifications list/markRead
- [x] No screen changes required

## Remaining / follow-ups
- [ ] Seed demo auth users via Supabase dashboard (admin@dock2door.ca / admin123, etc.)
- [ ] File uploads (`uploads.*`) are stubbed — wire to Supabase Storage when needed
- [ ] Stripe payment-intent flow disabled until Stripe keys are added via Edge Function
