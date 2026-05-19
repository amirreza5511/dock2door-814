"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  reason: string | null;
  created_at: string;
}

/** Rows per page for cursor-based load-more. */
const PAGE_SIZE = 100;

export default function AuditPage() {
  const supabase = getBrowserSupabase();

  /**
   * Cursor-based infinite query — removes the 200-row ceiling.
   * Each page fetches the next PAGE_SIZE rows after the last row's created_at.
   */
  const q = useInfiniteQuery({
    queryKey: ["admin", "audit"],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      let query = supabase
        .from("audit_logs")
        .select("id, actor_user_id, action, entity_type, entity_id, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) {
        query = query.lt("created_at", pageParam);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    getNextPageParam: (lastPage: AuditRow[]) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at ?? undefined;
    },
  });

  const allRows = q.data?.pages.flat() ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">
          {allRows.length} entries loaded — all platform admin actions.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>{allRows.length} entries</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : q.error ? (
            <p className="text-sm text-red-600">{(q.error as Error).message}</p>
          ) : allRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries yet.</p>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Actor</TH>
                    <TH>Action</TH>
                    <TH>Entity</TH>
                    <TH>Reason</TH>
                    <TH>Time</TH>
                  </TR>
                </THead>
                <TBody>
                  {allRows.map((row) => (
                    <TR key={row.id}>
                      <TD className="font-mono text-xs">
                        {row.actor_user_id ? row.actor_user_id.slice(0, 8) : "—"}
                      </TD>
                      <TD className="font-medium text-sm">{row.action}</TD>
                      <TD className="text-xs text-muted-foreground">
                        {row.entity_type ?? "—"}
                        {row.entity_id && (
                          <span className="ml-1 font-mono">{row.entity_id.slice(0, 8)}</span>
                        )}
                      </TD>
                      <TD className="text-xs text-muted-foreground max-w-xs truncate">
                        {row.reason ?? "—"}
                      </TD>
                      <TD className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(row.created_at)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              {/* Load more */}
              {q.hasNextPage && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => q.fetchNextPage()}
                    disabled={q.isFetchingNextPage}
                  >
                    {q.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
