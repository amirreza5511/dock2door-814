"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TableStat {
  name: string;
  count: number | null;
  description: string;
  category: string;
}

const TABLE_DEFINITIONS: Omit<TableStat, "count">[] = [
  // Identity
  { name: "profiles", description: "User profiles (1:1 with auth.users)", category: "Identity" },
  { name: "user_roles", description: "Platform-level roles (admin, support)", category: "Identity" },
  { name: "companies", description: "All registered companies", category: "Identity" },
  { name: "company_users", description: "Company membership links", category: "Identity" },
  // Warehouse
  { name: "warehouse_listings", description: "Warehouse listings", category: "Warehouse" },
  { name: "warehouse_bookings", description: "Warehouse booking requests", category: "Warehouse" },
  { name: "warehouse_locations", description: "WMS storage locations", category: "Warehouse" },
  { name: "inventory_receipts", description: "ASN / inbound receipts", category: "Warehouse" },
  { name: "stock_movements", description: "Inventory ledger (append-only)", category: "Warehouse" },
  // Labour
  { name: "shift_posts", description: "Job shift postings", category: "Labour" },
  { name: "shift_assignments", description: "Worker shift assignments", category: "Labour" },
  { name: "shift_applications", description: "Worker shift applications", category: "Labour" },
  { name: "time_entries", description: "Clock-in/out time entries", category: "Labour" },
  { name: "worker_profiles", description: "Extended worker profiles", category: "Labour" },
  { name: "worker_certifications", description: "Worker certifications", category: "Labour" },
  // Finance
  { name: "invoices", description: "Invoices", category: "Finance" },
  { name: "invoice_lines", description: "Invoice line items", category: "Finance" },
  { name: "payments", description: "Payment records", category: "Finance" },
  { name: "refunds", description: "Refund records", category: "Finance" },
  { name: "payouts", description: "Provider payout records", category: "Finance" },
  // Shipping
  { name: "shipments", description: "Outbound shipments", category: "Shipping" },
  { name: "carrier_accounts", description: "Carrier account integrations", category: "Shipping" },
  { name: "return_authorizations", description: "RMA / return authorizations", category: "Shipping" },
  { name: "tracking_events", description: "Carrier tracking events", category: "Shipping" },
  // Services
  { name: "service_listings", description: "Service provider listings", category: "Services" },
  { name: "service_jobs", description: "Service job requests", category: "Services" },
  // Platform
  { name: "audit_logs", description: "Admin audit log (immutable)", category: "Platform" },
  { name: "disputes", description: "Dispute records", category: "Platform" },
  { name: "reviews", description: "Reviews & ratings", category: "Platform" },
  { name: "notifications", description: "User notifications", category: "Platform" },
  { name: "platform_settings", description: "Platform configuration KV", category: "Platform" },
  { name: "sales_channels", description: "Sales channel definitions", category: "Sales Channels" },
  { name: "channel_orders", description: "Imported channel orders", category: "Sales Channels" },
];

const CATEGORY_COLORS: Record<string, string> = {
  Identity: "bg-blue-50 text-blue-700 border-blue-200",
  Warehouse: "bg-green-50 text-green-700 border-green-200",
  Labour: "bg-purple-50 text-purple-700 border-purple-200",
  Finance: "bg-amber-50 text-amber-700 border-amber-200",
  Shipping: "bg-cyan-50 text-cyan-700 border-cyan-200",
  Services: "bg-orange-50 text-orange-700 border-orange-200",
  Platform: "bg-slate-50 text-slate-700 border-slate-200",
  "Sales Channels": "bg-pink-50 text-pink-700 border-pink-200",
};

