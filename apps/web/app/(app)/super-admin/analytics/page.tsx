"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface PlatformStats {
  totalUsers: number;
  totalCompanies: number;
  totalBookings: number;
  totalRevenue: number;
  activeDisputes: number;
  pendingCerts: number;
  openShifts: number;
  totalShipments: number;
  totalOrders: number;
}

interface RecentBooking {
  id: string;
  status: string;
  total_amount: number | null;
  created_at: string;
}

function StatCard({ label, value, sub, variant }: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "default" | "success" | "warning" | "destructive";
}) {
  const color = {
    default: "text-foreground",
    success: "text-green-600",
    warning: "text-amber-600",
    destructive: "text-red-600",
  }[variant ?? "default"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className={`text-3xl font-black ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function SuperAdminAnalyticsPage() {
  const supabase = getBrowserSupabase();

  const statsQ = useQuery({
    queryKey: ["super-admin", "analytics"],
    queryFn: async (): Promise<PlatformStats> => {
      const [
        { count: totalUsers },
        { count: totalCompanies },
        { count: totalBookings },
        { data: revenueData },
        { count: activeDisputes },
        { count: pendingCerts },
        { count: openShifts },
        { count: totalShipments },
        { count: totalOrders },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("companies").select("*", { count: "exact", head: true }),
        supabase.from("warehouse_bookings").select("*", { count: "exact", head: true }),
        supabase.from("invoices").select("total").eq("status", "Paid"),
        supabase.from("disputes").select("*", { count: "exact", head: true }).eq("status", "Open"),
        supabase.from("worker_certifications").select("*", { count: "exact", head: true }).eq("status", "Pending"),
        supabase.from("shift_posts").select("*", { count: "exact", head: true }).eq("status", "Posted"),
        supabase.from("shipments").select("*", { count: "exact", head: true }),
        supabase.from("fulfillment_orders").select("*", { count: "exact", head: true }),
      ]);

      const totalRevenue = (revenueData ?? []).reduce((s: number, i: { total: number | null }) => s + (i.total ?? 0), 0);

      return {
        totalUsers: totalUsers ?? 0,
        totalCompanies: totalCompanies ?? 0,
        totalBookings: totalBookings ?? 0,
        totalRevenue,
        activeDisputes: activeDisputes ?? 0,
        pendingCerts: pendingCerts ?? 0,
        openShifts: openShifts ?? 0,
        totalShipments: totalShipments ?? 0,
        totalOrders: totalOrders ?? 0,
      };
    },
  });

  const recentBookingsQ = useQuery({
    queryKey: ["super-admin", "recent-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_bookings")
        .select("id,status,total_amount,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as RecentBooking[];
    },
  });

  const usersByRoleQ = useQuery({
    queryKey: ["super-admin", "users-by-role"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("role");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const p of data ?? []) {
        const r = (p as any).role ?? "Unknown";
        counts[r] = (counts[r] ?? 0) + 1;
      }
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([role, count]) => ({ role, count }));
    },
  });

  const companiesByTypeQ = useQuery({
    queryKey: ["super-admin", "companies-by-type"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("type");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const c of data ?? []) {
        const t = (c as any).type ?? "Unknown";
        counts[t] = (counts[t] ?? 0) + 1;
      }
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count }));
    },
  });

  const s = statsQ.data;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Live KPIs across users, companies, bookings, revenue, labour, and fulfillment.
        </p>
      </div>

      {statsQ.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-8">
                <div className="h-8 w-24 rounded bg-muted animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Total users" value={s?.totalUsers ?? 0} />
          <StatCard label="Total companies" value={s?.totalCompanies ?? 0} />
          <StatCard label="Total bookings (warehouse)" value={s?.totalBookings ?? 0} />
          <StatCard
            label="Gross revenue (paid invoices)"
            value={`$${(s?.totalRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            variant="success"
          />
          <StatCard
            label="Active disputes"
            value={s?.activeDisputes ?? 0}
            variant={s && s.activeDisputes > 0 ? "destructive" : "default"}
          />
          <StatCard
            label="Pending certifications"
            value={s?.pendingCerts ?? 0}
            variant={s && s.pendingCerts > 0 ? "warning" : "default"}
          />
          <StatCard label="Open shifts" value={s?.openShifts ?? 0} />
          <StatCard label="Total shipments" value={s?.totalShipments ?? 0} />
          <StatCard label="Total orders (OMS)" value={s?.totalOrders ?? 0} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Users by role */}
        <Card>
          <CardHeader>
            <CardTitle>Users by role</CardTitle>
          </CardHeader>
          <CardContent>
            {usersByRoleQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-2">
                {(usersByRoleQ.data ?? []).map(({ role, count }) => (
                  <div key={role} className="flex items-center justify-between">
                    <Badge variant="secondary">{role}</Badge>
                    <span className="text-sm font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Companies by type */}
        <Card>
          <CardHeader>
            <CardTitle>Companies by type</CardTitle>
          </CardHeader>
          <CardContent>
            {companiesByTypeQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-2">
                {(companiesByTypeQ.data ?? []).map(({ type, count }) => (
                  <div key={type} className="flex items-center justify-between">
                    <Badge variant="secondary">{type}</Badge>
                    <span className="text-sm font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent bookings */}
        <Card>
          <CardHeader>
            <CardTitle>Recent bookings</CardTitle>
          </CardHeader>
          <CardContent>
            {recentBookingsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (recentBookingsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No bookings yet.</p>
            ) : (
              <div className="space-y-2">
                {(recentBookingsQ.data ?? []).map((b) => (
                  <div key={b.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-xs">{b.id.slice(0, 8)}…</p>
                      <p className="text-xs text-muted-foreground">{formatDate(b.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          b.status === "Completed"
                            ? "success"
                            : b.status === "InProgress" || b.status === "Accepted"
                            ? "default"
                            : b.status === "Requested" || b.status === "Countered"
                            ? "warning"
                            : "secondary"
                        }
                      >
                        {b.status}
                      </Badge>
                      {b.total_amount != null && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          ${Number(b.total_amount).toFixed(2)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
