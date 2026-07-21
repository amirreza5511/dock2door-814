-- ============================================================================
-- 0161 — Fix privilege escalation on public.profiles
--
-- BUG: two permissive UPDATE policies existed on profiles:
--   * profiles_update_own_safe — correct: self may update but WITH CHECK forbids
--     changing role / status / company_id.
--   * profiles_self_update      — UNSAFE: `(auth.uid() = id) OR is_admin()` with
--     NO with-check expression, so its check defaulted to the USING clause.
-- Postgres OR-combines permissive policies, so the unsafe policy let any user
-- escalate their own role (e.g. Worker -> SuperAdmin) via a direct PATCH,
-- completely bypassing the safe policy's WITH CHECK.
--
-- FIX: drop the unsafe self-update policy and give admins their own explicit
-- update policy. Regular users keep profiles_update_own_safe (self edits that
-- cannot touch role/status/company_id). Idempotent + additive.
-- ============================================================================

drop policy if exists profiles_self_update on public.profiles;

-- Admin-only full update (role/status/company changes must go through admins).
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- Safety net: ensure the self-safe policy still exists exactly as intended.
drop policy if exists profiles_update_own_safe on public.profiles;
create policy profiles_update_own_safe on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and status = (select p.status from public.profiles p where p.id = auth.uid())
    and not (company_id is distinct from (select p.company_id from public.profiles p where p.id = auth.uid()))
  );
