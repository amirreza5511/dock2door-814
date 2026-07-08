# Advertising Kit — copy-paste into another Rork app

This folder is a self-contained bundle of the whole advertising system from this
project. Copy the folder into your new project and follow the steps below. It
gives you:

- A sponsored banner docked under every page (image / video / YouTube creatives).
- Weighted rotation, per-link tap tracking, impression & click counters, play caps.
- A **Super Admin Ad Manager** — create/edit/pause ads, review member requests,
  set prices, and bill by delivery.
- A **self-serve "Advertise your business"** screen for members.
- **Usage-based billing**: flat fee, CPM (e.g. $100 / 1,000 views), or CPC, with
  an optional budget cap that auto-pauses the ad.

## What's in here

| File | What it is | Where it goes in the new project |
|---|---|---|
| `01_advertising_schema.sql` | The entire database (6 migrations merged into 1) | `supabase/migrations/0XXX_advertising.sql` |
| `trpc-ads-endpoints.ts` | All ad tRPC handlers | merge into your tRPC procedure map (e.g. `expo/lib/trpc.ts`) |
| `AdBanner.tsx` | The global sponsored banner | `expo/components/AdBanner.tsx` |
| `super-admin-ads.tsx` | Admin Ad Manager screen | `expo/app/super-admin/ads.tsx` (or wherever your admin lives) |
| `advertise.tsx` | Self-serve screen for members | `expo/app/advertise/index.tsx` |

## Install steps

### 1. Database
Copy `01_advertising_schema.sql` into the new project's `supabase/migrations/`
folder (rename it with the next number, e.g. `0500_advertising.sql`) and run it.

It expects the new project to already have:
- `public.is_admin()` and `public.is_authenticated()` helper functions.
- A `companies` table and a `profiles` table (for the foreign keys). If yours are
  named differently, adjust the `references` clauses.

> **Usage billing is optional.** The `admin_bill_ad_usage` function at the bottom
> needs an `invoices` table (with an `advertisement_id` column) plus a settle
> engine (`internal_settle_invoice`, `write_audit`). If the new project doesn't
> have those, delete that function from the SQL — everything else (serving,
> tracking, self-serve, quotes, approve/reject) works without it.

### 2. Backend endpoints
Open `trpc-ads-endpoints.ts` and paste each handler into your tRPC procedure map.
They assume the same helpers this project uses: `supabase`, `isAdmin(role)`,
`throwErr`, `isMissingRelation`, `isMissingColumn`, `AnyRecord`, and `ctx.user`
(`{ id, role, companyId }`). Adapt names to your project if they differ.

### 3. UI screens
Copy the three `.tsx` files to the paths above. They import:
- `@/constants/colors` (a color token object `C` — see "Design tokens" below)
- `@/components/ui/Button` and `@/components/ui/ScreenFeedback`
- `@/lib/trpc` and `@/store/auth`

If your new project doesn't have those exact components, either copy them over too
or swap them for your equivalents.

### 4. Mount the banner
Render `<AdBanner />` once near the root of your app (after the auth + tRPC
providers), so it floats under every page. Example:

```tsx
// app/_layout.tsx
<AuthProvider>
  <RootLayoutNav />
  <AdBanner />
</AuthProvider>
```

### 5. Wire the entry points
- Add a link/route to the admin Ad Manager (`super-admin/ads`).
- Add a link/route to the self-serve screen (`advertise`) somewhere members can reach.

### 6. Adjust placements
The list of pages an ad can target is hardcoded as `PLACEMENTS` in
`AdBanner.tsx` (`TABBED_ROOTS`), `super-admin-ads.tsx`, and `advertise.tsx`.
Edit those to match the sections/roles in your new app.

## Required packages
The banner uses these (install if the new project doesn't have them):

- `expo-video` (video creatives)
- `react-native-webview` (inline YouTube on native)
- `lucide-react-native` (icons)
- `react-native-safe-area-context`, `expo-router`

## Design tokens (`C`)
The screens reference these keys on the color object `C` — make sure your
`constants/colors` provides them (or rename in the copied files):

`bg`, `bgSecondary`, `card`, `cardElevated`, `border`, `borderLight`, `text`,
`textSecondary`, `textMuted`, `white`, `black`, `overlay`, `accent`, `accentDim`,
`green`, `greenDim`, `blue`, `blueDim`, `red`, `redDim`, `yellow`, `yellowDim`,
`purple`, `purpleDim`.

## Flow recap
- **Admin ads**: created directly, live immediately.
- **Self-serve ads**: member submits → admin sets a price (quote) → member pays →
  admin approves → ad goes live.
- **Billing**: flat, CPM, or CPC. The admin "bills" the delivery earned since the
  last bill; a budget cap auto-pauses the ad once spent.
