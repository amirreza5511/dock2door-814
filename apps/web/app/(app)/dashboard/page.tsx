import { redirect } from "next/navigation";
import { getCurrentSessionContext } from "@/lib/supabase/server";
import { homeForRole } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UserRole } from "@/lib/types";

export default async function DashboardPage() {
  const ctx = await getCurrentSessionContext();
  if (!ctx.user) redirect("/login");

  const role = (ctx.role as UserRole | null) ?? null;
  if (role && role !== "Admin" && role !== "SuperAdmin") {
    redirect(homeForRole(role));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {ctx.user.email}
          {role ? ` · ${role}` : ""}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Companies</CardTitle>
            <CardDescription>Approve and manage tenants</CardDescription>
          </CardHeader>
          <CardContent>
            <a className="text-sm text-primary hover:underline" href="/admin/companies">
              Open Companies →
            </a>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Certifications</CardTitle>
            <CardDescription>Worker compliance approvals</CardDescription>
          </CardHeader>
          <CardContent>
            <a className="text-sm text-primary hover:underline" href="/admin/certifications">
              Open Certifications →
            </a>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
            <CardDescription>Edge functions, RPCs, integrations</CardDescription>
          </CardHeader>
          <CardContent>
            <a className="text-sm text-primary hover:underline" href="/admin/health">
              Open Health →
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
