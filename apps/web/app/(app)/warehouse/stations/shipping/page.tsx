"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  created_at: string;
}

interface Shipment {
  id: string;
  carrier_code: string | null;
  service_level: string | null;
  tracking_code: string | null;
  status: string;
  rate_amount: number | null;
  currency: string | null;
  label_path: string | null;
  created_at: string;
  order_id: string | null;
}

const SAMPLE_SHIP_ORDERS: Order[] = [
  { id: "ex-so-1", reference_code: "FUL-30405", status: "Packed", ship_to_name: "Harbour Outfitters", ship_to_city: "Burnaby", created_at: new Date(Date.now() - 3600000 * 4).toISOString() },
  { id: "ex-so-2", reference_code: "FUL-30398", status: "Packed", ship_to_name: "Cedar & Co.", ship_to_city: "Richmond", created_at: new Date(Date.now() - 3600000 * 8).toISOString() },
  { id: "ex-so-3", reference_code: "FUL-30390", status: "Shipped", ship_to_name: "Maple Retail Group", ship_to_city: "Vancouver", created_at: new Date(Date.now() - 86400000).toISOString() },
];

const SAMPLE_SHIPMENTS: Shipment[] = [
  { id: "ex-sh-1aaa0000", carrier_code: "UPS", service_level: "Ground", tracking_code: "1Z999AA10123456784", status: "InTransit", rate_amount: 18.4, currency: "CAD", label_path: null, created_at: new Date(Date.now() - 86400000).toISOString(), order_id: "ex-so-3" },
  { id: "ex-sh-2bbb0000", carrier_code: "Canada Post", service_level: "Expedited", tracking_code: null, status: "Draft", rate_amount: null, currency: "CAD", label_path: null, created_at: new Date(Date.now() - 3600000 * 2).toISOString(), order_id: "ex-so-1" },
  { id: "ex-sh-3ccc0000", carrier_code: "Purolator", service_level: "Ground", tracking_code: "PUR20481133", status: "Delivered", rate_amount: 22.1, currency: "CAD", label_path: null, created_at: new Date(Date.now() - 86400000 * 3).toISOString(), order_id: null },
];

