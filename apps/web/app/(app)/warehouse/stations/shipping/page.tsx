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

export default function ShippingStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<string>("");
  const [carrier, setCarrier] = useState<string>("EasyPost");
  const [service, setService] = useState<string>("Ground");

  const orders = useQuery({
    queryKey: ["station", "shipping", "orders"],
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
            <Button size="sm" variant="secondary" onClick={() => setSelectedOrder(o.id)}>Create shipment</Button>
            <Button size="sm" disabled={markShipped.isPending} onClick={() => markShipped.mutate(o.id)}>Mark shipped</Button>
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
          <Button size="sm" disabled={purchaseLabel.isPending} onClick={() => purchaseLabel.mutate(s.id)}>Buy label</Button>
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
              onSubmit={(e) => { e.preventDefault(); createShipment.mutate(); }}
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
            rows={orders.data ?? []}
            columns={orderCols}
            rowKey={(o) => o.id}
            isLoading={orders.isLoading}
            error={orders.error as Error | null}
            searchPlaceholder="Search ref, ship-to…"
            emptyMessage="No packed orders."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent shipments</CardTitle><CardDescription>{shipments.data?.length ?? 0} shipments</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={shipments.data ?? []}
            columns={shipCols}
            rowKey={(s) => s.id}
            isLoading={shipments.isLoading}
            error={shipments.error as Error | null}
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
