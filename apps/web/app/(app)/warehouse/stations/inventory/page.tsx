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

interface CycleCount {
  id: string;
  variant_id: string | null;
  location_id: string | null;
  expected: number | null;
  counted: number | null;
  variance: number | null;
  status: string | null;
  created_at: string;
}

interface Movement {
  id: string;
  kind: string;
  variant_id: string | null;
  location_id: string | null;
  quantity: number;
  reason: string | null;
  created_at: string;
}

export default function InventoryStationPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [variantId, setVariantId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const counts = useQuery({
    queryKey: ["station", "inventory", "counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cycle_counts")
        .select("id,variant_id,location_id,expected,counted,variance,status,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as CycleCount[];
    },
  });

  const movements = useQuery({
    queryKey: ["station", "inventory", "movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id,kind,variant_id,location_id,quantity,reason,created_at")
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
    { key: "expected", header: "Expected", render: (c) => c.expected ?? "—" },
    { key: "counted", header: "Counted", render: (c) => c.counted ?? "—" },
    { key: "variance", header: "Variance", render: (c) => (
      <Badge variant={!c.variance ? "secondary" : Number(c.variance) === 0 ? "success" : "destructive"}>{c.variance ?? "—"}</Badge>
    ), sortable: true, sortValue: (c) => Math.abs(Number(c.variance ?? 0)) },
    { key: "status", header: "Status", render: (c) => <Badge>{c.status ?? "—"}</Badge> },
    { key: "created_at", header: "Created", render: (c) => formatDate(c.created_at) },
  ];

  const moveCols: Column<Movement>[] = [
    { key: "kind", header: "Kind", render: (m) => <Badge variant={m.kind === "adjust" ? "warning" : "secondary"}>{m.kind}</Badge>, sortable: true, sortValue: (m) => m.kind },
    { key: "variant", header: "Variant", render: (m) => m.variant_id ?? "—" },
    { key: "location", header: "Location", render: (m) => m.location_id ?? "—" },
    { key: "qty", header: "Qty", render: (m) => m.quantity, sortable: true, sortValue: (m) => m.quantity },
    { key: "reason", header: "Reason", render: (m) => m.reason ?? "—" },
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
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); adjust.mutate(); }}>
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
            rows={counts.data ?? []}
            columns={countCols}
            rowKey={(c) => c.id}
            isLoading={counts.isLoading}
            error={counts.error as Error | null}
            filters={[{ value: "var", label: "Variance ≠ 0", predicate: (c) => Number(c.variance ?? 0) !== 0 }]}
            emptyMessage="No counts yet."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent movements</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            rows={movements.data ?? []}
            columns={moveCols}
            rowKey={(m) => m.id}
            isLoading={movements.isLoading}
            error={movements.error as Error | null}
            searchPlaceholder="Search reason, variant…"
            emptyMessage="No movements yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