export default function ShippingStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const [selectedOrder, setSelectedOrder] = useState<string>("");
  const [carrier, setCarrier] = useState<string>("EasyPost");
  const [service, setService] = useState<string>("Ground");

  const orders = useQuery({
    queryKey: ["station", "shipping", "orders"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("id,reference_code,status,ship_to_name,ship_to_city,created_at")
        .in("status", ["Packed", "Shipped"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Order[];
    },
  });

  const shipments = useQuery({
    queryKey: ["station", "shipping", "shipments"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,carrier_code,service_level,tracking_code,status,rate_amount,currency,label_path,created_at,order_id")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Shipment[];
    },
  });

  const createShipment = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_shipment_for_order", {
        p_order_id: selectedOrder,
        p_carrier_code: carrier,
        p_service_level: service,
        p_ship_to: {},
        p_ship_from: {},
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      setSelectedOrder("");
      qc.invalidateQueries({ queryKey: ["station", "shipping"] });
    },
  });

  const purchaseLabel = useMutation({
    mutationFn: async (shipmentId: string) => {
      const { error } = await supabase.functions.invoke("purchase-shipping-label", {
        body: { shipment_id: shipmentId },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["station", "shipping", "shipments"] }),
  });

  const markShipped = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.from("fulfillment_orders").update({ status: "Shipped" }).eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["station", "shipping"] }),
  });

  const orderCols: Column<Order>[] = [
    { key: "ref", header: "Order", render: (o) => <span className="font-medium">{o.reference_code || o.id.slice(0, 8)}</span> },
    { key: "to", header: "Ship to", render: (o) => `${o.ship_to_name ?? "—"}, ${o.ship_to_city ?? ""}` },
    { key: "status", header: "Status", render: (o) => <Badge variant={o.status === "Shipped" ? "success" : "warning"}>{o.status}</Badge> },
    { key: "actions", header: "", className: "text-right", render: (o) => (
      <div className="flex justify-end gap-2">
        {o.status === "Packed" && (
          <>
            <Button size="sm" variant="secondary" onClick={() => { if (!guard("Create a shipment")) return; setSelectedOrder(o.id); }}>Create shipment</Button>
            <Button size="sm" disabled={markShipped.isPending} onClick={() => { if (!guard("Mark an order shipped")) return; markShipped.mutate(o.id); }}>Mark shipped</Button>
          </>
        )}
      </div>
    ) },
  ];

  const shipCols: Column<Shipment>[] = [
    { key: "id", header: "Shipment", render: (s) => <span className="font-mono text-xs">{s.id.slice(0, 8)}</span> },
    { key: "carrier", header: "Carrier", render: (s) => `${s.carrier_code ?? "—"} ${s.service_level ?? ""}` },
    { key: "tracking", header: "Tracking", render: (s) => <span className="font-mono text-xs">{s.tracking_code ?? "—"}</span> },
    { key: "status", header: "Status", render: (s) => <Badge>{s.status}</Badge>, sortable: true, sortValue: (s) => s.status },
    { key: "rate", header: "Rate", render: (s) => s.rate_amount ? `${Number(s.rate_amount).toFixed(2)} ${s.currency ?? ""}` : "—" },
    { key: "created_at", header: "Created", render: (s) => formatDate(s.created_at) },
    { key: "actions", header: "", className: "text-right", render: (s) => (
      <div className="flex justify-end gap-2">
        {s.status === "Draft" && (
          <Button size="sm" disabled={purchaseLabel.isPending} onClick={() => { if (!guard("Buy a shipping label")) return; purchaseLabel.mutate(s.id); }}>Buy label</Button>
        )}
        {s.label_path && <Button size="sm" variant="secondary" onClick={() => window.open(s.label_path!, "_blank")}>Label</Button>}
      </div>
    ) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <OperatorCard stationName="Shipping" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shipping station</h1>
        <p className="text-sm text-muted-foreground">Create shipments, buy labels, and ship orders.</p>
      </div>

      {selectedOrder && (
        <Card>
          <CardHeader><CardTitle>New shipment</CardTitle><CardDescription>Order {selectedOrder.slice(0, 8)}</CardDescription></CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-3"
              onSubmit={(e) => { e.preventDefault(); if (!guard("Create a shipment")) return; createShipment.mutate(); }}
            >
              <div><Label>Carrier</Label><Input value={carrier} onChange={(e) => setCarrier(e.target.value)} /></div>
              <div><Label>Service</Label><Input value={service} onChange={(e) => setService(e.target.value)} /></div>
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={createShipment.isPending}>Create</Button>
                <Button type="button" variant="secondary" onClick={() => setSelectedOrder("")}>Cancel</Button>
              </div>
              {createShipment.error && <p className="md:col-span-3 text-sm text-red-600">{(createShipment.error as Error).message}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Packed orders</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            rows={isExploring ? SAMPLE_SHIP_ORDERS : (orders.data ?? [])}
            columns={orderCols}
            rowKey={(o) => o.id}
            isLoading={!isExploring && orders.isLoading}
            error={isExploring ? null : (orders.error as Error | null)}
            searchPlaceholder="Search ref, ship-to…"
            emptyMessage="No packed orders."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent shipments</CardTitle><CardDescription>{(isExploring ? SAMPLE_SHIPMENTS : shipments.data ?? []).length} shipments</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={isExploring ? SAMPLE_SHIPMENTS : (shipments.data ?? [])}
            columns={shipCols}
            rowKey={(s) => s.id}
            isLoading={!isExploring && shipments.isLoading}
            error={isExploring ? null : (shipments.error as Error | null)}
            searchPlaceholder="Search tracking, carrier…"
            filters={[
              { value: "draft", label: "Draft", predicate: (s) => s.status === "Draft" },
              { value: "label", label: "Label purchased", predicate: (s) => s.status === "LabelPurchased" },
              { value: "intransit", label: "In transit", predicate: (s) => s.status === "InTransit" },
              { value: "delivered", label: "Delivered", predicate: (s) => s.status === "Delivered" },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
