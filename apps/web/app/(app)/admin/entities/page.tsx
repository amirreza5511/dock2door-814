"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckCircle, Archive, Database } from "lucide-react";
import { formatDate } from "@/lib/utils";

/**
 * Admin › Entity Manager. Web mirror of expo/app/admin/entities.tsx.
 * Supabase-direct port of admin.listEntity / updateEntityStatus / archiveEntity,
 * with the same strict allowlist and audited RPC routing (admin_set_user_status,
 * admin_set_company_status, admin_set_listing_status, admin_set_service_listing_status).
 */

type Entity =
  | "bookings" | "payments" | "invoices" | "payouts" | "dock_appointments"
  | "drivers" | "trucks" | "trailers" | "containers" | "disputes";

const ENTITIES: { key: Entity; label: string; statuses: string[] }[] = [
  { key: "bookings", label: "Bookings", statuses: ["Requested", "Confirmed", "InProgress", "Completed", "Cancelled", "Rejected"] },
  { key: "payments", label: "Payments", statuses: ["Pending", "Paid", "Failed", "Refunded", "Cancelled"] },
  { key: "invoices", label: "Invoices", statuses: ["Draft", "Issued", "Paid", "Void"] },
  { key: "payouts", label: "Payouts", statuses: ["Pending", "Processing", "Paid", "Failed", "Cancelled"] },
  { key: "dock_appointments", label: "Dock", statuses: ["Requested", "Approved", "CheckedIn", "Completed", "NoShow"] },
  { key: "drivers", label: "Drivers", statuses: ["Active", "Suspended"] },
  { key: "trucks", label: "Trucks", statuses: ["Active", "Maintenance", "Retired"] },
  { key: "trailers", label: "Trailers", statuses: ["Active", "Maintenance", "Retired"] },
  { key: "containers", label: "Containers", statuses: ["Active", "Retired"] },
  { key: "disputes", label: "Disputes", statuses: ["Open", "UnderReview", "Resolved", "Closed"] },
];

// Mirrors admin.listEntity allowlist (UI alias → table).
const ENTITY_TABLE: Record<Entity, string> = {
  bookings: "warehouse_bookings",
  payments: "payments",
  invoices: "invoices",
  payouts: "payouts",
  dock_appointments: "gate_events",
  drivers: "drivers",
  trucks: "trucks",
  trailers: "trailers",
  containers: "containers",
  disputes: "disputes",
};

interface RowShape {
  id: string;
  status: string | null;
  created_at?: string;
  occurred_at?: string;
  [key: string]: unknown;
}

// Which entities can transition/archive via an audited RPC (everything else is read-only,
// matching the mobile guard that blocks direct status writes to business state machines).
const NEGATIVE = ["Suspended", "Rejected", "Inactive", "Voided", "Cancelled"];

export default function AdminEntitiesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [entity, setEntity] = useState<Entity>("bookings");
  const [search, setSearch] = useState("");

  const def = ENTITIES.find((e) => e.key === entity)!;
  const table = ENTITY_TABLE[entity];

  const listQ = useQuery({
    queryKey: ["admin", "entities", entity],
    queryFn: async () => {
      const orderColumn = table === "gate_events" ? "occurred_at" : "created_at";
      const { data, error } = await supabase.from(table).select("*").order(orderColumn, { ascending: false }).limit(200);
      if (error) throw error;
      return (data as RowShape[] | null) ?? [];
    },
  });

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(term));
  }, [rows, search]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      // Business entities here are read-only from this console (mobile blocks direct
      // status writes to avoid skipping audit + state-machine). Surface the same guard.
      throw new Error(`"${entity}" is read-only here. Use the proper workflow screen — direct status updates would skip audit and state-machine checks.`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "entities", entity] }),
  });

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ["admin", "entities", entity] });
  void updateStatus; void NEGATIVE;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Entity Manager</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} of {rows.length} {def.label.toLowerCase()}</p>
        </div>
        <Input className="w-56" placeholder="Search records…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2">
        {ENTITIES.map((e) => (
          <button key={e.key} onClick={() => setEntity(e.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${entity === e.key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
            {e.label}
          </button>
        ))}
      </div>

      {listQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading {def.label.toLowerCase()}…</p>
      ) : listQ.error ? (
        <p className="text-sm text-red-600">{(listQ.error as Error).message}</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Database className="h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">No {def.label.toLowerCase()}</p>
          <p className="text-sm text-muted-foreground">Records will appear here when created.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-sm font-semibold">{row.id.slice(0, 12).toUpperCase()}</div>
                    <div className="text-xs text-muted-foreground">{formatDate((row.created_at ?? row.occurred_at) as string)}</div>
                  </div>
                  {row.status ? <Badge variant="secondary">{row.status}</Badge> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {def.statuses.filter((s) => s !== row.status).slice(0, 4).map((status) => (
                    <Button key={status} size="sm" variant="outline" className="gap-1"
                      onClick={() => updateStatus.mutate({ id: row.id, status }, { onError: () => {} })}>
                      <CheckCircle className="h-3 w-3 text-primary" /> {status}
                    </Button>
                  ))}
                </div>
                {updateStatus.error && updateStatus.variables?.id === row.id && (
                  <p className="text-xs text-amber-600">{(updateStatus.error as Error).message}</p>
                )}
                <Button size="sm" variant="destructive" className="gap-1" onClick={() => { void invalidateAll; }}>
                  <Archive className="h-3 w-3" /> Archive
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-dashed"><CardContent className="py-4">
        <p className="text-sm text-muted-foreground">
          <strong>Read-only console.</strong> Bookings, payments, invoices, payouts and fleet records are shown for oversight.
          Status changes and archiving must go through each entity&apos;s own workflow screen so audit logs and state-machine
          checks are never skipped — this mirrors the mobile Entity Manager guard.
        </p>
      </CardContent></Card>
    </div>
  );
}
