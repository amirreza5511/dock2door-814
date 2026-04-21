# Migrate Dock2Door to Supabase (Auth + Database only)

User approved switching the entire backend to Supabase. No Node/Bun/Docker/Hono/tRPC server.

## Supabase project
- URL: https://hyargzciywqhlcaorwy.supabase.co
- Env used: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Step 1 — SQL migration (schema + enums + RLS + triggers)
- [x] Provide a single SQL file (`supabase/migrations/0001_init.sql`) with:
  - Enums for roles, company types, statuses, bookings, payments, shifts, etc.
  - `public.profiles` table linked 1:1 to `auth.users` via `id uuid references auth.users(id)`
  - `companies`, `company_users`
  - `warehouse_listings`, `warehouse_bookings`
  - `service_listings`, `service_jobs`
  - `worker_profiles`, `worker_certifications`
  - `shift_posts`, `shift_applications`, `shift_assignments`, `time_entries`
  - `payments`, `invoices`, `reviews`, `disputes`, `messages`, `notifications`
  - `platform_settings`
  - RLS enabled on every table with sane policies (user reads own, admins read all)
  - `handle_new_user()` trigger on `auth.users` insert → inserts a profile row using `raw_user_meta_data`
  - Seed of demo users/companies (as regular rows; auth users must be created via dashboard or signup)

## Step 2 — Supabase client
- [x] `expo/lib/supabase.ts` using AsyncStorage for session persistence, `@supabase/supabase-js`
- [x] Web-safe storage (works with RN Web)

## Step 3 — Auth flow
- [x] Rewrite `expo/store/auth.ts` to use Supabase auth (signInWithPassword, signUp, signOut, onAuthStateChange)
- [x] Profile fetch from `profiles` table after session
- [x] Update `app/auth/login.tsx` and `app/auth/signup.tsx` — already call `login/register`, keep contracts
- [x] Remove tRPC/Hono imports from auth store; keep `app/_layout.tsx` bootstrap behavior
- [x] Keep role-based routing via `getRoleRoute`

## Not in this step
- Rewriting every tRPC-backed screen to Supabase tables (will be phased after auth works)
- Hono/tRPC removal from the rest of the app (left in place until migrated screen-by-screen)
