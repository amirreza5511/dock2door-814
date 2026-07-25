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
import { useExplore, useActionGuard } from "@/lib/explore-store";

interface CycleCount {
  id: string;
  variant_id: string | null;
  location_id: string | null;
  system_qty: number | null;
  counted_qty: number | null;
  variance: number | null;
  counted_at: string;
}

interface Movement {
  id: string;
  kind: string;
  variant_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  quantity: number;
  notes: string | null;
  created_at: string;
}

const SAMPLE_COUNTS: CycleCount[] = [
  { id: "ex-cc-1aaa0000", variant_id: "SKU-PALLET-JACK", location_id: "A-01-03", system_qty: 48, counted_qty: 48, variance: 0, counted_at: new Date(Date.now() - 3600000 * 2).toISOString() },
  { id: "ex-cc-2bbb0000", variant_id: "SKU-STRETCH-WRAP", location_id: "B-04-11", system_qty: 120, counted_qty: 116, variance: -4, counted_at: new Date(Date.now() - 3600000 * 6).toISOString() },
  { id: "ex-cc-3ccc0000", variant_id: "SKU-BOX-MED", location_id: "C-02-07", system_qty: 300, counted_qty: 300, variance: 0, counted_at: new Date(Date.now() - 86400000).toISOString() },
];

const SAMPLE_MOVEMENTS: Movement[] = [
  { id: "ex-sm-1", kind: "receive", variant_id: "SKU-BOX-MED", from_location_id: null, to_location_id: "DOCK-1", quantity: 120, notes: "ASN-77812", created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: "ex-sm-2", kind: "pick", variant_id: "SKU-STRETCH-WRAP", from_location_id: "B-04-11", to_location_id: null, quantity: 18, notes: "FUL-30412", created_at: new Date(Date.now() - 3600000 * 3).toISOString() },
  { id: "ex-sm-3", kind: "adjust", variant_id: "SKU-STRETCH-WRAP", from_location_id: "B-04-11", to_location_id: null, quantity: -4, notes: "Count correction", created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
  { id: "ex-sm-4", kind: "transfer", variant_id: "SKU-PALLET-JACK", from_location_id: "A-01-03", to_location_id: "A-02-01", quantity: 6, notes: null, created_at: new Date(Date.now() - 86400000).toISOString() },
];

export default function InventoryStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const [variantId, setVariantId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const counts = useQuery({
    queryKey: ["station", "inventory", "counts"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cycle_counts")
        .select("id,variant_id,location_id,system_qty,counted_qty,variance,counted_at")
        .order("counted_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as CycleCount[];
    },
  });

  const movements = useQuery({
    queryKey: ["station", "inventory", "movements"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id,kind,variant_id,from_location_id,to_location_id,quantity,notes,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Movement[];
    },
  });

  const adjust = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Reason is required for adjustments.");
      const { error } = await supabase.rpc("wms_adjust", {
        p_variant_id: variantId,
        p_location_id: locationId,
        p_delta: Number(delta) || 0,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setVariantId(""); setLocationId(""); setDelta(""); setReason("");
      qc.invalidateQueries({ queryKey: ["station", "inventory"] });
    },
  });

  const countCols: Column<CycleCount>[] = [
    { key: "id", header: "Count", render: (c) => <span className="font-mono text-xs">{c.id.slice(0, 8)}</span> },
    { key: "variant", header: "Variant", render: (c) => c.variant_id ?? "—" },
    { key: "location", header: "Location", render: (c) => c.location_id ?? "—" },
    { key: "expected", header: "Expected", render: (c) => c.system_qty ?? "—" },
    { key: "counted", header: "Counted", render: (c) => c.counted_qty ?? "—" },
    { key: "variance", header: "Variance", render: (c) => (
      <Badge variant={c.variance == null ? "secondary" : Number(c.variance) === 0 ? "success" : "destructive"}>{c.variance ?? "—"}</Badge>
    ), sortable: true, sortValue: (c) => Math.abs(Number(c.variance ?? 0)) },
    { key: "status", header: "Status", render: (c) => <Badge variant={Number(c.variance ?? 0) === 0 ? "success" : "warning"}>{Number(c.variance ?? 0) === 0 ? "Match" : "Variance"}</Badge> },
    { key: "created_at", header: "Created", render: (c) => formatDate(c.counted_at) },
  ];

  const moveCols: Column<Movement>[] = [
    { key: "kind", header: "Kind", render: (m) => <Badge variant={m.kind === "adjust" ? "warning" : "secondary"}>{m.kind}</Badge>, sortable: true, sortValue: (m) => m.kind },
    { key: "variant", header: "Variant", render: (m) => m.variant_id ?? "—" },
    { key: "location", header: "Location", render: (m) => m.to_location_id ?? m.from_location_id ?? "—" },
    { key: "qty", header: "Qty", render: (m) => m.quantity, sortable: true, sortValue: (m) => m.quantity },
    { key: "reason", header: "Reason", render: (m) => m.notes ?? "—" },
    { key: "created_at", header: "When", render: (m) => formatDate(m.created_at) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <OperatorCard stationName="Inventory" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory station</h1>
        <p className="text-sm text-muted-foreground">Cycle counts, transfers, and audited adjustments.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Stock adjustment</CardTitle><CardDescription>Audited via wms_adjust. Reason required.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!guard("Apply a stock adjustment")) return; adjust.mutate(); }}>
            <div><Label>Variant id</Label><Input required value={variantId} onChange={(e) => setVariantId(e.target.value)} /></div>
            <div><Label>Location id</Label><Input required value={locationId} onChange={(e) => setLocationId(e.target.value)} /></div>
            <div><Label>Delta (+/-)</Label><Input required type="number" value={delta} onChange={(e) => setDelta(e.target.value)} /></div>
            <div><Label>Reason</Label><Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damage, count correction…" /></div>
            <div className="md:col-span-2 flex items-center gap-2">
              <Button type="submit" disabled={adjust.isPending}>Apply adjustment</Button>
              {adjust.error && <span className="text-sm text-red-600">{(adjust.error as Error).message}</span>}
              {adjust.isSuccess && <span className="text-sm text-emerald-600">Adjusted.</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cycle counts</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            rows={isExploring ? SAMPLE_COUNTS : (counts.data ?? [])}
            columns={countCols}
            rowKey={(c) => c.id}
            isLoading={!isExploring && counts.isLoading}
            error={isExploring ? null : (counts.error as Error | null)}
            filters={[{ value: "var", label: "Variance ≠ 0", predicate: (c) => Number(c.variance ?? 0) !== 0 }]}
            emptyMessage="No counts yet."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent movements</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            rows={isExploring ? SAMPLE_MOVEMENTS : (movements.data ?? [])}
            columns={moveCols}
            rowKey={(m) => m.id}
            isLoading={!isExploring && movements.isLoading}
            error={isExploring ? null : (movements.error as Error | null)}
            searchPlaceholder="Search reason, variant…"
            emptyMessage="No movements yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
