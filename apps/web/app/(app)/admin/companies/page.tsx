"use client";

import { useState } from "react";
import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

interface CompanyRow {
  id: string;
  name: string;
  type: string;
  status: string;
  created_at: string;
  owner_user_id: string;
}

type PendingAction = {
  company: CompanyRow;
  action: "approve" | "suspend" | "reinstate";
} | null;

const PAGE_SIZE = 100;

function statusVariant(status: string): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "Approved":   return "success";
    case "PendingApproval": return "warning";
    case "Suspended":  return "destructive";
    default:           return "secondary";
  }
}

export default function AdminCompaniesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionReason, setActionReason] = useState("");

  /**
   * Cursor-based infinite query — no hard row ceiling.
   * Pages ordered by created_at DESC; each page starts after the last
   * created_at from the previous page.
   */
  const companiesQuery = useInfiniteQuery({
    queryKey: ["admin", "companies", search],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      let q = supabase
        .from("companies")
        .select("id,name,type,status,created_at,owner_user_id")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (search) q = q.ilike("name", `%${search}%`);
      if (pageParam) q = q.lt("created_at", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CompanyRow[];
    },
    getNextPageParam: (lastPage: CompanyRow[]) =>
      lastPage.length === PAGE_SIZE ? lastPage[lastPage.length - 1].created_at : undefined,
  });

  const allCompanies = companiesQuery.data?.pages.flat() ?? [];

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_set_company_status", {
        p_company_id: input.id,
        p_status: input.status,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      setPendingAction(null);
      setActionReason("");
    },
  });

  function handleAction(company: CompanyRow, action: "approve" | "suspend" | "reinstate") {
    setPendingAction({ company, action });
    setActionReason("");
  }

  function confirmAction() {
    if (!pendingAction || !actionReason.trim()) return;
    const next =
      pendingAction.action === "approve" || pendingAction.action === "reinstate"
        ? "Approved"
        : "Suspended";
    setStatus.mutate({ id: pendingAction.company.id, status: next, reason: actionReason.trim() });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">Approve, suspend, or reinstate tenant companies.</p>
        </div>
        <Input
          className="w-64"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All companies</CardTitle>
          <CardDescription>{allCompanies.length} shown</CardDescription>
        </CardHeader>
        <CardContent>
          {companiesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : companiesQuery.error ? (
            <p className="text-sm text-red-600">{(companiesQuery.error as Error).message}</p>
          ) : allCompanies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No companies yet.</p>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Type</TH>
                    <TH>Status</TH>
                    <TH>Created</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {allCompanies.map((c) => (
                    <TR key={c.id}>
                      <TD className="font-medium">{c.name}</TD>
                      <TD>{c.type}</TD>
                      <TD>
                        <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                      </TD>
                      <TD>{formatDate(c.created_at)}</TD>
                      <TD className="text-right">
                        <ActionButtons
                          status={c.status}
                          onAction={(action) => handleAction(c, action)}
                          disabled={setStatus.isPending}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              {companiesQuery.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => companiesQuery.fetchNextPage()}
                    disabled={companiesQuery.isFetchingNextPage}
                  >
                    {companiesQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Action confirmation modal */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { setPendingAction(null); setActionReason(""); }}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold text-base capitalize">
                {pendingAction.action} company
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-medium text-foreground">{pendingAction.company.name}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="action-reason">Reason (required)</Label>
              <Input
                id="action-reason"
                placeholder="Explain why…"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
              />
            </div>
            {setStatus.error && (
              <p className="text-sm text-red-600">{(setStatus.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setPendingAction(null); setActionReason(""); }}
              >
                Cancel
              </Button>
              <Button
                variant={pendingAction.action === "suspend" ? "destructive" : "default"}
                className="flex-1"
                disabled={!actionReason.trim() || setStatus.isPending}
                onClick={confirmAction}
              >
                {setStatus.isPending ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButtons({
  status,
  onAction,
  disabled,
}: {
  status: string;
  onAction: (a: "approve" | "suspend" | "reinstate") => void;
  disabled: boolean;
}) {
  if (status === "PendingApproval") {
    return (
      <Button size="sm" disabled={disabled} onClick={() => onAction("approve")}>
        Approve
      </Button>
    );
  }
  if (status === "Suspended") {
    return (
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onAction("reinstate")}>
        Reinstate
      </Button>
    );
  }
  return (
    <Button size="sm" variant="destructive" disabled={disabled} onClick={() => onAction("suspend")}>
      Suspend
    </Button>
  );
}
