"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

// ── Real schema columns from warehouse_bookings (0001 + 0004) ──────────────
// Columns: proposed_price, counter_offer_price, final_price  (NO total_amount)
// Status enum: Requested | CounterOffered | Accepted | Confirmed |
//              InProgress | Completed | Cancelled
interface BookingRow {
  id: string;
  status: string;
  customer_company_id: string;
  warehouse_company_id: string;
  listing_id: string | null;
  start_date: string | null;
  end_date: string | null;
  proposed_price: number | null;
  counter_offer_price: number | null;
  final_price: number | null;
  created_at: string;
}

// Transitions available to warehouse-side users
// Keys must exactly match booking_status enum values.
const TRANSITIONS: Record<string, { label: string; next: string; variant?: "default" | "destructive" | "secondary" }[]> = {
  Requested: [
    { label: "Accept",   next: "Accepted" },
    { label: "Counter",  next: "CounterOffered", variant: "secondary" },
    { label: "Decline",  next: "Cancelled",      variant: "destructive" },
  ],
  // Warehouse can confirm once both sides agreed
  CounterOffered: [
    { label: "Accept",  next: "Accepted" },
    { label: "Decline", next: "Cancelled", variant: "destructive" },
  ],
  Accepted: [
    { label: "Confirm", next: "Confirmed" },
  ],
  Confirmed: [
    { label: "Start", next: "InProgress" },
  ],
  InProgress: [
    { label: "Complete", next: "Completed" },
  ],
};

export default function WarehouseBookingsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const bookingsQuery = useQuery({
    queryKey: ["warehouse", "bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_bookings")
        .select(
          "id,status,customer_company_id,warehouse_company_id,listing_id,start_date,end_date,proposed_price,counter_offer_price,final_price,created_at"
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as BookingRow[];
    },
  });

  const transition = useMutation({
    mutationFn: async (input: { id: string; next: string; reason?: string; counterPrice?: number }) => {
      const { error } = await supabase.rpc("transition_booking", {
        p_booking_id: input.id,
        p_next_status: input.next,
        p_reason: input.reason ?? null,
        p_counter_offer_price: input.counterPrice ?? null,
        p_response_notes: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouse", "bookings"] }),
  });

  /** Best display price: final → counter-offer → proposed. */
  function displayPrice(b: BookingRow): string {
    const v = b.final_price ?? b.counter_offer_price ?? b.proposed_price;
    return v != null ? `$${Number(v).toFixed(2)}` : "—";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Booking requests</h1>
        <p className="text-sm text-muted-foreground">
          Accept, counter, confirm, start, or complete bookings.
        </p>
      </div>

      {transition.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(transition.error as Error).message}
        </div>
      )}

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
                  <TH>Price</TH>
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
                    <TD className="text-sm">{displayPrice(b)}</TD>
                    <TD>{formatDate(b.created_at)}</TD>
                    <TD className="space-x-2 text-right">
                      {(TRANSITIONS[b.status] ?? []).map((t) => (
                        <Button
                          key={t.label}
                          size="sm"
                          variant={t.variant ?? "default"}
                          disabled={transition.isPending}
                          onClick={() => {
                            if (t.next === "Cancelled") {
                              const reason = window.prompt("Reason for declining?") ?? undefined;
                              if (!reason) return;
                              transition.mutate({ id: b.id, next: t.next, reason });
                            } else if (t.next === "CounterOffered") {
                              const priceStr = window.prompt("Counter-offer price ($):");
                              if (!priceStr) return;
                              const counterPrice = parseFloat(priceStr);
                              if (isNaN(counterPrice) || counterPrice <= 0) return;
                              const reason = window.prompt("Message to customer (optional):") ?? undefined;
                              transition.mutate({ id: b.id, next: t.next, counterPrice, reason });
                            } else {
                              transition.mutate({ id: b.id, next: t.next });
                            }
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
  if (s === "Accepted" || s === "InProgress" || s === "Confirmed") return "default";
  if (s === "Requested" || s === "CounterOffered") return "warning";
  if (s === "Cancelled") return "destructive";
  return "secondary";
}
