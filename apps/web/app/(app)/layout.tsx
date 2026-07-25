import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getCurrentSessionContext } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { AutoWatchdog } from "@/components/auto-watchdog";
import { AiFab } from "@/components/ai-fab";
import { ExploreProvider, EXPLORE_COOKIE } from "@/lib/explore-store";
import { ExploreBanner } from "@/components/explore-banner";
import { ExploreGate } from "@/components/explore-gate";
import type { UserRole } from "@/lib/types";
import type { Domain } from "@/lib/explore-catalog";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentSessionContext();

  // Explore mode: a no-account visitor browsing a role dashboard. Backed by a
  // session cookie set client-side when they tap "Explore as [role]".
  const cookieStore = await cookies();
  const exploreRaw = cookieStore.get(EXPLORE_COOKIE)?.value ?? null;
  const [exploreRoleRaw, exploreDomainRaw] = exploreRaw ? decodeURIComponent(exploreRaw).split("|") : [null, null];
  const exploreRole = (exploreRoleRaw as UserRole | null) ?? null;
  const exploreDomain = (exploreDomainRaw as Domain | null) ?? null;

  // Help Center + AI assistant are open to guests (same as the mobile app).
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "";
  const isGuestHelp = pathname.startsWith("/help");

  // A real session always wins over explore mode.
  if (!ctx.user && !exploreRole && !isGuestHelp) redirect("/login");

  const isExploring = !ctx.user && Boolean(exploreRole);
  const role = ctx.user ? ((ctx.role as UserRole | null) ?? null) : exploreRole;
  const isAdmin = ctx.user ? ctx.isAdmin : false;

  return (
    <ExploreProvider
      initialRole={isExploring ? exploreRole : null}
      initialDomain={isExploring ? exploreDomain : null}
    >
      <div className="dark app-shell flex h-screen w-full text-foreground">
        <Sidebar role={role} isAdmin={isAdmin} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar email={ctx.user?.email ?? null} role={role} />
          {isExploring ? <ExploreBanner role={exploreRole} /> : null}
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
        <AutoWatchdog />
        <AiFab href={ctx.user ? "/copilot" : "/help/chat"} />
        <ExploreGate />
      </div>
    </ExploreProvider>
  );
}
