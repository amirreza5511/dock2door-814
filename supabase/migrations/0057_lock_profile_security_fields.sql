-- ============================================================
-- 0057_lock_profile_security_fields.sql
--
-- Prevents authenticated users from updating their own
-- profiles.role, profiles.status, or profiles.company_id
-- directly via the Supabase client.
--
-- These fields are security-sensitive:
--   - role     : determines which dashboard the user sees
--   - status   : Suspended users must stay suspended
--   - company_id: legacy field; security boundary is company_users
--
-- Allowed UPDATE path for each field:
--   - role        → admin_grant_role / admin_revoke_role RPCs (0007)
--   - status      → admin_set_user_status RPC (0007)
--   - company_id  → managed by company_users membership, not profiles
--
-- All other columns (name, profile_image, etc.) remain
-- self-updatable so workers and providers can manage their profiles.
-- ============================================================

-- Drop existing profiles UPDATE policy to replace it.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;

-- Re-create a narrow self-update policy that blocks security fields.
-- WITH CHECK ensures the locked columns cannot be changed even if USING passes.
DROP POLICY IF EXISTS "profiles_update_own_safe" ON public.profiles;
CREATE POLICY "profiles_update_own_safe"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- role must not change via self-update
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    -- status must not change via self-update
    AND status = (SELECT status FROM public.profiles WHERE id = auth.uid())
    -- company_id must not change via self-update
    AND (
      company_id IS NOT DISTINCT FROM (SELECT company_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- Admin-update policy: admins go through audited RPCs (admin_set_user_status etc.)
-- so they don't need a direct UPDATE policy here.  Read-only select is enough for
-- admin dashboards; mutations use SECURITY DEFINER RPCs which run as the service role.

-- Grant no extra privileges; the RLS policies above are sufficient.
