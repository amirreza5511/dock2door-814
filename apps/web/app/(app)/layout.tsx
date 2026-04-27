import { redirect } from "next/navigation";
import { getCurrentSessionContext } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import type { UserRole } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentSessionContext();
  if (!ctx.user) redirect("/login");
  const role = (ctx.role as UserRole | null) ?? null;
  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar role={role} isAdmin={ctx.isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={ctx.user.email ?? null} role={role} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
