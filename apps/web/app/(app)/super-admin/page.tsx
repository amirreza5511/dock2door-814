import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Tile {
  title: string;
  description: string;
  href: string;
  badge?: number;
  badgeTone?: "default" | "warning" | "destructive";
}

export default async function SuperAdminPage() {
  const supabase = await getServerSupabase();

  // Real counts; if any query is blocked by RLS we just hide the badge.
  const [
    pendingCertsRes,
    pendingCompaniesRes,
    openDisputesRes,
    pendingPhotosRes,
  ] = await Promise.all([
    supabase.from("worker_certifications").select("id", { count: "exact", head: true }).eq("status", "Pending"),
    supabase.from("companies").select("id", { count: "exact", head: true }).in("status", ["PendingApproval", "Pending"]),
    supabase.from("disputes").select("id", { count: "exact", head: true }).in("status", ["Open", "UnderReview"]),
    supabase.from("worker_profiles").select("user_id", { count: "exact", head: true }).eq("work_photo_status", "Pending"),
  ]);

  const tiles: Tile[] = [
    {
      title: "Pending worker certifications",
      description: "Approve or reject worker documents. Approvals immediately become employer-visible qualifications.",
      href: "/admin/certifications",
      badge: pendingCertsRes.count ?? undefined,
      badgeTone: (pendingCertsRes.count ?? 0) > 0 ? "warning" : "default",
    },
    {
      title: "Pending companies",
      description: "Review employer / provider applications. Approve, reject (reason required), or suspend.",
      href: "/admin/companies",
      badge: pendingCompaniesRes.count ?? undefined,
      badgeTone: (pendingCompaniesRes.count ?? 0) > 0 ? "warning" : "default",
    },
    {
      title: "Open disputes",
      description: "Hour disputes and no-show disputes awaiting resolution.",
      href: "/admin/disputes",
      badge: openDisputesRes.count ?? undefined,
      badgeTone: (openDisputesRes.count ?? 0) > 0 ? "destructive" : "default",
    },
    {
      title: "Work-photo moderation",
      description: "Approve or reject worker work photos before they become company / public visible.",
      href: "/admin/work-photos",
      badge: pendingPhotosRes.count ?? undefined,
      badgeTone: (pendingPhotosRes.count ?? 0) > 0 ? "warning" : "default",
    },
    {
      title: "Users",
      description: "Search users, change platform role, suspend (reason required).",
      href: "/admin/users",
    },
    {
      title: "Platform roles",
      description: "Grant / revoke platform admin & support roles via audited RPC.",
      href: "/super-admin/roles",
    },
    {
      title: "Audit log",
      description: "Every privileged change captures before / after JSONB and a reason.",
      href: "/admin/audit",
    },
    {
      title: "Platform settings",
      description: "Commission percentages and tax mode — all mutations audited.",
      href: "/admin/platform-settings",
    },
    {
      title: "Data manager",
      description: "Read-only entity browser. Business writes routed through proper workflow RPCs.",
      href: "/super-admin/data-manager",
    },
    {
      title: "Analytics",
      description: "GMV, active companies, pending applications, fill-rate.",
      href: "/super-admin/analytics",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
        <p className="text-sm text-muted-foreground">
          What needs your attention right now? All privileged actions go through audited RPCs and write to <code>audit_logs</code>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="block">
            <Card className="h-full transition hover:border-primary/60 hover:shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">{t.title}</CardTitle>
                  {typeof t.badge === "number" && t.badge > 0 && (
                    <Badge variant={t.badgeTone === "destructive" ? "destructive" : t.badgeTone === "warning" ? "warning" : "secondary"}>
                      {t.badge}
                    </Badge>
                  )}
                </div>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm font-medium text-primary">Open →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