export default function SuperAdminDataManagerPage() {
  const supabase = getBrowserSupabase();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const categories = Array.from(new Set(TABLE_DEFINITIONS.map((t) => t.category)));

  const countsQ = useQuery({
    queryKey: ["super-admin", "data-manager", "counts"],
    queryFn: async () => {
      const results: Record<string, number | null> = {};
      await Promise.all(
        TABLE_DEFINITIONS.map(async (t) => {
          try {
            const { count } = await supabase
              .from(t.name as any)
              .select("*", { count: "exact", head: true });
            results[t.name] = count;
          } catch {
            results[t.name] = null;
          }
        })
      );
      return results;
    },
  });

  const handlePreview = async (tableName: string) => {
    setSelectedTable(tableName);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewRows([]);
    try {
      const { data, error } = await supabase
        .from(tableName as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      setPreviewRows(data ?? []);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load rows");
    } finally {
      setPreviewLoading(false);
    }
  };

  const filteredTables = selectedCategory
    ? TABLE_DEFINITIONS.filter((t) => t.category === selectedCategory)
    : TABLE_DEFINITIONS;

  const counts = countsQ.data ?? {};

  const totalRows = Object.values(counts).reduce<number>((s, v) => s + (v ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data Manager</h1>
        <p className="text-sm text-muted-foreground">
          Safe read-only overview of all platform tables. All mutations must go through audited RPCs.
        </p>
      </div>

      {/* Warning banner */}
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>⚠ Admin data view.</strong> This page is read-only. All data changes must use audited
        admin RPCs (e.g. <code className="font-mono text-xs">admin_set_user_status</code>,{" "}
        <code className="font-mono text-xs">admin_set_company_status</code>). Direct SQL edits
        without audit logging are prohibited.
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tables monitored</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{TABLE_DEFINITIONS.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total rows (approx.)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {countsQ.isLoading ? "…" : totalRows.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Categories</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{categories.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tables with data</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {countsQ.isLoading
                ? "…"
                : Object.values(counts).filter((v) => (v ?? 0) > 0).length}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Table list */}
        <div className="lg:col-span-2 space-y-4">
          {/* Category filter */}
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant={selectedCategory === null ? "default" : "outline"}
              onClick={() => setSelectedCategory(null)}
            >
              All
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat}
                size="sm"
                variant={selectedCategory === cat ? "default" : "outline"}
                onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
              >
                {cat}
              </Button>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tables</CardTitle>
              <CardDescription>
                {filteredTables.length} table{filteredTables.length !== 1 ? "s" : ""}
                {selectedCategory ? ` in ${selectedCategory}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {filteredTables.map((table) => (
                  <div
                    key={table.name}
                    className={`flex items-center justify-between py-3 cursor-pointer hover:bg-accent/30 -mx-2 px-2 rounded transition-colors ${
                      selectedTable === table.name ? "bg-accent/50" : ""
                    }`}
                    onClick={() => handlePreview(table.name)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold">{table.name}</span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded border ${
                            CATEGORY_COLORS[table.category] ?? "bg-muted"
                          }`}
                        >
                          {table.category}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{table.description}</p>
                    </div>
                    <div className="ml-4 shrink-0">
                      {countsQ.isLoading ? (
                        <span className="text-xs text-muted-foreground">…</span>
                      ) : (
                        <Badge variant={counts[table.name] ? "secondary" : "outline"}>
                          {counts[table.name]?.toLocaleString() ?? "N/A"} rows
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview panel */}
        <div>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="font-mono text-base">
                {selectedTable ?? "Select a table"}
              </CardTitle>
              <CardDescription>
                {selectedTable ? "Last 20 rows (read-only preview)" : "Click a table to preview"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedTable ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Select a table from the list to see a row preview.
                </p>
              ) : previewLoading ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
              ) : previewError ? (
                <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {previewError}
                </div>
              ) : previewRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No rows found.</p>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {previewRows.map((row, i) => (
                    <div key={i} className="rounded border bg-muted/50 p-2 text-xs font-mono break-all">
                      {Object.entries(row)
                        .slice(0, 6)
                        .map(([k, v]) => (
                          <div key={k} className="flex gap-1">
                            <span className="text-muted-foreground shrink-0">{k}:</span>
                            <span className="truncate">
                              {v === null ? (
                                <em className="text-muted-foreground">null</em>
                              ) : typeof v === "object" ? (
                                JSON.stringify(v).slice(0, 60)
                              ) : (
                                String(v).slice(0, 60)
                              )}
                            </span>
                          </div>
                        ))}
                      {Object.keys(row).length > 6 && (
                        <p className="text-muted-foreground mt-1">
                          +{Object.keys(row).length - 6} more columns
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
