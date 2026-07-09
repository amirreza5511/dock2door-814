"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface LotRow {
  id: string;
  sku: string | null;
  product_name: string | null;
  lot_number: string | null;
  expiry_date: string | null;
  unit_weight_kg: number | null;
  unit_volume_m3: number | null;
  created_at: string;
  warehouse_name?: string | null;
  total_on_hand?: number | null;
}

interface MovementRow {
  id: string;
  kind: string;
  quantity: number;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
  product_name?: string | null;
  sku?: string | null;
}

const MOVEMENT_VARIANT: Record<string, string> = {
  receive: "bg-emerald-100 text-emerald-800",
  ship: "bg-red-100 text-red-800",
  adjust: "bg-amber-100 text-amber-800",
  transfer: "bg-blue-100 text-blue-800",
  return: "bg-purple-100 text-purple-800",
  pick: "bg-orange-100 text-orange-800",
  pack: "bg-slate-100 text-slate-700",
};

export default function CustomerInventoryPage() {
  const supabase = getBrowserSupabase();

  const lotsQ = useQuery({
    queryKey: ["customer", "inventory", "lots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_lots")
        .select(`id, sku, product_name, lot_number, expiry_date, unit_weight_kg, unit_volume_m3, created_at,
          stock_levels(on_hand, warehouse_locations(warehouse_listings(name)))`)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((l: any) => ({
        ...l,
        warehouse_name: l.stock_levels?.[0]?.warehouse_locations?.warehouse_listings?.name ?? null,
        total_on_hand: l.stock_levels?.reduce((sum: number, s: any) => sum + (s.on_hand ?? 0), 0) ?? 0,
      })) as LotRow[];
    },
  });

  const movementsQ = useQuery({
    queryKey: ["customer", "inventory", "movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select(`id, kind, quantity, reference_id, notes, created_at,
          inventory_lots(product_name, sku)`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((m: any) => ({
        ...m,
        product_name: m.inventory_lots?.product_name ?? null,
        sku: m.inventory_lots?.sku ?? null,
      })) as MovementRow[];
    },
  });

  const lotCols: Column<LotRow>[] = [
    {
      key: "product",
      header: "Product",
      render: (l) => (
        <div>
          <div className="font-medium">{l.product_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{l.sku ?? "No SKU"}</div>
        </div>
      ),
      sortable: true,
      sortValue: (l) => l.product_name,
    },
    {
      key: "lot",
      header: "Lot #",
      render: (l) => l.lot_number ?? "—",
    },
    {
      key: "on_hand",
      header: "On hand",
      render: (l) => (
        <span className={`font-medium ${(l.total_on_hand ?? 0) === 0 ? "text-red-600" : ""}`}>
          {l.total_on_hand ?? 0} units
        </span>
      ),
      sortable: true,
      sortValue: (l) => l.total_on_hand,
    },
    {
      key: "warehouse",
      header: "Location",
      render: (l) => l.warehouse_name ?? "—",
    },
    {
      key: "expiry",
      header: "Expiry",
      render: (l) => l.expiry_date ? (
        <span className={new Date(l.expiry_date) < new Date() ? "text-red-600 font-medium" : ""}>
          {l.expiry_date}
        </span>
      ) : "—",
      sortable: true,
      sortValue: (l) => l.expiry_date,
    },
    {
      key: "created",
      header: "Added",
      render: (l) => <span className="text-xs text-muted-foreground">{formatDate(l.created_at)}</span>,
      sortable: true,
      sortValue: (l) => l.created_at,
    },
  ];

  const movCols: Column<MovementRow>[] = [
    {
      key: "product",
      header: "Product",
      render: (m) => (
        <div>
          <div className="font-medium">{m.product_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{m.sku ?? ""}</div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Movement",
      render: (m) => (
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${MOVEMENT_VARIANT[m.kind] ?? "bg-muted text-muted-foreground"}`}>
          {m.kind}
        </span>
      ),
    },
    {
      key: "qty",
      header: "Qty",
      render: (m) => (
        <span className={`font-medium ${["ship","pick"].includes(m.kind) ? "text-red-600" : "text-emerald-700"}`}>
          {["ship","pick"].includes(m.kind) ? "-" : "+"}{m.quantity}
        </span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      render: (m) => m.notes ?? "—",
    },
    {
      key: "date",
      header: "Date",
      render: (m) => <span className="text-xs text-muted-foreground">{formatDate(m.created_at)}</span>,
      sortable: true,
      sortValue: (m) => m.created_at,
    },
  ];

  const totalUnits = (lotsQ.data ?? []).reduce((sum, l) => sum + (l.total_on_hand ?? 0), 0);
  const skuCount = new Set((lotsQ.data ?? []).map((l) => l.sku).filter(Boolean)).size;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">Track your stock levels and movements across all warehouses.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Total units on hand", value: totalUnits },
          { label: "SKUs", value: skuCount },
          { label: "Recent movements", value: movementsQ.data?.length ?? 0 },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory lots</CardTitle>
          <CardDescription>All products across your warehouses.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={lotsQ.data ?? []}
            columns={lotCols}
            rowKey={(l) => l.id}
            isLoading={lotsQ.isLoading}
            error={lotsQ.error as Error | null}
            searchPlaceholder="Search product or SKU…"
            filters={[
              { value: "in_stock", label: "In stock", predicate: (l) => (l.total_on_hand ?? 0) > 0 },
              { value: "out_of_stock", label: "Out of stock", predicate: (l) => (l.total_on_hand ?? 0) === 0 },
            ]}
            emptyMessage="No inventory records found."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock movements</CardTitle>
          <CardDescription>Recent inventory activity.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={movementsQ.data ?? []}
            columns={movCols}
            rowKey={(m) => m.id}
            isLoading={movementsQ.isLoading}
            error={movementsQ.error as Error | null}
            searchPlaceholder="Search product…"
            filters={[
              { value: "inbound", label: "Inbound", predicate: (m) => ["receive","return","adjust"].includes(m.kind) },
              { value: "outbound", label: "Outbound", predicate: (m) => ["ship","pick"].includes(m.kind) },
            ]}
            emptyMessage="No stock movements found."
          />
        </CardContent>
      </Card>
    </div>
  );
}
