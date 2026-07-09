"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ship, Container } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface DrayageOrder {
  id: string;
  reference_code: string | null;
  container_number: string | null;
  container_size: string | null;
  direction: string | null;
  status: string;
  commodity: string | null;
  pickup_city: string | null;
  delivery_city: string | null;
  created_at: string;
  [k: string]: unknown;
}

export default function CustomerDrayagePage() {
  const supabase = getBrowserSupabase();
  const q = useQuery({
    queryKey: ["customer", "drayage-orders"],
    refetchInterval: 20000,
    queryFn: async (): Promise<DrayageOrder[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("drayage_orders")
        .select("*")
        .eq("customer_user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as DrayageOrder[] | null) ?? [];
    },
  });

  const orders = useMemo(() => q.data ?? [], [q.data]);
  const stats = useMemo(
    () => ({
      total: orders.length,
      open: orders.filter((o) => o.status === "Open").length,
      inProgress: orders.filter((o) => !["Open", "Completed", "Cancelled"].includes(o.status)).length,
      completed: orders.filter((o) => o.status === "Completed").length,
    }),
    [orders],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Customer</p>
        <h1 className="text-2xl font-semibold tracking-tight">Container orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track every container move you&apos;ve requested.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat icon={<Container className="h-5 w-5 text-blue-400" />} value={String(stats.total)} label="Total orders" />
        <Stat icon={<Ship className="h-5 w-5 text-yellow-400" />} value={String(stats.open)} label="Open" />
        <Stat icon={<Container className="h-5 w-5 text-primary" />} value={String(stats.inProgress)} label="In progress" />
        <Stat icon={<Container className="h-5 w-5 text-emerald-400" />} value={String(stats.completed)} label="Completed" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Orders</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Ship className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No container orders yet.</p>
            </div>
          ) : (
            orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{o.container_number || o.reference_code || "Container"}</span>
                    {o.container_size && <Badge className="bg-blue-500/15 text-blue-300">{o.container_size}</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {(o.pickup_city || "Origin")} → {(o.delivery_city || "Destination")}
                    {o.commodity ? ` · ${o.commodity}` : ""} · {formatDate(o.created_at)}
                  </p>
                </div>
                <Badge>{o.status}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted">{icon}</div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
