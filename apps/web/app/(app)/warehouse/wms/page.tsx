"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { useExplore } from "@/lib/explore-store";

const SAMPLE_RECEIPTS: ReceiptRow[] = [
  { id: "ex-rcpt-0001aa", status: "Receiving", expected_at: new Date(Date.now() - 3600000 * 2).toISOString(), arrived_at: new Date(Date.now() - 3600000).toISOString(), created_at: new Date(Date.now() - 3600000 * 3).toISOString() },
  { id: "ex-rcpt-0002bb", status: "Expected", expected_at: new Date(Date.now() + 3600000 * 6).toISOString(), arrived_at: null, created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
  { id: "ex-rcpt-0003cc", status: "Completed", expected_at: new Date(Date.now() - 86400000).toISOString(), arrived_at: new Date(Date.now() - 86400000).toISOString(), created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
];
const SAMPLE_ZONES = [
  { zone: "Receiving dock", count: 8 },
  { zone: "Bulk storage", count: 42 },
  { zone: "Pick faces", count: 96 },
  { zone: "Cold room", count: 14 },
];
const SAMPLE_MOVEMENTS = [
  { id: "ex-mv-1", kind: "receive", quantity: 120, reference_kind: "ASN", created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: "ex-mv-2", kind: "pick", quantity: 18, reference_kind: "Order", created_at: new Date(Date.now() - 3600000 * 2).toISOString() },
  { id: "ex-mv-3", kind: "adjust", quantity: -4, reference_kind: "CycleCount", created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
  { id: "ex-mv-4", kind: "transfer", quantity: 30, reference_kind: "Move", created_at: new Date(Date.now() - 86400000).toISOString() },
];

interface ReceiptRow {
  id: string;
  status: string;
  expected_at: string | null;
  arrived_at: string | null;
  created_at: string;
}

interface StockSummary {
  location_zone: string | null;
  total_on_hand: number | null;
}

function statusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Completed") return "success";
  if (s === "Receiving") return "warning";
  if (s === "Cancelled") return "destructive";
  if (s === "Expected") return "default";
  return "secondary";
}

const STATIONS = [
  { href: "/warehouse/stations/receiving", label: "Receiving", description: "Process inbound ASNs and inventory receipts", emoji: "📥" },
  { href: "/warehouse/stations/picking", label: "Picking", description: "Pick orders for fulfillment waves", emoji: "🧺" },
  { href: "/warehouse/stations/packing", label: "Packing", description: "Pack picked orders for shipment", emoji: "📦" },
  { href: "/warehouse/stations/shipping", label: "Shipping", description: "Ship packed orders and generate labels", emoji: "🚚" },
  { href: "/warehouse/stations/inventory", label: "Inventory", description: "Cycle counts, adjustments and transfers", emoji: "📊" },
  { href: "/warehouse/stations/dock", label: "Dock", description: "Gate events and yard management", emoji: "🏗️" },
];

export default function WarehouseWMSPage() {
  const supabase = getBrowserSupabase();
  const { isExploring } = useExplore();

  const receiptsQ = useQuery({
    queryKey: ["warehouse", "wms", "receipts"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_receipts")
        .select("id,status,expected_at,arrived_at,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as ReceiptRow[];
    },
  });

  const stockQ = useQuery({
    queryKey: ["warehouse", "wms", "stock-summary"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_locations")
        .select("zone")
        .limit(100);
      if (error) throw error;
      // Group by zone
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const z = (row as any).zone ?? "Unzoned";
        counts[z] = (counts[z] ?? 0) + 1;
      }
      return Object.entries(counts).map(([zone, count]) => ({ zone, count }));
    },
  });

  const movementsQ = useQuery({
    queryKey: ["warehouse", "wms", "recent-movements"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id,kind,quantity,reference_kind,created_at")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as { id: string; kind: string; quantity: number; reference_kind: string; created_at: string }[];
    },
  });

  const receipts = isExploring ? SAMPLE_RECEIPTS : (receiptsQ.data ?? []);
  const zones = isExploring ? SAMPLE_ZONES : (stockQ.data ?? []);
  const movements = isExploring ? SAMPLE_MOVEMENTS : (movementsQ.data ?? []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse Management</h1>
        <p className="text-sm text-muted-foreground">
          Overview of WMS operations — inbound, picking, packing, shipping, inventory, and dock.
        </p>
      </div>

      {/* Station launchers */}
      <div>
        <h2 className="text-base font-semibold mb-3">Workstations</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STATIONS.map((s) => (
            <Link key={s.href} href={s.href}>
              <div className="rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer p-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{s.emoji}</span>
                  <span className="font-semibold">{s.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent receipts */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Receipts (ASNs)</CardTitle>
            <CardDescription>Latest inbound inventory receipts</CardDescription>
          </CardHeader>
          <CardContent>
            {!isExploring && receiptsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : receipts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No receipts yet.</p>
            ) : (
              <div className="space-y-2">
                {receipts.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded border px-3 py-2">
                    <div>
                      <p className="text-sm font-mono">{r.id.slice(0, 8)}…</p>
                      <p className="text-xs text-muted-foreground">
                        Expected: {r.expected_at ? formatDate(r.expected_at) : "—"} · Arrived: {r.arrived_at ? formatDate(r.arrived_at) : "—"}
                      </p>
                    </div>
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3">
              <Link href="/warehouse/stations/receiving">
                <Button size="sm" variant="outline">Go to Receiving →</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Zone summary */}
        <Card>
          <CardHeader>
            <CardTitle>Warehouse Zones</CardTitle>
            <CardDescription>Location count by zone</CardDescription>
          </CardHeader>
          <CardContent>
            {!isExploring && stockQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : zones.length === 0 ? (
              <p className="text-sm text-muted-foreground">No zones configured yet.</p>
            ) : (
              <div className="space-y-2">
                {zones.map((z) => (
                  <div key={z.zone} className="flex items-center justify-between rounded border px-3 py-2">
                    <span className="text-sm font-medium">{z.zone}</span>
                    <Badge variant="secondary">{z.count} locations</Badge>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3">
              <Link href="/warehouse/stations/inventory">
                <Button size="sm" variant="outline">Go to Inventory →</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent stock movements */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Stock Movements</CardTitle>
          <CardDescription>Latest ledger entries across all operations</CardDescription>
        </CardHeader>
        <CardContent>
          {!isExploring && movementsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
          ) : (
            <div className="divide-y">
              {movements.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2">
                  <div>
                    <Badge variant="secondary" className="capitalize mr-2">{m.kind}</Badge>
                    <span className="text-xs text-muted-foreground">{m.reference_kind}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">Qty {m.quantity}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
