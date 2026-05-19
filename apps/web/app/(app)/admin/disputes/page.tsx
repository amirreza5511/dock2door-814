"use client";

import { useState } from "react";
import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface DisputeRow {
  id: string;
  reference_type: string;
  reference_id: string;
  status: string;
  outcome: string | null;
  description: string;
  admin_notes: string | null;
  created_at: string;
  opener_name?: string | null;
  opener_email?: string | null;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  Resolved: "success",
  Open: "warning",
  UnderReview: "secondary",
};

const OUTCOMES = ["Refund", "PartialRefund", "Denied", "Other"] as const;

/** Rows per page for cursor-based load-more. */
const PAGE_SIZE = 100;

export default function AdminDisputesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<DisputeRow | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState<typeof OUTCOMES[number]>("Denied");

  /**
   * Cursor-based infinite query.
   * Removes the hard 500-row ceiling — each page loads PAGE_SIZE rows and
   * a "Load more" button fetches subsequent pages.
   */
  const disputesQ = useInfiniteQuery({
    queryKey: ["admin", "disputes"],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      let q = supabase
        .from("disputes")
        .select(`id, reference_type, reference_id, status, outcome, description, admin_notes, created_at,
          profiles!opened_by_user_id(name, email)`)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) {
        q = q.lt("created_at", pageParam);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((d: any) => ({
        ...d,
        opener_name: d.profiles?.name ?? null,
        opener_email: d.profiles?.email ?? null,
      })) as DisputeRow[];
    },
    getNextPageParam: (lastPage: DisputeRow[]) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at ?? undefined;
    },
  });

  const allDisputes = disputesQ.data?.pages.flat() ?? [];

  const setStatus = useMutation({
    mutationFn: async ({ id, status, outcome, notes }: { id: string; status: string; outcome?: string; notes: string }) => {
      const { error } = await supabase.rpc("admin_resolve_dispute", {
        p_dispute_id: id,
        p_status: status,
        p_outcome: outcome ?? null,
        p_admin_notes: notes || null,
        p_reason: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "disputes"] });
      setSelected(null);
    },
  });

  const stats = {
    open: allDisputes.filter((d) => d.status === "Open").length,
    underReview: allDisputes.filter((d) => d.status === "UnderReview").length,
    resolved: allDisputes.filter((d) => d.status === "Resolved").length,
    total: allDisputes.length,
  };

  const cols: Column<DisputeRow>[] = [
    {
      key: "opener",
      header: "Opened by",
      render: (d) => (
        <div>
          <div className="font-medium">{d.opener_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{d.opener_email ?? ""}</div>
        </div>
      ),
      sortable: true,
      sortValue: (d) => d.opener_name ?? null,
    },
    {
      key: "ref",
      header: "Reference",
      render: (d) => (
        <div>
          <Badge variant="secondary" className="text-xs">{d.reference_type}</Badge>
          <div className="text-xs text-muted-foreground font-mono mt-1">{d.reference_id.slice(0, 8)}…</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (d) => (
        <div className="space-y-1">
          <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>{d.status}</Badge>
          {d.outcome && <div className="text-xs text-muted-foreground">{d.outcome}</div>}
        </div>
      ),
      sortable: true,
      sortValue: (d) => d.status,
    },
    {
      key: "description",
      header: "Description",
      render: (d) => <p className="text-sm line-clamp-2 max-w-xs">{d.description}</p>,
    },
    {
      key: "created",
      header: "Opened",
      render: (d) => <span className="text-xs text-muted-foreground">{formatDate(d.created_at)}</span>,
      sortable: true,
      sortValue: (d) => d.created_at,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (d) => (
        <Button size="sm" variant="outline"
          onClick={() => { setSelected(d); setAdminNotes(d.admin_notes ?? ""); setSelectedOutcome("Denied"); }}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Disputes</h1>
        <p className="text-sm text-muted-foreground">Review and resolve platform disputes.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Open", value: stats.open },
          { label: "Under review", value: stats.underReview },
          { label: "Resolved", value: stats.resolved },
          { label: "Total loaded", value: stats.total },
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
          <CardTitle>All disputes</CardTitle>
          <CardDescription>{allDisputes.length} loaded</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            rows={allDisputes}
            columns={cols}
            rowKey={(d) => d.id}
            isLoading={disputesQ.isLoading}
            error={disputesQ.error as Error | null}
            searchPlaceholder="Search opener, description…"
            filters={[
              { value: "open", label: "Open", predicate: (d: DisputeRow) => d.status === "Open" },
              { value: "review", label: "Under review", predicate: (d: DisputeRow) => d.status === "UnderReview" },
              { value: "resolved", label: "Resolved", predicate: (d: DisputeRow) => d.status === "Resolved" },
            ]}
            emptyMessage="No disputes filed."
          />

          {/* Load more */}
          {disputesQ.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => disputesQ.fetchNextPage()}
                disabled={disputesQ.isFetchingNextPage}
              >
                {disputesQ.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dispute review modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Dispute review</h2>
                <p className="text-sm text-muted-foreground">{selected.opener_name} · {selected.reference_type}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>✕</Button>
            </div>

            {setStatus.error && (
              <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {(setStatus.error as Error).message}
              </div>
            )}

            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Description</div>
                <p className="text-sm">{selected.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Current status</div>
                  <Badge variant={STATUS_VARIANT[selected.status] ?? "secondary"}>{selected.status}</Badge>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Reference</div>
                  <div className="text-xs font-mono">{selected.reference_id}</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase text-muted-foreground">Outcome</label>
                <div className="flex flex-wrap gap-2">
                  {OUTCOMES.map((o) => (
                    <button key={o}
                      onClick={() => setSelectedOutcome(o)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        selectedOutcome === o
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase text-muted-foreground">Admin notes</label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={3}
                  className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Document your decision and reasoning…"
                />
              </div>

              <div className="space-y-2 pt-2 border-t">
                <div className="flex gap-2">
                  {selected.status !== "UnderReview" && (
                    <Button variant="secondary" className="flex-1" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: selected.id, status: "UnderReview", notes: adminNotes })}>
                      Under review
                    </Button>
                  )}
                  {selected.status !== "Escalated" && (
                    <Button variant="outline" className="flex-1 border-amber-400 text-amber-700 hover:bg-amber-50" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: selected.id, status: "Escalated", notes: adminNotes })}>
                      ↑ Escalate
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 border-blue-400 text-blue-700 hover:bg-blue-50" disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: selected.id, status: "Resolved", outcome: "Refund", notes: adminNotes ? adminNotes : "Rule in favour of customer" })}>
                    Rule for Customer
                  </Button>
                  <Button variant="outline" className="flex-1 border-violet-400 text-violet-700 hover:bg-violet-50" disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: selected.id, status: "Resolved", outcome: "Denied", notes: adminNotes ? adminNotes : "Rule in favour of provider" })}>
                    Rule for Provider
                  </Button>
                </div>
                <Button className="w-full" disabled={setStatus.isPending || !adminNotes}
                  onClick={() => setStatus.mutate({ id: selected.id, status: "Resolved", outcome: selectedOutcome, notes: adminNotes })}>
                  {setStatus.isPending ? "Resolving…" : "Resolve with selected outcome"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
