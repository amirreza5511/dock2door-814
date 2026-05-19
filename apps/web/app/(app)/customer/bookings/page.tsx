"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

interface BookingRow {
  id: string;
  status: string;
  pallets_requested: number;
  start_date: string | null;
  end_date: string | null;
  proposed_price: number | null;
  final_price: number | null;
  counter_offer_price: number | null;
  payment_status: string;
  handling_required: boolean;
  customer_notes: string | null;
  provider_response_notes: string | null;
  created_at: string;
  listing_name?: string | null;
  listing_city?: string | null;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive" | "default"> = {
  Confirmed: "success",
  InProgress: "success",
  Completed: "success",
  Requested: "warning",
  CounterOffered: "warning",
  Accepted: "default" as any,
  Cancelled: "destructive",
};

export default function CustomerBookingsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<BookingRow | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const bookingsQ = useQuery({
    queryKey: ["customer", "bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_bookings")
        .select(`id,status,pallets_requested,start_date,end_date,proposed_price,final_price,
          counter_offer_price,payment_status,handling_required,customer_notes,
          provider_response_notes,created_at,
          warehouse_listings!inner(name,city)`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((b: any) => ({
        ...b,
        listing_name: b.warehouse_listings?.name ?? null,
        listing_city: b.warehouse_listings?.city ?? null,
      })) as BookingRow[];
    },
  });

  const cancel = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("transition_booking", {
        p_booking_id: id,
        p_next_status: "Cancelled",
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer", "bookings"] });
      setSelected(null);
      setShowCancelModal(false);
      setCancelReason("");
    },
  });

  const acceptCounter = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("transition_booking", {
        p_booking_id: id,
        p_next_status: "Accepted",
        p_reason: "Customer accepted counter offer",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer", "bookings"] });
      setSelected(null);
    },
  });

  const cols: Column<BookingRow>[] = [
    {
      key: "listing",
      header: "Warehouse",
      render: (b) => (
        <div>
          <div className="font-medium">{b.listing_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{b.listing_city ?? ""}</div>
        </div>
      ),
      sortable: true,
      sortValue: (b) => b.listing_name,
    },
    {
      key: "status",
      header: "Status",
      render: (b) => (
        <div className="space-y-1">
          <Badge variant={STATUS_VARIANT[b.status] ?? "secondary"}>{b.status}</Badge>
          {b.payment_status !== "Pending" && (
            <Badge variant={b.payment_status === "Paid" ? "success" : "secondary"} className="block text-xs">
              {b.payment_status}
            </Badge>
          )}
        </div>
      ),
      sortable: true,
      sortValue: (b) => b.status,
    },
    {
      key: "dates",
      header: "Period",
      render: (b) => <span className="text-xs">{b.start_date ?? "—"} → {b.end_date ?? "—"}</span>,
    },
    {
      key: "pallets",
      header: "Pallets",
      render: (b) => b.pallets_requested,
    },
    {
      key: "price",
      header: "Price",
      render: (b) => {
        const p = b.final_price ?? b.counter_offer_price ?? b.proposed_price;
        return p != null ? `$${Number(p).toFixed(2)}` : "—";
      },
    },
    {
      key: "created",
      header: "Requested",
      render: (b) => <span className="text-xs text-muted-foreground">{formatDate(b.created_at)}</span>,
      sortable: true,
      sortValue: (b) => b.created_at,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (b) => (
        <Button size="sm" variant="outline" onClick={() => setSelected(b)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My bookings</h1>
        <p className="text-sm text-muted-foreground">Track your warehouse storage bookings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bookings</CardTitle>
          <CardDescription>{bookingsQ.data?.length ?? 0} total</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={bookingsQ.data ?? []}
            columns={cols}
            rowKey={(b) => b.id}
            isLoading={bookingsQ.isLoading}
            error={bookingsQ.error as Error | null}
            searchPlaceholder="Search warehouse or status…"
            filters={[
              { value: "active", label: "Active", predicate: (b) => ["Requested","Accepted","CounterOffered","Confirmed","InProgress"].includes(b.status) },
              { value: "completed", label: "Completed", predicate: (b) => b.status === "Completed" },
              { value: "cancelled", label: "Cancelled", predicate: (b) => b.status === "Cancelled" },
            ]}
            emptyMessage="No bookings yet. Browse warehouses to get started."
          />
        </CardContent>
      </Card>

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.listing_name}</h2>
                <p className="text-sm text-muted-foreground">{selected.listing_city}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>✕</Button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Status</div>
                  <Badge variant={STATUS_VARIANT[selected.status] ?? "secondary"}>{selected.status}</Badge>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Payment</div>
                  <Badge variant={selected.payment_status === "Paid" ? "success" : "secondary"}>{selected.payment_status}</Badge>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Period</div>
                  <div>{selected.start_date ?? "—"} → {selected.end_date ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Pallets</div>
                  <div>{selected.pallets_requested}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Proposed price</div>
                  <div>{selected.proposed_price != null ? `$${Number(selected.proposed_price).toFixed(2)}` : "—"}</div>
                </div>
                {selected.counter_offer_price != null && (
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Counter offer</div>
                    <div className="font-medium text-amber-700">${Number(selected.counter_offer_price).toFixed(2)}</div>
                  </div>
                )}
                {selected.final_price != null && (
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Final price</div>
                    <div className="font-medium">${Number(selected.final_price).toFixed(2)}</div>
                  </div>
                )}
              </div>

              {selected.customer_notes && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Your notes</div>
                  <p>{selected.customer_notes}</p>
                </div>
              )}
              {selected.provider_response_notes && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Provider response</div>
                  <p>{selected.provider_response_notes}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t">
                {selected.status === "CounterOffered" && (
                  <Button
                    className="flex-1"
                    disabled={acceptCounter.isPending}
                    onClick={() => acceptCounter.mutate(selected.id)}
                  >
                    Accept counter offer (${Number(selected.counter_offer_price ?? 0).toFixed(2)})
                  </Button>
                )}
                {["Requested", "Accepted", "CounterOffered"].includes(selected.status) && (
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={cancel.isPending}
                    onClick={() => setShowCancelModal(true)}
                  >
                    Cancel booking
                  </Button>
                )}
              </div>

              {/* Cancel confirmation modal */}
              {showCancelModal && (
                <div
                  className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4"
                  onClick={() => { setShowCancelModal(false); setCancelReason(""); }}
                >
                  <div
                    className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 className="font-semibold text-base">Cancel booking</h3>
                    <p className="text-sm text-muted-foreground">Please provide a reason for cancelling.</p>
                    <div className="space-y-1.5">
                      <Label htmlFor="cancel-reason">Reason</Label>
                      <Input
                        id="cancel-reason"
                        placeholder="e.g. dates changed, found alternative…"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                    </div>
                    {cancel.error && (
                      <p className="text-sm text-red-600">{(cancel.error as Error).message}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => { setShowCancelModal(false); setCancelReason(""); }}
                      >
                        Back
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        disabled={!cancelReason.trim() || cancel.isPending}
                        onClick={() => cancel.mutate({ id: selected.id, reason: cancelReason.trim() })}
                      >
                        {cancel.isPending ? "Cancelling…" : "Confirm cancel"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
