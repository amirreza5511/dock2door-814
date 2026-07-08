-- =========================================================================
-- ADVERTISING KIT — full database schema in ONE file.
-- Copy this into the NEW project's supabase/migrations folder as a single
-- migration (e.g. 0500_advertising.sql) and run it. Idempotent & additive:
-- safe to run more than once.
--
-- This bundles what were 6 migrations in the original project:
--   0119 base table + impression/click counters
--   0120 rich media (image / video / youtube) + link types + play caps
--   0121 multi-placement + multi-link
--   0122 per-link click tracking
--   0123 self-serve (members submit their own ads, review lifecycle)
--   0127 usage-based billing (flat / CPM / CPC + budget cap)
--
-- DEPENDENCIES the new project must already have (see README):
--   * helper functions: public.is_admin(), public.is_authenticated()
--   * a `companies` table and a `profiles` table (for the FK references)
--   * FOR USAGE BILLING ONLY (admin_bill_ad_usage): an `invoices` table with an
--     `advertisement_id` column, plus the sandbox settle engine functions
--     public.internal_settle_invoice(uuid, numeric, text) and public.write_audit(...).
--     If you don't have those yet, you can skip the admin_bill_ad_usage function
--     at the bottom — everything else works without it.
-- =========================================================================

-- ── Base table ───────────────────────────────────────────────────────────
create table if not exists public.advertisements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  image_url text not null default '',
  target_url text not null default '',
  cta_label text not null default 'Learn more',
  advertiser_name text not null default '',
  advertiser_company_id uuid references public.companies(id) on delete set null,
  placement text not null default 'all',
  status text not null default 'Active',                 -- Active | Paused
  priority int not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_advertisements_serving
  on public.advertisements(status, placement, priority desc);

-- ── Rich media + link types + play caps (0120) ────────────────────────────
alter table public.advertisements
  add column if not exists media_type text not null default 'image',      -- image | video | youtube
  add column if not exists video_url text not null default '',
  add column if not exists link_type text not null default 'website',     -- website | instagram | phone | whatsapp | youtube | email
  add column if not exists max_impressions bigint not null default 0,     -- 0 = unlimited
  add column if not exists weight int not null default 1;
create index if not exists idx_advertisements_serving2
  on public.advertisements(status, placement, priority desc, weight desc);

-- ── Multi-placement + multi-link (0121) ───────────────────────────────────
alter table public.advertisements
  add column if not exists placements text[] not null default '{}',   -- {'all'} or {'customer','driver'}
  add column if not exists links jsonb not null default '[]'::jsonb;  -- [{ "type": "website", "value": "https://…" }]
update public.advertisements
  set placements = array[placement]
  where placements is null or array_length(placements, 1) is null;
update public.advertisements
  set links = jsonb_build_array(jsonb_build_object('type', coalesce(link_type, 'website'), 'value', target_url))
  where (links is null or jsonb_array_length(links) = 0) and coalesce(target_url, '') <> '';
create index if not exists idx_advertisements_placements
  on public.advertisements using gin (placements);

-- ── Per-link click tracking (0122) ────────────────────────────────────────
alter table public.advertisements
  add column if not exists link_clicks jsonb not null default '{}'::jsonb; -- { "website": 12, "phone": 3 }

-- ── Self-serve columns (0123) ─────────────────────────────────────────────
alter table public.advertisements
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists owner_company_id uuid references public.companies(id) on delete set null,
  add column if not exists source text not null default 'admin',           -- admin | self_serve
  add column if not exists review_status text,                             -- Pending | Quoted | Paid | Approved | Rejected
  add column if not exists price numeric not null default 0,
  add column if not exists currency text not null default 'CAD',
  add column if not exists paid_at timestamptz,
  add column if not exists admin_note text not null default '';
create index if not exists idx_advertisements_review
  on public.advertisements(source, review_status, created_at desc);
create index if not exists idx_advertisements_submitter
  on public.advertisements(submitted_by, created_at desc);

-- ── Usage-based billing columns (0127) ────────────────────────────────────
alter table public.advertisements
  add column if not exists pricing_model text not null default 'flat',      -- flat | cpm | cpc
  add column if not exists cpm_rate numeric not null default 0,
  add column if not exists cpc_rate numeric not null default 0,
  add column if not exists budget_cap numeric not null default 0,
  add column if not exists billed_impressions bigint not null default 0,
  add column if not exists billed_clicks bigint not null default 0,
  add column if not exists billed_amount numeric not null default 0;

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.advertisements enable row level security;

drop policy if exists "advertisements_read" on public.advertisements;
create policy "advertisements_read" on public.advertisements
  for select using (public.is_authenticated());

drop policy if exists "advertisements_manage" on public.advertisements;
create policy "advertisements_manage" on public.advertisements
  for all using (public.is_admin()) with check (public.is_admin());

-- Members can create & edit their OWN self-serve ads while Pending (draft).
drop policy if exists "advertisements_self_insert" on public.advertisements;
create policy "advertisements_self_insert" on public.advertisements
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and source = 'self_serve'
    and status = 'Paused'
    and coalesce(review_status, 'Pending') = 'Pending'
    and price = 0
  );

