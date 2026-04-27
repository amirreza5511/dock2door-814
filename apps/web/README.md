# Dock2Door — Web Operations Console (`apps/web`)

Next.js 15 (App Router) + TypeScript + Tailwind + shadcn-style UI + TanStack Query/Table + Supabase.

Shares the **same Supabase project, users, roles, RPCs, Edge Functions, RLS** as the existing Expo app
(`/expo`). No new backend, no duplicate auth — Supabase is the single source of truth.

---

## Getting started

```bash
cd apps/web
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (same as Expo)
bun install
bun run dev
```

Open <http://localhost:3000>.

## Architecture

- **Auth**: `@supabase/ssr` cookie-based session. `middleware.ts` redirects unauthenticated traffic to `/login`.
- **Server context**: `lib/supabase/server.ts#getCurrentSessionContext` resolves user, profile role, and platform roles from `user_roles`.
- **Role-based shell**: `app/(app)/layout.tsx` renders the sidebar + topbar. Sidebar nav is filtered by `role` and `isAdmin`.
- **Mutations**: every privileged write goes through the existing audited RPCs (`admin_set_company_status`, `admin_approve_certification`, `transition_booking`, `transition_service_job`, `company_add_member`, …) — never direct table writes.
- **Storage**: signed URLs are issued via the existing `get-signed-url` Edge Function (e.g. certification preview).
- **Health**: `/admin/health` runs live checks against auth, RPCs, and the Stripe / push / signed-URL Edge Functions.

## Routes

```
/login                              public
/dashboard                          auth required
/admin/companies                    admin / super-admin
/admin/users                        admin / super-admin
/admin/certifications               admin / super-admin
/admin/audit                        admin / super-admin
/admin/health                       admin / super-admin
/super-admin/roles                  super-admin
/warehouse                          → /warehouse/bookings
/warehouse/bookings                 warehouse provider
/warehouse/listings                 warehouse provider
/warehouse/staff                    warehouse provider (owner/admin)
/warehouse/stations                 warehouse provider (launcher)
/service-provider                   service provider
/trucking                           trucking company
/employer                           employer
```

> Per-role _segment-level_ enforcement on the web side is sidebar-driven. RLS / RPC enforcement is the real
> security boundary — same as mobile. Adding a `canAccessSegment` redirect in each `(app)/<segment>/layout.tsx`
> is a small follow-up; it does not change what the user can actually mutate.

## What each role can do (web)

| Role | Web capabilities (today) |
| --- | --- |
| Admin / Super Admin | Companies (approve/suspend), users (suspend/reinstate), worker certifications (approve/reject), audit log, system-health diagnostics. Super Admin: grant/revoke platform roles. |
| Warehouse Provider | View listings, manage booking lifecycle (accept/counter/decline/start/complete via `transition_booking`), invite & remove staff via `company_add_member` / `company_remove_member`, station launcher. |
| Service Provider | Service-job lifecycle (accept/decline/check-in/complete via `transition_service_job`). |
| Trucking Company | Shipments dashboard. |
| Employer | Posted shifts list + close. |
| Customer | (Customer self-service flows are mobile-first today; see _Remaining_ below.) |

## Status

**Code complete**:
- Project scaffolding, configs, Tailwind theme, shadcn primitives.
- Supabase auth flow (login + cookie session + middleware redirect).
- Role-aware shell (sidebar, topbar, sign-out).
- Live admin pages backed by audited RPCs.
- Warehouse provider booking + staff + listings pages.
- Service-provider, trucking, employer dashboards.
- Super-admin platform-roles screen.
- System Health diagnostic screen.

**Integration complete**:
- Reuses every Supabase RPC and Edge Function from the existing project (no duplication).

**Deployment required (no new code needed)**:
- Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same values as Expo).
- Deploy via Vercel / your host of choice.

**Remaining (web-side polish, none of these block any backend workflow)**:
- Per-station detail screens under `/warehouse/stations/<station>` (RPCs already implemented for mobile — pages will reuse them).
- Customer self-service screens (search warehouses, request storage, orders, invoices, tracking).
- Worker self-service screens (browse shifts, my shifts, certifications upload).
- Trucking driver dispatch board (assignment + POD upload — mobile-first today).
- Sales-channel (Shopify / Amazon) integrations console — currently lives at `/fulfillment/integrations` in the Expo app.
- Per-route role guards in each `(app)/<segment>/layout.tsx` (RLS already blocks at the data layer).

The web panel is **functional and end-to-end backed by real RPCs** for the screens that exist; it is not a complete clone of every mobile screen yet.
