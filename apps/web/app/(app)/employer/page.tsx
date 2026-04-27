"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface ShiftRow {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  hourly_rate: number | null;
  required_certification: string | null;
  created_at: string;
}

export default function EmployerShiftsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["employer", "shifts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("id,title,status,start_at,end_at,hourly_rate,required_certification,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase.rpc("employer_set_shift_status", {
        p_shift_id: input.id,
        p_status: input.status,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employer", "shifts"] }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
      <Card>
        <CardHeader>
          <CardTitle>Posted shifts</CardTitle>
          <CardDescription>{q.data?.length ?? 0} shifts</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (q.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No shifts yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Status</TH>
                  <TH>Window</TH>
                  <TH>Rate</TH>
                  <TH>Cert</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(q.data ?? []).map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium">{s.title}</TD>
                    <TD>
                      <Badge>{s.status}</Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">
                      {formatDate(s.start_at)} → {formatDate(s.end_at)}
                    </TD>
                    <TD>{s.hourly_rate != null ? `$${Number(s.hourly_rate).toFixed(2)}/hr` : "—"}</TD>
                    <TD>{s.required_certification ?? "—"}</TD>
                    <TD className="space-x-2 text-right">
                      {s.status !== "Closed" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: s.id, status: "Closed" })}
                        >
                          Close
                        </Button>
                      )}
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
