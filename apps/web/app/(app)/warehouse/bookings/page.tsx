"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface BookingRow {
  id: string;
  status: string;
  customer_company_id: string;
  warehouse_company_id: string;
  listing_id: string | null;
  start_date: string | null;
  end_date: string | null;
  total_amount: number | null;
  created_at: string;
}

const TRANSITIONS: Record<string, { label: string; next: string; variant?: "default" | "destructive" | "secondary" }[]> = {
  Requested: [
    { label: "Accept", next: "Accepted" },
    { label: "Counter", next: "Countered", variant: "secondary" },
    { label: "Decline", next: "Declined", variant: "destructive" },
  ],
  Countered: [
    { label: "Accept", next: "Accepted" },
    { label: "Decline", next: "Declined", variant: "destructive" },
  ],
  Accepted: [{ label: "Start", next: "InProgress" }],
  InProgress: [{ label: "Complete", next: "Completed" }],
};

export default function WarehouseBookingsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const bookingsQuery = useQuery({
    queryKey: ["warehouse", "bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_bookings")
        .select("id,status,customer_company_id,warehouse_company_id,listing_id,start_date,end_date,total_amount,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as BookingRow[];
    },
  });

  const transition = useMutation({
    mutationFn: async (input: { id: string; next: string; reason?: string }) => {
      const { error } = await supabase.rpc("transition_booking", {
        p_booking_id: input.id,
        p_next_status: input.next,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouse", "bookings"] }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Booking requests</h1>
        <p className="text-sm text-muted-foreground">Accept, counter, decline, start, or complete bookings.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All bookings</CardTitle>
          <CardDescription>{bookingsQuery.data?.length ?? 0} total</CardDescription>
        </CardHeader>
        <CardContent>
          {bookingsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (bookingsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookings yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Booking</TH>
                  <TH>Status</TH>
                  <TH>Period</TH>
                  <TH>Amount</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(bookingsQuery.data ?? []).map((b) => (
                  <TR key={b.id}>
                    <TD className="font-mono text-xs">{b.id.slice(0, 8)}</TD>
                    <TD>
                      <Badge variant={statusVariant(b.status)}>{b.status}</Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">
                      {b.start_date ?? "—"} → {b.end_date ?? "—"}
                    </TD>
                    <TD>{b.total_amount != null ? `$${Number(b.total_amount).toFixed(2)}` : "—"}</TD>
                    <TD>{formatDate(b.created_at)}</TD>
                    <TD className="space-x-2 text-right">
                      {(TRANSITIONS[b.status] ?? []).map((t) => (
                        <Button
                          key={t.label}
                          size="sm"
                          variant={t.variant ?? "default"}
                          disabled={transition.isPending}
                          onClick={() => {
                            const reason =
                              t.next === "Declined"
                                ? window.prompt("Reason for decline?") ?? undefined
                                : undefined;
                            if (t.next === "Declined" && !reason) return;
                            transition.mutate({ id: b.id, next: t.next, reason });
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

function statusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Completed") return "success";
  if (s === "Accepted" || s === "InProgress") return "default";
  if (s === "Requested" || s === "Countered") return "warning";
  if (s === "Declined" || s === "Cancelled") return "destructive";
  return "secondary";
}
