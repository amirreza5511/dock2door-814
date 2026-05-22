-- 0047_payments_invoices_rls_hardening.sql
-- Fixes two confirmed RLS security bugs from the production audit:
--
-- BUG 1 — payments SELECT policy allows all authenticated users to read all payments.
--   0001 defines:
--     CREATE POLICY "pay_read_auth" ON public.payments
--       FOR SELECT USING (auth.role() = 'authenticated');
--   This means any logged-in user (customer, worker, employer, etc.) can query
--   every payment record on the platform regardless of company.
--   FIX: replace with company-scoped policy — only members of customer_company_id
--   or provider_company_id, or admins, may read a payment row.
--
-- BUG 2 — invoices SELECT policy allows all authenticated users to read all invoices.
--   0001 defines:
--     CREATE POLICY "inv_read_auth" ON public.invoices
--       FOR SELECT USING (auth.role() = 'authenticated');
--   Same problem — any user can read every invoice on the platform.
--   FIX: company-scoped read (customer_company_id or provider_company_id member).
--
-- BUG 3 — audit_insert_self allows authenticated users to INSERT directly into audit_logs.
--   0002 defines:
--     CREATE POLICY "audit_insert_self" ON public.audit_logs FOR INSERT
--       WITH CHECK (actor_user_id = auth.uid() OR public.is_admin());
--   This means any user can forge audit entries for their own user id.
--   The ONLY correct path for audit writes is the SECURITY DEFINER write_audit() function.
--   All direct INSERT access from authenticated/anon roles must be blocked.
--   FIX: drop audit_insert_self. write_audit() is SECURITY DEFINER and bypasses RLS —
--   it does not need a permissive INSERT policy.
--
-- Idempotent — drop existing policies before recreating.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Payments — replace open SELECT with company-scoped read
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "pay_read_auth"    on public.payments;
drop policy if exists "pay_read_parties" on public.payments;

create policy "pay_read_parties" on public.payments
  for select using (
    public.is_admin()
    or public.is_member_of(customer_company_id)
    or public.is_member_of(provider_company_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Invoices — replace open SELECT with company-scoped read
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "inv_read_auth"    on public.invoices;
drop policy if exists "inv_read_parties" on public.invoices;

create policy "inv_read_parties" on public.invoices
  for select using (
    public.is_admin()
    or public.is_member_of(customer_company_id)
    or public.is_member_of(provider_company_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Audit logs — remove audit_insert_self
--    All audit writes go through write_audit() SECURITY DEFINER.
--    That function is security definer and bypasses RLS on insert,
--    so no INSERT policy is needed for authenticated users.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "audit_insert_self" on public.audit_logs;
