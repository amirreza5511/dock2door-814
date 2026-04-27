"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { OperatorCard } from "@/components/operator-card";
import { formatDate } from "@/lib/utils";

interface Receipt {
  id: string;
  reference: string | null;
  status: string;
  supplier: string | null;
  created_at: string;
}

export default function ReceivingStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const receipts = useQuery({
    queryKey: ["station", "receipts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_receipts")
        .select("id,reference,status,supplier,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Receipt[];
    },
  });

  const [variantId, setVariantId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState("");
  const [lot, setLot] = useState("");
  const [reference, setReference] = useState("");
  const [receiptId, setReceiptId] = useState("");

  const receive = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("wms_receive", {
        p_receipt_id: receiptId || null,
        p_variant_id: variantId,
        p_location_id: locationId,
        p_quantity: Number(qty) || 0,
        p_lot_code: lot || null,
        p_reference: reference || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setVariantId(""); setQty(""); setLot("");
      qc.invalidateQueries({ queryKey: ["station", "receipts"] });
    },
  });

  const open = (receipts.data ?? []).filter((r) => r.status !== "Completed");

  const cols: Column<Receipt>[] = [
    { key: "ref", header: "Reference", render: (r) => <span className="font-medium">{r.reference || r.id.slice(0, 8)}</span>, sortable: true, sortValue: (r) => r.reference ?? r.id },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier ?? "—" },
    { key: "status", header: "Status", render: (r) => <Badge variant={r.status === "Completed" ? "success" : "warning"}>{r.status}</Badge>, sortable: true, sortValue: (r) => r.status },
    { key: "created_at", header: "Created", render: (r) => formatDate(r.created_at), sortable: true, sortValue: (r) => r.created_at },
    { key: "actions", header: "", className: "text-right", render: (r) => (
      <Button size="sm" variant="secondary" onClick={() => { setReceiptId(r.id); setReference(r.reference ?? ""); }}>
        Use ASN
      </Button>
    ) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <OperatorCard stationName="Receiving" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Receiving station</h1>
        <p className="text-sm text-muted-foreground">Check in ASNs, receive lines, putaway to locations.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-semibold">{open.length}</div><div className="text-xs uppercase text-muted-foreground">Open ASNs</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-semibold">{(receipts.data ?? []).length - open.length}</div><div className="text-xs uppercase text-muted-foreground">Completed</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-semibold">{receive.isSuccess ? "1" : "0"}</div><div className="text-xs uppercase text-muted-foreground">Last submit</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Receive line</CardTitle>
          <CardDescription>Writes a stock movement and updates stock levels.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); receive.mutate(); }}
          >
            <div><Label>ASN / receipt id (optional)</Label><Input value={receiptId} onChange={(e) => setReceiptId(e.target.value)} placeholder="receipt_…" /></div>
            <div><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Supplier note" /></div>
            <div><Label>Variant id</Label><Input required value={variantId} onChange={(e) => setVariantId(e.target.value)} placeholder="variant_…" /></div>
            <div><Label>Location id</Label><Input required value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="location_…" /></div>
            <div><Label>Quantity</Label><Input required type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div><Label>Lot / batch</Label><Input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="LOT-…" /></div>
            <div className="md:col-span-2 flex items-center gap-2">
              <Button type="submit" disabled={receive.isPending}>Receive & putaway</Button>
              {receive.error && <span className="text-sm text-red-600">{(receive.error as Error).message}</span>}
              {receive.isSuccess && <span className="text-sm text-emerald-600">Logged.</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>ASN queue</CardTitle><CardDescription>Click "Use ASN" to load it into the form.</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={receipts.data ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            isLoading={receipts.isLoading}
            error={receipts.error as Error | null}
            searchPlaceholder="Search ref, supplier…"
            filters={[
              { value: "open", label: "Open", predicate: (r) => r.status !== "Completed" },
              { value: "done", label: "Completed", predicate: (r) => r.status === "Completed" },
            ]}
            emptyMessage="No ASNs scheduled."
          />
        </CardContent>
      </Card>
    </div>
  );
}
