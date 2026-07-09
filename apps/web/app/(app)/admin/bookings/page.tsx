"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { Route, ShieldCheck } from "lucide-react";

type FilterKey = "unrouted" | "routed" | "active" | "all";

interface BookingRow {
  id: string;
  status: string;
  customer_company_id: string | null;
  warehouse_company_id: string | null;
  listing_id: string | null;
  start_date: string | null;
  end_date: string | null;
  pallets_requested: number | null;
  proposed_price: number | null;
  customer_notes: string | null;
  created_at: string;
}

interface ListingRow {
  id: string;
  name: string;
  company_id: string;
  city: string | null;
  warehouse_type: string | null;
  status: string;
  available_pallet_capacity: number | null;
  storage_rate_per_pallet: number | null;
  storage_term: string | null;
}

interface CompanyRow { id: string; name: string; type: string }

const ROUTED_STATUSES = ["Accepted", "CounterOffered", "Confirmed", "Scheduled"];
const ACTIVE_STATUSES = ["Accepted", "Confirmed", "Scheduled", "InProgress"];

/** Admin › Booking routing (broker view). Web mirror of expo/app/admin/bookings.tsx. */
export default function AdminBookingsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<FilterKey>("unrouted");
  const [search, setSearch] = useState("");
  const [routeFor, setRouteFor] = useState<BookingRow | null>(null);
  const [routeListingId, setRouteListingId] = useState("");
  const [routeNotes, setRouteNotes] = useState("");

  const dataQ = useQuery({
    queryKey: ["admin", "bookings"],
    queryFn: async () => {
      const [bookings, listings, companies] = await Promise.all([
        supabase.from("warehouse_bookings").select("id,status,customer_company_id,warehouse_company_id,listing_id,start_date,end_date,pallets_requested,proposed_price,customer_notes,created_at").order("created_at", { ascending: false }).limit(400),
        supabase.from("warehouse_listings").select("id,name,company_id,city,warehouse_type,status,available_pallet_capacity,storage_rate_per_pallet,storage_term").limit(400),
        supabase.from("companies").select("id,name,type").limit(1000),
      ]);
      if (bookings.error) throw bookings.error;
      return {
        bookings: (bookings.data ?? []) as BookingRow[],
        listings: (listings.data ?? []) as ListingRow[],
        companies: (companies.data ?? []) as CompanyRow[],
      };
    },
  });

  const bookings = dataQ.data?.bookings ?? [];
  const listings = dataQ.data?.listings ?? [];
  const companies = dataQ.data?.companies ?? [];
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? id.slice(0, 8) : "—");

  const totals = useMemo(() => ({
    unrouted: bookings.filter((b) => b.status === "Requested").length,
    active: bookings.filter((b) => ACTIVE_STATUSES.includes(b.status)).length,
    completed: bookings.filter((b) => b.status === "Completed").length,
  }), [bookings]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (filter === "unrouted" && b.status !== "Requested") return false;
      if (filter === "routed" && !ROUTED_STATUSES.includes(b.status)) return false;
      if (filter === "active" && !ACTIVE_STATUSES.includes(b.status)) return false;
      if (!s) return true;
      return JSON.stringify(b).toLowerCase().includes(s) || companyName(b.customer_company_id).toLowerCase().includes(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, filter, search, companies]);

  const suggested = useMemo(() => {
    if (!routeFor) return [] as ListingRow[];
    const need = routeFor.pallets_requested ?? 0;
    return listings.filter((l) => (l.status === "Available" || l.status === "Active") && (l.available_pallet_capacity ?? 0) >= need).slice(0, 20);
  }, [routeFor, listings]);

  const assign = useMutation({
    mutationFn: async () => {
      if (!routeFor || !routeListingId.trim()) throw new Error("Pick a warehouse");
      const listing = listings.find((l) => l.id === routeListingId);
      if (!listing) throw new Error("Invalid listing");
      const notes = [routeFor.customer_notes, routeNotes ? `Broker routing note: ${routeNotes}` : ""].filter(Boolean).join("\n");
      const { error } = await supabase
        .from("warehouse_bookings")
        .update({ listing_id: routeListingId, warehouse_company_id: listing.company_id, customer_notes: notes })
        .eq("id", routeFor.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "bookings"] }); setRouteFor(null); },
  });

  const forceStatus = useMutation({
    mutationFn: async (input: { id: string; next: "Cancelled" | "Completed"; reason: string }) => {
      const { error } = await supabase.rpc("admin_force_booking_status", { p_booking_id: input.id, p_next_status: input.next, p_reason: input.reason });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "bookings"] }),
  });

  function handleForce(b: BookingRow, next: "Cancelled" | "Completed") {
    const reason = window.prompt(`Admin reason (required) — force ${next}:`);
    if (!reason || !reason.trim()) return;
    forceStatus.mutate({ id: b.id, next, reason: reason.trim() });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Booking routing</h1>
          <p className="text-sm text-muted-foreground">Broker view · customer → Dock2Door → provider.</p>
        </div>
        <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> Broker</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Unrouted" value={totals.unrouted} color="text-amber-500" />
        <StatCard label="Active" value={totals.active} color="text-sky-500" />
        <StatCard label="Completed" value={totals.completed} color="text-emerald-500" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-64" placeholder="Search customer, listing, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {(["unrouted", "routed", "active", "all"] as FilterKey[]).map((k) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${filter === k ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
            {k === "unrouted" ? "To route" : k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bookings</CardTitle>
          <CardDescription>{filtered.length} shown</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to route. New customer bookings appear here.</p>
          ) : filtered.map((b) => {
            const listing = listings.find((l) => l.id === b.listing_id);
            const unrouted = b.status === "Requested";
            return (
              <div key={b.id} className={`rounded-xl border p-4 ${unrouted ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{companyName(b.customer_company_id)} <span className="font-mono text-xs text-muted-foreground">· {b.id.slice(0, 8)}</span></div>
                    <div className="mt-0.5 text-sm">{b.pallets_requested ?? "—"} pallets · {b.start_date ?? "—"} → {b.end_date ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(b.created_at)}</div>
                  </div>
                  <Badge variant="secondary">{b.status}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted/40 p-3 text-sm">
                  <div className="flex-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Customer pays</div>
                    <div className="font-semibold">{b.proposed_price != null ? `$${Number(b.proposed_price).toLocaleString()}` : "—"}</div>
                  </div>
                  <Route className="h-4 w-4 text-primary" />
                  <div className="flex-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Routed to</div>
                    <div className="font-semibold">{listing?.name ?? (unrouted ? "— pending —" : "Unknown")}</div>
                    {listing && <div className="text-xs text-muted-foreground">Provider: {companyName(listing.company_id)}</div>}
                  </div>
                </div>
                {b.customer_notes && <p className="mt-2 border-l-2 border-border pl-2 text-sm italic text-muted-foreground">“{b.customer_notes}”</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => { setRouteFor(b); setRouteListingId(b.listing_id ?? ""); setRouteNotes(""); }}>
                    {unrouted ? "Route to warehouse" : "Re-route"}
                  </Button>
                  {!unrouted && b.status !== "Completed" && b.status !== "Cancelled" && (
                    <Button size="sm" variant="secondary" disabled={forceStatus.isPending} onClick={() => handleForce(b, "Completed")}>Force complete</Button>
                  )}
                  {b.status !== "Completed" && b.status !== "Cancelled" && (
                    <Button size="sm" variant="destructive" disabled={forceStatus.isPending} onClick={() => handleForce(b, "Cancelled")}>Cancel</Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {routeFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRouteFor(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Assign warehouse</h3>
            <p className="text-sm text-muted-foreground">The customer never sees the provider identity. Only the assigned provider receives operational booking details.</p>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested warehouses ({suggested.length})</p>
              {suggested.length === 0 ? (
                <p className="text-sm text-muted-foreground">No listings match the pallet requirement. Enter a listing ID below.</p>
              ) : suggested.map((l) => {
                const active = routeListingId === l.id;
                return (
                  <button key={l.id} onClick={() => setRouteListingId(l.id)}
                    className={`w-full rounded-lg border p-3 text-left ${active ? "border-primary bg-primary/10" : "border-border"}`}>
                    <div className="text-sm font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{companyName(l.company_id)} · {l.city ?? "—"} · {l.warehouse_type ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{l.available_pallet_capacity ?? 0} pallets available · ${l.storage_rate_per_pallet ?? 0}/{(l.storage_term ?? "").toLowerCase()}</div>
                  </button>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-id">Listing ID override</Label>
              <Input id="listing-id" value={routeListingId} onChange={(e) => setRouteListingId(e.target.value)} placeholder="listing_…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="route-notes">Internal routing note (not shown to customer)</Label>
              <Textarea id="route-notes" value={routeNotes} onChange={(e) => setRouteNotes(e.target.value)} rows={3} placeholder="Rate negotiated, temp window, etc." />
            </div>
            {assign.error && <p className="text-sm text-red-600">{(assign.error as Error).message}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRouteFor(null)}>Cancel</Button>
              <Button className="flex-1" disabled={assign.isPending || !routeListingId.trim()} onClick={() => assign.mutate()}>
                {assign.isPending ? "Routing…" : "Route booking"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
