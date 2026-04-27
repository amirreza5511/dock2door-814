"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface Shipment {
  id: string;
  status: string;
  carrier_code: string | null;
  service_level: string | null;
  tracking_code: string | null;
  rate_amount: number | null;
  currency: string | null;
  label_url: string | null;
  label_path: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export default function FulfillmentShipmentsPage() {
  const supabase = getBrowserSupabase();
  const q = useQuery({
    queryKey: ["fulfillment", "shipments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,status,carrier_code,service_level,tracking_code,rate_amount,currency,label_url,label_path,shipped_at,delivered_at,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Shipment[];
    },
  });

  const cols: Column<Shipment>[] = [
    { key: "id", header: "Shipment", render: (s) => <span className="font-mono text-xs">{s.id.slice(0, 8)}</span> },
    { key: "carrier", header: "Carrier", render: (s) => `${s.carrier_code ?? "—"} ${s.service_level ?? ""}` },
    { key: "tracking", header: "Tracking", render: (s) => <span className="font-mono text-xs">{s.tracking_code ?? "—"}</span> },
    { key: "status", header: "Status", render: (s) => <Badge>{s.status}</Badge>, sortable: true, sortValue: (s) => s.status },
    { key: "rate", header: "Rate", render: (s) => s.rate_amount ? `${Number(s.rate_amount).toFixed(2)} ${s.currency ?? ""}` : "—" },
    { key: "shipped", header: "Shipped", render: (s) => s.shipped_at ? formatDate(s.shipped_at) : "—" },
    { key: "delivered", header: "Delivered", render: (s) => s.delivered_at ? formatDate(s.delivered_at) : "—" },
    { key: "actions", header: "", className: "text-right", render: (s) => (
      s.label_url || s.label_path ? (
        <Button size="sm" variant="secondary" onClick={() => window.open((s.label_url || s.label_path)!, "_blank")}>Label</Button>
      ) : null
    ) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shipments</h1>
        <p className="text-sm text-muted-foreground">All shipments across carriers.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>All shipments</CardTitle><CardDescription>{q.data?.length ?? 0} shipments</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={q.data ?? []}
            columns={cols}
            rowKey={(s) => s.id}
            isLoading={q.isLoading}
            error={q.error as Error | null}
            searchPlaceholder="Search tracking, carrier…"
            filters={["Draft", "LabelPurchased", "InTransit", "Delivered", "Exception", "Voided"].map((st) => ({
              value: st.toLowerCase(),
              label: st,
              predicate: (s: Shipment) => s.status === st,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
