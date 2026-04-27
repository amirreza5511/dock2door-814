import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function SuperAdminPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
        <p className="text-sm text-muted-foreground">
          Platform-level controls. All admin-only RPCs are audited via <code>audit_logs</code>.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Platform roles</CardTitle>
            <CardDescription>Grant or revoke platform admin / support roles via audited RPC.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/super-admin/roles" className="text-sm text-primary hover:underline">
              Manage platform roles →
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>Every privileged change captures before/after JSONB and a reason.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/audit" className="text-sm text-primary hover:underline">
              Open audit log →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
