"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const whDate = (d: number): string => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const whCreated = (h: number): string => new Date(Date.now() + h * 3600e3).toISOString();
const SAMPLE_WH_BOOKINGS: BookingRow[] = [
  { id: "ex-whb-1a2b3c4d", status: "Requested", customer_company_id: "explore-company", warehouse_company_id: "ex-co-2", listing_id: "ex-wl-1", start_date: whDate(2), end_date: whDate(32), proposed_price: 1044, counter_offer_price: null, final_price: null, created_at: whCreated(-18) },
  { id: "ex-whb-2b3c4d5e", status: "Confirmed", customer_company_id: "explore-company", warehouse_company_id: "ex-co-2", listing_id: "ex-wl-2", start_date: whDate(-5), end_date: whDate(25), proposed_price: 1280, counter_offer_price: null, final_price: 1280, created_at: whCreated(-140) },
  { id: "ex-whb-3c4d5e6f", status: "InProgress", customer_company_id: "ex-co-3", warehouse_company_id: "ex-co-2", listing_id: "ex-wl-3", start_date: whDate(-12), end_date: whDate(18), proposed_price: 2100, counter_offer_price: null, final_price: 2100, created_at: whCreated(-300) },
  { id: "ex-whb-4d5e6f70", status: "Completed", customer_company_id: "ex-co-3", warehouse_company_id: "ex-co-2", listing_id: "ex-wl-1", start_date: whDate(-40), end_date: whDate(-2), proposed_price: 2700, counter_offer_price: null, final_price: 2700, created_at: whCreated(-760) },
];

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

// Transitions available to warehouse-side users.
// Keys must exactly match booking_status enum values.
const TRANSITIONS: Record<string, { label: string; next: string; variant?: "default" | "destructive" | "secondary" }[]> = {
  Requested: [
    { label: "Accept",   next: "Accepted" },
    { label: "Counter",  next: "CounterOffered", variant: "secondary" },
    { label: "Decline",  next: "Cancelled",      variant: "destructive" },
  ],
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

type DialogState =
  | { type: "cancel"; booking: BookingRow }
  | { type: "counter"; booking: BookingRow }
  | null;

export default function WarehouseBookingsPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  // Modal state for decline and counter-offer actions
  const [dialog, setDialog] = useState<DialogState>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [counterPrice, setCounterPrice] = useState("");
  const [counterNote, setCounterNote] = useState("");

  function openDialog(state: DialogState) {
    setCancelReason("");
    setCounterPrice("");
    setCounterNote("");
    setDialog(state);
  }

  const bookingsQuery = useQuery({
    queryKey: ["warehouse", "bookings"],
    enabled: !isExploring,
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

  const bookings = isExploring ? SAMPLE_WH_BOOKINGS : (bookingsQuery.data ?? []);

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse", "bookings"] });
      setDialog(null);
    },
  });

  /** Best display price: final → counter-offer → proposed. */
  function displayPrice(b: BookingRow): string {
    const v = b.final_price ?? b.counter_offer_price ?? b.proposed_price;
    return v != null ? `$${Number(v).toFixed(2)}` : "—";
  }

  function handleTransitionClick(b: BookingRow, next: string) {
    if (!guard("Update this booking")) return;
    if (next === "Cancelled") {
      openDialog({ type: "cancel", booking: b });
    } else if (next === "CounterOffered") {
      openDialog({ type: "counter", booking: b });
    } else {
      transition.mutate({ id: b.id, next });
    }
  }

  function confirmCancel() {
    if (!dialog || dialog.type !== "cancel" || !cancelReason.trim()) return;
    transition.mutate({ id: dialog.booking.id, next: "Cancelled", reason: cancelReason.trim() });
  }

  function confirmCounter() {
    if (!dialog || dialog.type !== "counter") return;
    const price = parseFloat(counterPrice);
    if (isNaN(price) || price <= 0) return;
    transition.mutate({
      id: dialog.booking.id,
      next: "CounterOffered",
      counterPrice: price,
      reason: counterNote.trim() || undefined,
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Booking requests</h1>
        <p className="text-sm text-muted-foreground">
          Accept, counter, confirm, start, or complete bookings.
        </p>
      </div>

      {transition.error && !dialog && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(transition.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All bookings</CardTitle>
          <CardDescription>{bookings.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          {!isExploring && bookingsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : bookings.length === 0 ? (
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
                {bookings.map((b) => (
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
                          onClick={() => handleTransitionClick(b, t.next)}
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

      {/* Decline / cancel modal */}
      {dialog?.type === "cancel" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold text-base">Decline booking</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Booking <span className="font-mono text-xs">{dialog.booking.id.slice(0, 8)}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="decline-reason">Reason for declining (required)</Label>
              <Input
                id="decline-reason"
                placeholder="e.g. no capacity for requested dates…"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
            {transition.error && (
              <p className="text-sm text-red-600">{(transition.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDialog(null)}>
                Back
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!cancelReason.trim() || transition.isPending}
                onClick={confirmCancel}
              >
                {transition.isPending ? "Declining…" : "Confirm decline"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Counter-offer modal */}
      {dialog?.type === "counter" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold text-base">Counter offer</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Customer proposed{" "}
                {dialog.booking.proposed_price != null
                  ? `$${Number(dialog.booking.proposed_price).toFixed(2)}`
                  : "no price"}
                . Enter your counter price.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="counter-price">Counter price ($)</Label>
              <Input
                id="counter-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 1200.00"
                value={counterPrice}
                onChange={(e) => setCounterPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="counter-note">Message to customer (optional)</Label>
              <Input
                id="counter-note"
                placeholder="e.g. Rate includes forklift handling…"
                value={counterNote}
                onChange={(e) => setCounterNote(e.target.value)}
              />
            </div>
            {transition.error && (
              <p className="text-sm text-red-600">{(transition.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDialog(null)}>
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={
                  !counterPrice.trim() ||
                  isNaN(parseFloat(counterPrice)) ||
                  parseFloat(counterPrice) <= 0 ||
                  transition.isPending
                }
                onClick={confirmCounter}
              >
                {transition.isPending ? "Sending…" : "Send counter offer"}
              </Button>
            </div>
          </div>
        </div>
      )}
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
