"use client";

import { useState } from "react";
import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface CertRow {
  id: string;
  worker_user_id: string;
  type: string;
  status: string;
  expiry_date: string | null;
  file_path: string | null;
  notes: string | null;
  created_at: string;
}

const FILTERS = ["Pending", "Approved", "Rejected", "Expired"] as const;

/** Rows per page for cursor-based load-more. */
const PAGE_SIZE = 100;

export default function AdminCertificationsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Pending");
  const [rejectTarget, setRejectTarget] = useState<CertRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [viewError, setViewError] = useState<string | null>(null);

  /**
   * Cursor-based infinite query.
   * Orders by created_at DESC; each page starts after the last row's created_at.
   * Resetting filter changes the queryKey and automatically restarts from page 1.
   */
  const certsQuery = useInfiniteQuery({
    queryKey: ["admin", "certifications", filter],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      let q = supabase
        .from("worker_certifications")
        .select("id, worker_user_id, type, status, expiry_date, file_path, notes, created_at")
        .eq("status", filter)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) {
        q = q.lt("created_at", pageParam);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CertRow[];
    },
    getNextPageParam: (lastPage: CertRow[]) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at ?? undefined;
    },
  });

  const allCerts = certsQuery.data?.pages.flat() ?? [];

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_approve_certification", { p_cert_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "certifications"] }),
  });

  const reject = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_reject_certification", {
        p_cert_id: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "certifications"] }),
  });

  const openSigned = async (path: string | null) => {
    if (!path) return;
    setViewError(null);
    const { data, error } = await supabase.functions.invoke("get-signed-url", {
      body: { bucket: "certifications", path },
    });
    if (error) {
      setViewError(error.message);
      return;
    }
    const url = (data as { signedUrl?: string; url?: string } | null)?.signedUrl
      ?? (data as { url?: string } | null)?.url;
    if (url) window.open(url, "_blank");
    else setViewError("Signed URL not returned — check edge function logs.");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {viewError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{viewError}</span>
          <button onClick={() => setViewError(null)} className="ml-3 text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Worker Certifications</h1>
          <p className="text-sm text-muted-foreground">Approve, reject, and review compliance documents.</p>
        </div>
        <div className="flex gap-1 rounded-md border p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "rounded px-3 py-1 text-sm " +
                (filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{filter} certifications</CardTitle>
          <CardDescription>{allCerts.length} items loaded</CardDescription>
        </CardHeader>
        <CardContent>
          {certsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : allCerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No certifications in this status.</p>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Worker</TH>
                    <TH>Type</TH>
                    <TH>Status</TH>
                    <TH>Expiry</TH>
                    <TH>Submitted</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {allCerts.map((c) => (
                    <TR key={c.id}>
                      <TD className="font-mono text-xs">{c.worker_user_id.slice(0, 8)}</TD>
                      <TD>{c.type}</TD>
                      <TD>
                        <Badge variant={c.status === "Approved" ? "success" : c.status === "Pending" ? "warning" : "destructive"}>
                          {c.status}
                        </Badge>
                      </TD>
                      <TD>{c.expiry_date ?? "—"}</TD>
                      <TD>{formatDate(c.created_at)}</TD>
                      <TD className="space-x-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => openSigned(c.file_path)} disabled={!c.file_path}>
                          View
                        </Button>
                        {c.status === "Pending" && (
                          <>
                            <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(c.id)}>
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={reject.isPending}
                              onClick={() => { setRejectTarget(c); setRejectReason(""); }}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              {/* Load more */}
              {certsQuery.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => certsQuery.fetchNextPage()}
                    disabled={certsQuery.isFetchingNextPage}
                  >
                    {certsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-base">Reject certification</h3>
            <p className="text-sm text-muted-foreground">
              Reject <span className="font-medium">{rejectTarget.type}</span> submitted by worker <span className="font-mono text-xs">{rejectTarget.worker_user_id.slice(0, 8)}</span>?
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="reject-reason">Reason *</label>
              <input
                id="reject-reason"
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm"
                placeholder="e.g. document expired, illegible scan…"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            {reject.error && (
              <p className="text-sm text-red-600">{(reject.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
                onClick={() => setRejectTarget(null)}
              >Cancel</button>
              <button
                className="flex-1 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                disabled={!rejectReason.trim() || reject.isPending}
                onClick={() =>
                  reject.mutate(
                    { id: rejectTarget.id, reason: rejectReason.trim() },
                    { onSuccess: () => setRejectTarget(null) },
                  )
                }
              >
                {reject.isPending ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
