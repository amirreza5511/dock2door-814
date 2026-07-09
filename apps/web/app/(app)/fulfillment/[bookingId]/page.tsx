"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useMyCompanies } from "@/lib/hooks/use-active-company";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import {
  AlertOctagon,
  Archive,
  ArrowLeft,
  Box,
  CheckCircle2,
  ClipboardList,
  FileText,
  Package,
  Plus,
  Truck,
} from "lucide-react";

interface FInventory { id: string; sku: string; name: string | null; quantity: number }
interface FOrderItem { id: string; order_id: string; sku: string; name: string | null; quantity: number }
interface FOrder {
  id: string;
  reference_code: string | null;
  ship_to_address: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}
interface BookingRow {
  id: string;
  listing_id: string | null;
  customer_company_id: string | null;
  status: string | null;
  reference_number: string | null;
}

const ACTIVE_STATUSES = ["Accepted", "Confirmed", "Scheduled", "InProgress", "Active"];
const PICKED = ["Picking", "Packed", "Shipped", "Completed"];
const PACKED = ["Packed", "Shipped", "Completed"];
const SHIPPED = ["Shipped", "Completed"];

export default function FulfillmentBookingPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useParams<{ bookingId: string }>();
  const bookingId = params.bookingId;
  const { data: companies } = useMyCompanies();
  const myCompanyIds = useMemo(() => new Set((companies ?? []).map((c) => c.company_id)), [companies]);

  const [tab, setTab] = useState<"inventory" | "orders">("inventory");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [orderShipTo, setOrderShipTo] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["fulfillment", "booking", bookingId],
    enabled: Boolean(bookingId),
    queryFn: async () => {
      const { data: booking, error } = await supabase
        .from("warehouse_bookings")
        .select("id,listing_id,customer_company_id,status,reference_number")
        .eq("id", bookingId)
        .maybeSingle();
      if (error || !booking) throw new Error("Booking not found");

      let providerCompanyId: string | null = null;
      if (booking.listing_id) {
        const { data: listing } = await supabase
          .from("warehouse_listings")
          .select("company_id")
          .eq("id", booking.listing_id)
          .maybeSingle();
        providerCompanyId = listing?.company_id ?? null;
      }
      const role: "customer" | "provider" =
        providerCompanyId && myCompanyIds.has(providerCompanyId) ? "provider" : "customer";

      const { data: inventory } = await supabase
        .from("booking_inventory").select("*").eq("booking_id", bookingId);
      const { data: orders } = await supabase
        .from("fulfillment_orders").select("*").eq("booking_id", bookingId)
        .order("created_at", { ascending: false });
      const orderIds = (orders ?? []).map((o: FOrder) => o.id);
      const { data: items } = orderIds.length
        ? await supabase.from("order_items").select("*").in("order_id", orderIds)
        : { data: [] as FOrderItem[] };

      return {
        booking: booking as BookingRow,
        role,
        inventory: (inventory ?? []) as FInventory[],
        orders: (orders ?? []) as FOrder[],
        orderItems: (items ?? []) as FOrderItem[],
      };
    },
  });

  const data = query.data;
  const isProvider = data?.role === "provider";

  const orderItemsByOrder = useMemo(() => {
    const map = new Map<string, FOrderItem[]>();
    for (const item of data?.orderItems ?? []) {
      const arr = map.get(item.order_id) ?? [];
      arr.push(item);
      map.set(item.order_id, arr);
    }
    return map;
  }, [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["fulfillment", "booking", bookingId] });

  const addInventory = useMutation({
    mutationFn: async () => {
      const qty = Number(quantity);
      if (!sku.trim() || !qty || qty <= 0) throw new Error("Provide a SKU and a positive quantity.");
      const { error } = await supabase.from("booking_inventory").insert({
        booking_id: bookingId, sku: sku.trim(), name: description.trim(), quantity: qty,
      });
      if (error) throw error;
    },
    onSuccess: () => { setSku(""); setDescription(""); setQuantity(""); setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!orderRef.trim()) throw new Error("Provide an order reference.");
      const status = data?.booking.status ?? "";
      if (!ACTIVE_STATUSES.includes(status)) {
        throw new Error(`Booking must be Accepted or Active first (currently "${status || "unknown"}").`);
      }
      const items = Object.entries(selection)
        .map(([id, raw]) => ({ id, quantity: Number(raw) }))
        .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0);
      if (items.length === 0) throw new Error("Enter quantities for at least one inventory item.");

      let providerCompanyId: string | null = null;
      if (data?.booking.listing_id) {
        const { data: listing } = await supabase
          .from("warehouse_listings").select("company_id").eq("id", data.booking.listing_id).maybeSingle();
        providerCompanyId = listing?.company_id ?? null;
      }
      const { data: order, error } = await supabase.from("fulfillment_orders").insert({
        booking_id: bookingId,
        customer_company_id: data?.booking.customer_company_id ?? null,
        provider_company_id: providerCompanyId,
        reference_code: orderRef.trim(),
        status: "Received",
        ship_to_address: orderShipTo.trim(),
        notes: orderNotes.trim(),
      }).select().single();
      if (error) throw error;

      for (const it of items) {
        const inv = (data?.inventory ?? []).find((i) => i.id === it.id);
        await supabase.from("order_items").insert({
          order_id: order!.id, sku: inv?.sku ?? "", name: inv?.name ?? "", quantity: it.quantity,
        });
      }
    },
    onSuccess: () => {
      setOrderRef(""); setOrderShipTo(""); setOrderNotes(""); setSelection({}); setErr(null);
      setTab("orders"); invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const advance = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const { error } = await supabase.rpc("advance_fulfillment_order", {
        p_order_id: orderId, p_next_status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });

  if (!bookingId) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Fulfillment</h1>
          <p className="text-sm text-muted-foreground">
            Booking #{bookingId.slice(0, 8).toUpperCase()}
            {data?.booking.reference_number ? ` · ${data.booking.reference_number}` : ""}
          </p>
        </div>
        {data ? <Badge>{data.booking.status ?? "—"}</Badge> : null}
        <Button variant="outline" size="sm" onClick={() => router.push(`/fulfillment/bol/${bookingId}`)}>
          <FileText className="mr-2 h-4 w-4" /> BOL
        </Button>
        <Button variant="outline" size="sm" onClick={() => router.push(`/fulfillment/grn/${bookingId}`)}>
          <CheckCircle2 className="mr-2 h-4 w-4" /> GRN
        </Button>
      </div>

      {query.isError ? (
        <Card><CardContent className="py-8 text-center text-sm text-destructive">
          {(query.error as Error)?.message ?? "Unable to load fulfillment"}
        </CardContent></Card>
      ) : query.isLoading ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : data ? (
        <>
          {err ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertOctagon className="h-4 w-4" /> {err}
            </div>
          ) : null}

          <div className="flex gap-2 border-b">
            <button
              onClick={() => setTab("inventory")}
              className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${tab === "inventory" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            >
              <Package className="h-4 w-4" /> Inventory ({data.inventory.length})
            </button>
            <button
              onClick={() => setTab("orders")}
              className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${tab === "orders" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            >
              <ClipboardList className="h-4 w-4" /> Orders ({data.orders.length})
            </button>
          </div>

          {tab === "inventory" ? (
            <div className="space-y-4">
              {!isProvider ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Add inventory</CardTitle>
                    <p className="text-sm text-muted-foreground">Register items stored under this booking.</p>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label>SKU</Label>
                      <Input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder="SKU-001" />
                    </div>
                    <div className="space-y-1">
                      <Label>Description</Label>
                      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Blue widgets" />
                    </div>
                    <div className="space-y-1">
                      <Label>Quantity</Label>
                      <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" placeholder="100" />
                    </div>
                    <div className="sm:col-span-3">
                      <Button onClick={() => addInventory.mutate()} disabled={addInventory.isPending}>
                        <Plus className="mr-2 h-4 w-4" /> Add item
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card><CardContent className="py-4 text-sm text-muted-foreground">
                  Inventory is managed by the customer. Orders they create appear in the Orders tab.
                </CardContent></Card>
              )}

              {data.inventory.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No inventory yet.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {data.inventory.map((inv) => (
                    <Card key={inv.id}>
                      <CardContent className="flex items-center gap-3 py-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted"><Archive className="h-4 w-4" /></div>
                        <div className="flex-1">
                          <p className="font-medium">{inv.sku}</p>
                          {inv.name ? <p className="text-xs text-muted-foreground">{inv.name}</p> : null}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold">{inv.quantity}</p>
                          <p className="text-[10px] text-muted-foreground">units</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {!isProvider && data.inventory.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Create outbound order</CardTitle>
                    <p className="text-sm text-muted-foreground">Select quantities to ship from inventory.</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label>Reference</Label>
                        <Input value={orderRef} onChange={(e) => setOrderRef(e.target.value.toUpperCase())} placeholder="PO-1024" />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Ship to</Label>
                        <Input value={orderShipTo} onChange={(e) => setOrderShipTo(e.target.value)} placeholder="Receiver address" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Notes</Label>
                      <Textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="Fragile" rows={2} />
                    </div>
                    <div className="space-y-2">
                      <Label>Items</Label>
                      {data.inventory.map((inv) => (
                        <div key={inv.id} className="flex items-center gap-3 border-b py-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{inv.sku}</p>
                            <p className="text-xs text-muted-foreground">Available: {inv.quantity}</p>
                          </div>
                          <Input
                            className="w-24"
                            value={selection[inv.id] ?? ""}
                            onChange={(e) => setSelection((p) => ({ ...p, [inv.id]: e.target.value }))}
                            inputMode="numeric"
                            placeholder="0"
                          />
                        </div>
                      ))}
                    </div>
                    <Button onClick={() => createOrder.mutate()} disabled={createOrder.isPending}>
                      <Plus className="mr-2 h-4 w-4" /> Create order
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              {!isProvider && data.inventory.length === 0 ? (
                <Card><CardContent className="py-4 text-sm text-muted-foreground">
                  Add inventory first, then create an order from the Inventory tab.
                </CardContent></Card>
              ) : null}

              {data.orders.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No orders yet.</CardContent></Card>
              ) : (
                <div className="space-y-3">
                  {data.orders.map((order) => {
                    const items = orderItemsByOrder.get(order.id) ?? [];
                    const isException = order.status === "Exception";
                    return (
                      <Card key={order.id} className={isException ? "border-destructive/50" : ""}>
                        <CardContent className="space-y-3 py-4">
                          {isException ? (
                            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                              <AlertOctagon className="h-4 w-4" /> Exception flagged — review notes before shipping.
                            </div>
                          ) : null}
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted"><Box className="h-4 w-4" /></div>
                            <div className="flex-1">
                              <p className="font-medium">{order.reference_code || `Order ${order.id.slice(0, 8)}`}</p>
                              <p className="text-xs text-muted-foreground">
                                {items.length} line{items.length === 1 ? "" : "s"} · {formatDate(order.created_at)}
                              </p>
                            </div>
                            <Badge>{order.status}</Badge>
                          </div>

                          {order.ship_to_address ? <p className="text-sm text-muted-foreground">Ship to: {order.ship_to_address}</p> : null}
                          {order.notes ? <p className="text-sm italic text-muted-foreground">{order.notes}</p> : null}

                          {items.length > 0 ? (
                            <div className="space-y-1 border-y py-2">
                              {items.map((it) => (
                                <div key={it.id} className="flex justify-between text-sm">
                                  <span>{it.sku}</span>
                                  <span className="text-muted-foreground">x {it.quantity}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Step active={PICKED.includes(order.status)} label="Picked" />
                            <Step active={PACKED.includes(order.status)} label="Packed" />
                            <Step active={SHIPPED.includes(order.status)} label="Shipped" />
                            <Step active={order.status === "Completed"} label="Completed" />
                          </div>

                          {isProvider ? (
                            <div className="flex flex-wrap gap-2">
                              {order.status === "Received" ? (
                                <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({ orderId: order.id, status: "Picking" })}>
                                  <CheckCircle2 className="mr-2 h-4 w-4" /> Mark picked
                                </Button>
                              ) : null}
                              {order.status === "Picking" ? (
                                <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({ orderId: order.id, status: "Packed" })}>
                                  <Box className="mr-2 h-4 w-4" /> Mark packed
                                </Button>
                              ) : null}
                              {order.status === "Packed" ? (
                                <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({ orderId: order.id, status: "Shipped" })}>
                                  <Truck className="mr-2 h-4 w-4" /> Ship
                                </Button>
                              ) : null}
                              {order.status === "Shipped" ? (
                                <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({ orderId: order.id, status: "Completed" })}>
                                  <CheckCircle2 className="mr-2 h-4 w-4" /> Mark completed
                                </Button>
                              ) : null}
                              {order.status === "Completed" ? (
                                <span className="flex items-center gap-1 text-sm text-emerald-600">
                                  <CheckCircle2 className="h-4 w-4" /> Order completed
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Step({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
      <span className={active ? "text-foreground" : ""}>{label}</span>
    </div>
  );
}
