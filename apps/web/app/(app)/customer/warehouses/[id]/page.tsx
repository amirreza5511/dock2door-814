"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function WarehouseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [pallets, setPallets] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [handling, setHandling] = useState(false);
  const [notes, setNotes] = useState("");

  const listingQ = useQuery({
    queryKey: ["customer", "warehouse", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_listings")
        .select(`*, companies!inner(name)`)
        .eq("id", id)
        .single();
      if (error) throw error;
      return { ...data, company_name: (data as any).companies?.name } as any;
    },
    enabled: Boolean(id),
  });

  const l = listingQ.data;

  const totalPrice = l
    ? Number(l.storage_rate_per_pallet ?? 0) * pallets +
      (handling
        ? Number(l.inbound_handling_fee_per_pallet ?? 0) * pallets +
          Number(l.outbound_handling_fee_per_pallet ?? 0) * pallets
        : 0)
    : 0;

  const book = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .single();

      if (!profile?.company_id) throw new Error("No company associated with your account.");

      const { error } = await supabase.from("warehouse_bookings").insert({
        listing_id: id,
        customer_company_id: profile.company_id,
        pallets_requested: pallets,
        start_date: startDate,
        end_date: endDate,
        handling_required: handling,
        customer_notes: notes.trim(),
        proposed_price: totalPrice,
        status: "Requested",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer", "bookings"] });
      router.push("/customer/bookings");
    },
  });

  if (listingQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (listingQ.error) return <div className="p-6 text-sm text-red-600">{(listingQ.error as Error).message}</div>;
  if (!l) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/customer/warehouses">
          <Button variant="secondary" size="sm">← Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{l.name}</h1>
          <p className="text-sm text-muted-foreground">{l.company_name} · {l.city}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Listing details */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Listing details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Type</div>
                  <Badge variant="secondary">{l.warehouse_type}</Badge>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Available capacity</div>
                  <div>{l.available_pallet_capacity ?? "—"} pallets</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Min / Max pallets</div>
                  <div>{l.min_pallets} – {l.max_pallets}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Storage term</div>
                  <div>{l.storage_term}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Storage rate</div>
                  <div className="font-medium">${Number(l.storage_rate_per_pallet ?? 0).toFixed(2)} / pallet</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Inbound handling</div>
                  <div>${Number(l.inbound_handling_fee_per_pallet ?? 0).toFixed(2)} / pallet</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Outbound handling</div>
                  <div>${Number(l.outbound_handling_fee_per_pallet ?? 0).toFixed(2)} / pallet</div>
                </div>
              </div>
              {l.receiving_hours && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Receiving hours</div>
                  <p className="text-sm">{l.receiving_hours}</p>
                </div>
              )}
              {l.access_restrictions && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Access restrictions</div>
                  <p className="text-sm">{l.access_restrictions}</p>
                </div>
              )}
              {l.insurance_requirements && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Insurance requirements</div>
                  <p className="text-sm">{l.insurance_requirements}</p>
                </div>
              )}
              {l.notes && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Notes</div>
                  <p className="text-sm">{l.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Booking form */}
        <div className="lg:col-span-2">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Request booking</CardTitle>
              <CardDescription>Submit a storage request to the warehouse provider.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {book.error && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  {(book.error as Error).message}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Pallets needed</Label>
                <Input
                  type="number"
                  min={l.min_pallets ?? 1}
                  max={l.max_pallets ?? 9999}
                  value={pallets}
                  onChange={(e) => setPallets(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Min {l.min_pallets} – Max {l.max_pallets}</p>
              </div>

              <div className="space-y-1.5">
                <Label>Start date *</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>End date *</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="handling"
                  type="checkbox"
                  checked={handling}
                  onChange={(e) => setHandling(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <label htmlFor="handling" className="text-sm cursor-pointer">
                  Include handling (inbound + outbound)
                </label>
              </div>

              <div className="space-y-1.5">
                <Label>Notes to provider</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Special requirements…"
                />
              </div>

              <div className="rounded-md border bg-muted/30 px-3 py-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Storage ({pallets} pallets)</span>
                  <span>${(Number(l.storage_rate_per_pallet ?? 0) * pallets).toFixed(2)}</span>
                </div>
                {handling && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Handling</span>
                    <span>${((Number(l.inbound_handling_fee_per_pallet ?? 0) + Number(l.outbound_handling_fee_per_pallet ?? 0)) * pallets).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium border-t pt-1 mt-1">
                  <span>Proposed total</span>
                  <span>${totalPrice.toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground">Provider may counter-offer.</p>
              </div>

              <Button
                className="w-full"
                disabled={!startDate || !endDate || book.isPending}
                onClick={() => book.mutate()}
              >
                {book.isPending ? "Submitting…" : "Submit booking request"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
