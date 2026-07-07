-- Dock2Door — Self-serve advertising.
-- Lets any signed-in member (warehouse, trucking/drayage, freight forwarder,
-- realtor, service provider, employer, etc.) submit an ad for their OWN
-- business. The flow: member submits → super admin sets a price (quote) →
-- member pays → super admin approves → the ad goes live (status = 'Active').
--
-- Admin-created ads (0119) keep their existing behaviour: source = 'admin',
-- no review lifecycle. Idempotent.

alter table public.advertisements
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists owner_company_id uuid references public.companies(id) on delete set null,
  add column if not exists source text not null default 'admin',           -- admin | self_serve
  add column if not exists review_status text,                             -- Pending | Quoted | Paid | Approved | Rejected (self_serve only)
  add column if not exists price numeric not null default 0,               -- admin-set price for a self-serve ad
  add column if not exists currency text not null default 'CAD',
  add column if not exists paid_at timestamptz,
  add column if not exists admin_note text not null default '';            -- quote note / rejection reason

create index if not exists idx_advertisements_review
  on public.advertisements(source, review_status, created_at desc);
create index if not exists idx_advertisements_submitter
  on public.advertisements(submitted_by, created_at desc);

-- =========================================================================
-- RLS — members can create & edit their OWN self-serve ads while they are
-- still a Pending draft, and read them back. All privileged fields (status,
-- price, review_status) are pinned by the WITH CHECK so a member can never
-- self-activate or self-price. Payment transitions go through ad_mark_paid().
-- Admins keep full control via the existing advertisements_manage policy.
-- =========================================================================
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
-- Payment transition — SECURITY DEFINER so the member can move their own ad
-- from Quoted → Paid without holding rights to overwrite privileged columns.
-- (Payment itself is confirmed by the app; this records that it happened.)
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

notify pgrst, 'reload schema';
