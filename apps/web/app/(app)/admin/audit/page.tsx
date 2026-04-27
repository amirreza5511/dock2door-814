"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
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

export default function AuditPage() {
  const supabase = getBrowserSupabase();
  const q = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, actor_user_id, action, entity_type, entity_id, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">Last 200 platform admin actions.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>{q.data?.length ?? 0} entries</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : q.error ? (
            <p className="text-sm text-red-600">{(q.error as Error).message}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Reason</TH>
                </TR>
              </THead>
              <TBody>
                {(q.data ?? []).map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap">{formatDate(row.created_at)}</TD>
                    <TD className="font-mono text-xs">{row.actor_user_id?.slice(0, 8) ?? "system"}</TD>
                    <TD>{row.action}</TD>
                    <TD className="font-mono text-xs">
                      {row.entity_type}
                      {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}
                    </TD>
                    <TD className="text-muted-foreground">{row.reason ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
