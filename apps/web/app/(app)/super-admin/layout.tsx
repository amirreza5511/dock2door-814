import { redirect } from "next/navigation";
import { getCurrentSessionContext } from "@/lib/supabase/server";

/**
 * Server-side guard for /super-admin/*.
 * Non-SuperAdmin users (including regular admins) are redirected to /dashboard.
 * The sidebar already hides these links — this is the authoritative UI gate;
 * actual data mutations are still gated by `require_admin()` in SECURITY DEFINER RPCs.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentSessionContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.isSuperAdmin) redirect("/dashboard");
  return <>{children}</>;
}
