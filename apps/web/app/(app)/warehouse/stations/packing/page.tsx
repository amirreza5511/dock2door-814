"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { OperatorCard } from "@/components/operator-card";
import { formatDate } from "@/lib/utils";
import { useExplore, useActionGuard } from "@/lib/explore-store";

interface Order {
  id: string;
  reference_code: string | null;
  status: string;
  ship_to_name: string | null;
  created_at: string;
}

const SAMPLE_ORDERS: Order[] = [
  { id: "ex-pk-1", reference_code: "FUL-30409", status: "Picking", ship_to_name: "Maple Retail Group", created_at: new Date(Date.now() - 3600000 * 3).toISOString() },
  { id: "ex-pk-2", reference_code: "FUL-30405", status: "Packed", ship_to_name: "Harbour Outfitters", created_at: new Date(Date.now() - 3600000 * 6).toISOString() },
  { id: "ex-pk-3", reference_code: "FUL-30398", status: "Packed", ship_to_name: "Cedar & Co.", created_at: new Date(Date.now() - 86400000).toISOString() },
];

export default function PackingStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();

  const orders = useQuery({
    queryKey: ["station", "packing", "orders"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("id,reference_code,status,ship_to_name,created_at")
        .in("status", ["Picking", "Packed"])
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Order[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("fulfillment_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["station", "packing", "orders"] }),
  });

  const rows = isExploring ? SAMPLE_ORDERS : (orders.data ?? []);

  const cols: Column<Order>[] = [
    { key: "ref", header: "Order", render: (o) => <span className="font-medium">{o.reference_code || o.id.slice(0, 8)}</span> },
    { key: "to", header: "Ship to", render: (o) => o.ship_to_name ?? "—" },
    { key: "status", header: "Status", render: (o) => <Badge variant={o.status === "Packed" ? "success" : "warning"}>{o.status}</Badge>, sortable: true, sortValue: (o) => o.status },
    { key: "created_at", header: "Created", render: (o) => formatDate(o.created_at), sortable: true, sortValue: (o) => o.created_at },
    { key: "actions", header: "", className: "text-right", render: (o) => (
      <div className="flex justify-end gap-2">
        {o.status === "Picking" && <Button size="sm" disabled={setStatus.isPending} onClick={() => { if (!guard("Mark packed")) return; setStatus.mutate({ id: o.id, status: "Packed" }); }}>Mark packed</Button>}
        {o.status === "Packed" && <Button size="sm" variant="secondary" disabled={setStatus.isPending} onClick={() => { if (!guard("Reopen an order")) return; setStatus.mutate({ id: o.id, status: "Picking" }); }}>Reopen</Button>}
      </div>
    ) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <OperatorCard stationName="Packing" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Packing station</h1>
        <p className="text-sm text-muted-foreground">Pack picked orders, weigh, and hand off to shipping.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Pack queue</CardTitle><CardDescription>{rows.length} orders</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={rows}
            columns={cols}
            rowKey={(o) => o.id}
            isLoading={!isExploring && orders.isLoading}
            error={isExploring ? null : (orders.error as Error | null)}
            searchPlaceholder="Search ref, ship-to…"
            filters={[
              { value: "ready", label: "Ready to pack", predicate: (o) => o.status === "Picking" },
              { value: "packed", label: "Packed", predicate: (o) => o.status === "Packed" },
            ]}
            emptyMessage="Nothing to pack."
          />
        </CardContent>
      </Card>
    </div>
  );
}
