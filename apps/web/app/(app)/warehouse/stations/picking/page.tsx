"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { OperatorCard } from "@/components/operator-card";
import { formatDate } from "@/lib/utils";

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

export default function PickingStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const orders = useQuery({
    queryKey: ["station", "picking", "orders"],
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

  const cols: Column<Order>[] = [
    { key: "ref", header: "Order", render: (o) => <span className="font-medium">{o.reference_code || o.id.slice(0, 8)}</span> },
    { key: "to", header: "Ship to", render: (o) => `${o.ship_to_name ?? "—"}, ${o.ship_to_city ?? ""}` },
    { key: "status", header: "Status", render: (o) => <Badge variant={o.status === "Picking" ? "default" : "warning"}>{o.status}</Badge>, sortable: true, sortValue: (o) => o.status },
    { key: "created_at", header: "Created", render: (o) => formatDate(o.created_at), sortable: true, sortValue: (o) => o.created_at },
    { key: "actions", header: "", className: "text-right", render: (o) => (
      <div className="flex justify-end gap-2">
        {o.status === "Received" && (
          <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: o.id, status: "Picking" })}>Start picking</Button>
        )}
        {o.status === "Picking" && (
          <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: o.id, status: "Packed" })}>Done → Packing</Button>
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
        <CardHeader><CardTitle>Active wave</CardTitle><CardDescription>{orders.data?.length ?? 0} orders to pick</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={orders.data ?? []}
            columns={cols}
            rowKey={(o) => o.id}
            isLoading={orders.isLoading}
            error={orders.error as Error | null}
            searchPlaceholder="Search ref, ship-to…"
            filters={[
              { value: "received", label: "Received", predicate: (o) => o.status === "Received" },
              { value: "picking", label: "In picking", predicate: (o) => o.status === "Picking" },
            ]}
            emptyMessage="No orders waiting to pick."
            bulkActions={[{ label: "Start picking", onRun: async (rows) => {
              for (const o of rows.filter((r) => r.status === "Received")) {
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
