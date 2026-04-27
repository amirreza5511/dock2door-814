"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface JobRow {
  id: string;
  status: string;
  service_id: string | null;
  customer_company_id: string;
  provider_company_id: string;
  scheduled_date: string | null;
  total_amount: number | null;
  created_at: string;
}

const NEXT: Record<string, { label: string; next: string; reasonRequired?: boolean }[]> = {
  Requested: [
    { label: "Accept", next: "Accepted" },
    { label: "Decline", next: "Declined", reasonRequired: true },
  ],
  Accepted: [{ label: "Check in", next: "InProgress" }],
  InProgress: [{ label: "Complete", next: "Completed" }],
};

export default function ServiceProviderJobsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ["sp", "jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_jobs")
        .select("id,status,service_id,customer_company_id,provider_company_id,scheduled_date,total_amount,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as JobRow[];
    },
  });

  const transition = useMutation({
    mutationFn: async (input: { id: string; next: string; reason?: string }) => {
      const { error } = await supabase.rpc("transition_service_job", {
        p_job_id: input.id,
        p_next_status: input.next,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sp", "jobs"] }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Service jobs</h1>
        <p className="text-sm text-muted-foreground">Accept, decline, check-in, and complete service jobs.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>{jobsQuery.data?.length ?? 0} jobs</CardDescription>
        </CardHeader>
        <CardContent>
          {jobsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (jobsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Job</TH>
                  <TH>Status</TH>
                  <TH>Scheduled</TH>
                  <TH>Total</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(jobsQuery.data ?? []).map((j) => (
                  <TR key={j.id}>
                    <TD className="font-mono text-xs">{j.id.slice(0, 8)}</TD>
                    <TD>
                      <Badge>{j.status}</Badge>
                    </TD>
                    <TD>{j.scheduled_date ?? "—"}</TD>
                    <TD>{j.total_amount != null ? `$${Number(j.total_amount).toFixed(2)}` : "—"}</TD>
                    <TD>{formatDate(j.created_at)}</TD>
                    <TD className="space-x-2 text-right">
                      {(NEXT[j.status] ?? []).map((t) => (
                        <Button
                          key={t.label}
                          size="sm"
                          disabled={transition.isPending}
                          onClick={() => {
                            const reason = t.reasonRequired ? window.prompt("Reason?") ?? undefined : undefined;
                            if (t.reasonRequired && !reason) return;
                            transition.mutate({ id: j.id, next: t.next, reason });
                          }}
                        >
                          {t.label}
                        </Button>
                      ))}
                    </TD>
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