drop policy if exists "advertisements_self_update" on public.advertisements;
create policy "advertisements_self_update" on public.advertisements
  for update to authenticated
  using (
    submitted_by = auth.uid()
    and source = 'self_serve'
    and review_status = 'Pending'
  )
  with check (
    submitted_by = auth.uid()
    and source = 'self_serve'
    and status = 'Paused'
    and review_status = 'Pending'
    and price = 0
  );

drop policy if exists "advertisements_self_delete" on public.advertisements;
create policy "advertisements_self_delete" on public.advertisements
  for delete to authenticated
  using (
    submitted_by = auth.uid()
    and source = 'self_serve'
    and review_status in ('Pending', 'Quoted', 'Rejected')
  );

-- =========================================================================
-- Counter functions (SECURITY DEFINER — any viewer can bump counters)
-- =========================================================================
create or replace function public.ad_record_impression(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.advertisements set impressions = impressions + 1 where id = p_id;
$$;
grant execute on function public.ad_record_impression(uuid) to authenticated;

create or replace function public.ad_record_click(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.advertisements set clicks = clicks + 1 where id = p_id;
$$;
grant execute on function public.ad_record_click(uuid) to authenticated;

create or replace function public.ad_record_link_click(p_id uuid, p_link_type text)
returns void language sql security definer set search_path = public as $$
  update public.advertisements
  set clicks = clicks + 1,
      link_clicks = jsonb_set(
        coalesce(link_clicks, '{}'::jsonb),
        array[coalesce(nullif(p_link_type, ''), 'website')],
        to_jsonb(
          coalesce((link_clicks ->> coalesce(nullif(p_link_type, ''), 'website'))::bigint, 0) + 1
        )
      )
  where id = p_id;
$$;
grant execute on function public.ad_record_link_click(uuid, text) to authenticated;

-- =========================================================================
-- Self-serve payment transition (Quoted → Paid)
-- =========================================================================
create or replace function public.ad_mark_paid(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.advertisements
    set review_status = 'Paid',
        paid_at = now(),
        updated_at = now()
    where id = p_id
      and submitted_by = auth.uid()
      and source = 'self_serve'
      and review_status = 'Quoted';
  if not found then
    raise exception 'This advertisement is not awaiting payment.';
  end if;
end;
$$;
grant execute on function public.ad_mark_paid(uuid) to authenticated;

-- =========================================================================
-- Usage-based billing helpers (OPTIONAL — needs invoices + settle engine)
-- Delete this section if the new project has no invoices/settle engine yet.
-- =========================================================================
create or replace function public.ad_accrued_spend(p_ad public.advertisements)
returns numeric language sql immutable as $$
  select round(
    least(
      case coalesce(p_ad.pricing_model, 'flat')
        when 'cpm' then coalesce(p_ad.impressions, 0)::numeric / 1000.0 * coalesce(p_ad.cpm_rate, 0)
        when 'cpc' then coalesce(p_ad.clicks, 0)::numeric * coalesce(p_ad.cpc_rate, 0)
        else coalesce(p_ad.price, 0)
      end,
      case when coalesce(p_ad.budget_cap, 0) > 0
        then p_ad.budget_cap
        else 'infinity'::numeric
      end
    ), 2);
$$;

create or replace function public.admin_bill_ad_usage(p_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_ad         public.advertisements;
  v_accrued    numeric;
  v_billable   numeric;
  v_num        text;
  v_inv_id     uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into v_ad from public.advertisements where id = p_id;
  if v_ad is null then raise exception 'advertisement not found'; end if;

  v_accrued  := public.ad_accrued_spend(v_ad);
  v_billable := round(v_accrued - coalesce(v_ad.billed_amount, 0), 2);
  if v_billable <= 0 then raise exception 'no new billable delivery for this ad yet'; end if;

  v_num := 'INV-AD-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
  insert into public.invoices (
    customer_company_id, provider_company_id, advertisement_id,
    invoice_number, subtotal_amount, tax_amount, total_amount, commission_amount,
    currency, status, issued_at
  ) values (
    v_ad.owner_company_id, null, p_id,
    v_num, v_billable, 0, v_billable, v_billable,
    coalesce(v_ad.currency, 'CAD'), 'Issued', now()
  ) returning id into v_inv_id;

  perform public.internal_settle_invoice(v_inv_id, v_billable, 'advertising');

  update public.advertisements
    set billed_impressions = coalesce(impressions, 0),
        billed_clicks      = coalesce(clicks, 0),
        billed_amount      = coalesce(billed_amount, 0) + v_billable,
        status = case
          when coalesce(budget_cap, 0) > 0
               and coalesce(billed_amount, 0) + v_billable >= budget_cap
          then 'Paused' else status end,
        updated_at = now()
    where id = p_id;

  perform public.write_audit('advertisement.usage_billed', 'advertisements', p_id::text, null,
    jsonb_build_object('amount', v_billable, 'accrued', v_accrued, 'model', v_ad.pricing_model), '');

  return v_billable;
end; $$;
grant execute on function public.admin_bill_ad_usage(uuid) to authenticated;

notify pgrst, 'reload schema';
