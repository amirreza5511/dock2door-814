"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface Order {
  id: string;
  reference_code: string | null;
  status: string;
  ship_to_name: string | null;
  ship_to_city: string | null;
  created_at: string;
}

export default function CustomerOrdersPage() {
  const supabase = getBrowserSupabase();
  const orders = useQuery({
    queryKey: ["customer", "orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("id,reference_code,status,ship_to_name,ship_to_city,created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Order[];
    },
  });

  const cols: Column<Order>[] = [
    { key: "ref", header: "Order", render: (o) => <span className="font-medium">{o.reference_code || o.id.slice(0, 8)}</span> },
    { key: "status", header: "Status", render: (o) => <Badge>{o.status}</Badge>, sortable: true, sortValue: (o) => o.status },
    { key: "to", header: "Ship to", render: (o) => `${o.ship_to_name ?? "—"}, ${o.ship_to_city ?? ""}` },
    { key: "created_at", header: "Created", render: (o) => formatDate(o.created_at), sortable: true, sortValue: (o) => o.created_at },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My orders</h1>
        <p className="text-sm text-muted-foreground">Provider identities are intentionally hidden — Dock2Door is your operator of record.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Orders</CardTitle><CardDescription>{orders.data?.length ?? 0} total</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={orders.data ?? []}
            columns={cols}
            rowKey={(o) => o.id}
            isLoading={orders.isLoading}
            error={orders.error as Error | null}
            searchPlaceholder="Search ref…"
            filters={["Draft", "Received", "Picking", "Packed", "Shipped", "Completed", "Cancelled"].map((s) => ({
              value: s.toLowerCase(), label: s, predicate: (o: Order) => o.status === s,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
