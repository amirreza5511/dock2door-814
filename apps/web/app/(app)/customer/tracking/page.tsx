"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface Shipment {
  id: string;
  status: string;
  carrier_code: string | null;
  service_level: string | null;
  tracking_code: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

interface Event {
  id: string;
  shipment_id: string;
  description: string | null;
  status: string | null;
  city: string | null;
  region: string | null;
  occurred_at: string;
}

export default function CustomerTrackingPage() {
  const supabase = getBrowserSupabase();

  const shipments = useQuery({
    queryKey: ["customer", "shipments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,status,carrier_code,service_level,tracking_code,shipped_at,delivered_at,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Shipment[];
    },
  });

  const events = useQuery({
    queryKey: ["customer", "tracking_events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_events")
        .select("id,shipment_id,description,status,city,region,occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Event[];
    },
  });

  const shipCols: Column<Shipment>[] = [
    { key: "id", header: "Shipment", render: (s) => <span className="font-mono text-xs">{s.id.slice(0, 8)}</span> },
    { key: "carrier", header: "Carrier", render: (s) => `${s.carrier_code ?? "—"} ${s.service_level ?? ""}` },
    { key: "tracking", header: "Tracking", render: (s) => <span className="font-mono text-xs">{s.tracking_code ?? "—"}</span> },
    { key: "status", header: "Status", render: (s) => <Badge variant={s.status === "Delivered" ? "success" : "default"}>{s.status}</Badge>, sortable: true, sortValue: (s) => s.status },
    { key: "shipped", header: "Shipped", render: (s) => s.shipped_at ? formatDate(s.shipped_at) : "—" },
    { key: "delivered", header: "Delivered", render: (s) => s.delivered_at ? formatDate(s.delivered_at) : "—" },
  ];

  const evtCols: Column<Event>[] = [
    { key: "shipment", header: "Shipment", render: (e) => <span className="font-mono text-xs">{e.shipment_id.slice(0, 8)}</span> },
    { key: "desc", header: "Event", render: (e) => e.description ?? "—" },
    { key: "status", header: "Status", render: (e) => e.status ?? "—" },
    { key: "loc", header: "Location", render: (e) => [e.city, e.region].filter(Boolean).join(", ") || "—" },
    { key: "when", header: "When", render: (e) => formatDate(e.occurred_at), sortable: true, sortValue: (e) => e.occurred_at },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tracking</h1>
        <p className="text-sm text-muted-foreground">Live carrier events.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>My shipments</CardTitle><CardDescription>{shipments.data?.length ?? 0} shipments</CardDescription></CardHeader>
        <CardContent>
          <DataTable rows={shipments.data ?? []} columns={shipCols} rowKey={(s) => s.id} isLoading={shipments.isLoading} error={shipments.error as Error | null} searchPlaceholder="Search tracking…" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent events</CardTitle></CardHeader>
        <CardContent>
          <DataTable rows={events.data ?? []} columns={evtCols} rowKey={(e) => e.id} isLoading={events.isLoading} error={events.error as Error | null} emptyMessage="No tracking events yet." />
        </CardContent>
      </Card>
    </div>
  );
}
