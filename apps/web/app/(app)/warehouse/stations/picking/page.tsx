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
  ship_to_city: string | null;
  customer_company_id: string | null;
  created_at: string;
}

const PICKABLE = ["Received", "Picking"];

const SAMPLE_ORDERS: Order[] = [
  { id: "ex-po-1", reference_code: "FUL-30412", status: "Picking", ship_to_name: "Maple Retail Group", ship_to_city: "Vancouver", customer_company_id: null, created_at: new Date(Date.now() - 3600000 * 2).toISOString() },
  { id: "ex-po-2", reference_code: "FUL-30418", status: "Received", ship_to_name: "Harbour Outfitters", ship_to_city: "Burnaby", customer_company_id: null, created_at: new Date(Date.now() - 3600000 * 4).toISOString() },
  { id: "ex-po-3", reference_code: "FUL-30421", status: "Received", ship_to_name: "Cedar & Co.", ship_to_city: "Richmond", customer_company_id: null, created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
];

export default function PickingStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();

  const orders = useQuery({
    queryKey: ["station", "picking", "orders"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("id,reference_code,status,ship_to_name,ship_to_city,customer_company_id,created_at")
        .in("status", PICKABLE)
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["station", "picking", "orders"] }),
  });

  const rows = isExploring ? SAMPLE_ORDERS : (orders.data ?? []);

  const cols: Column<Order>[] = [
    { key: "ref", header: "Order", render: (o) => <span className="font-medium">{o.reference_code || o.id.slice(0, 8)}</span> },
    { key: "to", header: "Ship to", render: (o) => `${o.ship_to_name ?? "—"}, ${o.ship_to_city ?? ""}` },
    { key: "status", header: "Status", render: (o) => <Badge variant={o.status === "Picking" ? "default" : "warning"}>{o.status}</Badge>, sortable: true, sortValue: (o) => o.status },
    { key: "created_at", header: "Created", render: (o) => formatDate(o.created_at), sortable: true, sortValue: (o) => o.created_at },
    { key: "actions", header: "", className: "text-right", render: (o) => (
      <div className="flex justify-end gap-2">
        {o.status === "Received" && (
          <Button size="sm" disabled={setStatus.isPending} onClick={() => { if (!guard("Start picking")) return; setStatus.mutate({ id: o.id, status: "Picking" }); }}>Start picking</Button>
        )}
        {o.status === "Picking" && (
          <Button size="sm" disabled={setStatus.isPending} onClick={() => { if (!guard("Complete a pick")) return; setStatus.mutate({ id: o.id, status: "Packed" }); }}>Done → Packing</Button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <OperatorCard stationName="Picking" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Picking station</h1>
        <p className="text-sm text-muted-foreground">Wave queue. Start picks, hand off to packing.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Active wave</CardTitle><CardDescription>{rows.length} orders to pick</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={rows}
            columns={cols}
            rowKey={(o) => o.id}
            isLoading={!isExploring && orders.isLoading}
            error={isExploring ? null : (orders.error as Error | null)}
            searchPlaceholder="Search ref, ship-to…"
            filters={[
              { value: "received", label: "Received", predicate: (o) => o.status === "Received" },
              { value: "picking", label: "In picking", predicate: (o) => o.status === "Picking" },
            ]}
            emptyMessage="No orders waiting to pick."
            bulkActions={[{ label: "Start picking", onRun: async (selected) => {
              if (!guard("Start picking")) return;
              for (const o of selected.filter((r) => r.status === "Received")) {
                await setStatus.mutateAsync({ id: o.id, status: "Picking" });
              }
            } }]}
            selectable
          />
        </CardContent>
      </Card>
    </div>
  );
}
