"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface Order {
  id: string;
  reference_code: string | null;
  status: string;
  ship_to_name: string | null;
  ship_to_city: string | null;
  customer_company_id: string | null;
  provider_company_id: string | null;
  created_at: string;
}

const NEXT_STATUS: Record<string, string | null> = {
  Draft: "Received",
  Received: "Picking",
  Picking: "Packed",
  Packed: "Shipped",
  Shipped: "Completed",
  Completed: null,
  Cancelled: null,
};

const PAGE_SIZE = 50;

export default function FulfillmentOrdersPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  // id of the order pending cancel confirmation
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ["fulfillment", "orders", page],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("id,reference_code,status,ship_to_name,ship_to_city,customer_company_id,provider_company_id,created_at")
        .order("created_at", { ascending: false })
        .range(0, page * PAGE_SIZE - 1);
      if (error) throw error;
      return (data ?? []) as Order[];
    },
  });

  const advance = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("fulfillment_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", "orders"] });
      setCancelTarget(null);
    },
  });

  const hasMore = (orders.data?.length ?? 0) === page * PAGE_SIZE;

  const cols: Column<Order>[] = [
    {
      key: "ref",
      header: "Order",
      render: (o) => <span className="font-medium">{o.reference_code || o.id.slice(0, 8)}</span>,
      sortable: true,
      sortValue: (o) => o.reference_code ?? o.id,
    },
    {
      key: "status",
      header: "Status",
      render: (o) => <Badge variant={statusVariant(o.status)}>{o.status}</Badge>,
      sortable: true,
      sortValue: (o) => o.status,
    },
    {
      key: "to",
      header: "Ship to",
      render: (o) => `${o.ship_to_name ?? "—"}, ${o.ship_to_city ?? ""}`,
    },
    {
      key: "created_at",
      header: "Created",
      render: (o) => formatDate(o.created_at),
      sortable: true,
      sortValue: (o) => o.created_at,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (o) => {
        const next = NEXT_STATUS[o.status];
        const isCancelPending = cancelTarget === o.id;

        if (isCancelPending) {
          return (
            <div className="flex justify-end items-center gap-2">
              <span className="text-xs text-muted-foreground">Confirm cancel?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={advance.isPending}
                onClick={() => advance.mutate({ id: o.id, status: "Cancelled" })}
              >
                Yes, cancel
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelTarget(null)}>
                No
              </Button>
            </div>
          );
        }

        return (
          <div className="flex justify-end gap-2">
            {next && (
              <Button
                size="sm"
                disabled={advance.isPending}
                onClick={() => advance.mutate({ id: o.id, status: next })}
              >
                → {next}
              </Button>
            )}
            {o.status !== "Cancelled" && o.status !== "Completed" && (
              <Button
                size="sm"
                variant="destructive"
                disabled={advance.isPending}
                onClick={() => setCancelTarget(o.id)}
              >
                Cancel
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fulfillment orders</h1>
        <p className="text-sm text-muted-foreground">All orders across pick / pack / ship.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
          <CardDescription>{orders.data?.length ?? 0} loaded</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            rows={orders.data ?? []}
            columns={cols}
            rowKey={(o) => o.id}
            isLoading={orders.isLoading}
            error={orders.error as Error | null}
            searchPlaceholder="Search ref, ship-to…"
            filters={[
              { value: "draft", label: "Draft", predicate: (o) => o.status === "Draft" },
              { value: "received", label: "Received", predicate: (o) => o.status === "Received" },
              { value: "picking", label: "Picking", predicate: (o) => o.status === "Picking" },
              { value: "packed", label: "Packed", predicate: (o) => o.status === "Packed" },
              { value: "shipped", label: "Shipped", predicate: (o) => o.status === "Shipped" },
              { value: "completed", label: "Completed", predicate: (o) => o.status === "Completed" },
            ]}
            emptyMessage="No fulfillment orders yet."
          />
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
                Load more orders
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function statusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Completed" || s === "Shipped") return "success";
  if (s === "Picking" || s === "Packed" || s === "Received") return "default";
  if (s === "Draft") return "warning";
  if (s === "Cancelled") return "destructive";
  return "secondary";
}
