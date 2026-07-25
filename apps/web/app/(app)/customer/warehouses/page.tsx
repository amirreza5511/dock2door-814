"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useExplore } from "@/lib/explore-store";
import { SAMPLE_WAREHOUSE_LISTINGS } from "@/lib/explore-samples";

interface ListingRow {
  id: string;
  name: string;
  city: string | null;
  warehouse_type: string;
  available_pallet_capacity: number | null;
  min_pallets: number | null;
  max_pallets: number | null;
  storage_rate_per_pallet: number | null;
  storage_term: string | null;
  inbound_handling_fee_per_pallet: number | null;
  outbound_handling_fee_per_pallet: number | null;
  receiving_hours: string | null;
  access_restrictions: string | null;
  notes: string | null;
  status: string;
  company_name?: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  Dry: "bg-amber-100 text-amber-800",
  Chill: "bg-blue-100 text-blue-800",
  Frozen: "bg-cyan-100 text-cyan-800",
};

const WH_TYPES = ["All", "Dry", "Chill", "Frozen"] as const;

const SAMPLE_ROWS: ListingRow[] = SAMPLE_WAREHOUSE_LISTINGS.map((l) => ({
  id: l.id,
  name: l.name,
  city: l.city,
  warehouse_type: l.warehouse_type === "Chilled" ? "Chill" : l.warehouse_type,
  available_pallet_capacity: l.available_pallet_capacity,
  min_pallets: 10,
  max_pallets: l.available_pallet_capacity,
  storage_rate_per_pallet: l.storage_rate_per_pallet,
  storage_term: "Month",
  inbound_handling_fee_per_pallet: 4.5,
  outbound_handling_fee_per_pallet: 4.5,
  receiving_hours: "Mon–Fri 7am–3pm",
  access_restrictions: null,
  notes: null,
  status: "Active",
  company_name: l.name,
}));

export default function CustomerWarehousesPage() {
  const supabase = getBrowserSupabase();
  const { isExploring } = useExplore();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<typeof WH_TYPES[number]>("All");
  const [selected, setSelected] = useState<ListingRow | null>(null);

  const listingsQ = useQuery({
    queryKey: ["customer", "warehouses"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_listings")
        .select(`id,name,city,warehouse_type,available_pallet_capacity,min_pallets,max_pallets,
          storage_rate_per_pallet,storage_term,inbound_handling_fee_per_pallet,
          outbound_handling_fee_per_pallet,receiving_hours,access_restrictions,notes,status,
          companies!inner(name)`)
        .in("status", ["Active", "Available"])
        .order("city", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((l: any) => ({
        ...l,
        company_name: l.companies?.name ?? null,
      })) as ListingRow[];
    },
  });

  const filtered = (isExploring ? SAMPLE_ROWS : (listingsQ.data ?? [])).filter((l) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      l.name?.toLowerCase().includes(q) ||
      l.city?.toLowerCase().includes(q) ||
      l.company_name?.toLowerCase().includes(q);
    const matchType = typeFilter === "All" || l.warehouse_type === typeFilter;
    return matchSearch && matchType;
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Find storage</h1>
        <p className="text-sm text-muted-foreground">
          Browse available warehouse listings and request a booking.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-72"
          placeholder="Search name, city, company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {WH_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === t
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} listing{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {!isExploring && listingsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading warehouses…</p>
      ) : !isExploring && listingsQ.error ? (
        <p className="text-sm text-red-600">{(listingsQ.error as Error).message}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No warehouses found matching your criteria.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l) => (
            <Card key={l.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{l.name}</CardTitle>
                    <CardDescription className="mt-0.5">{l.company_name} · {l.city ?? "—"}</CardDescription>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[l.warehouse_type] ?? "bg-muted text-muted-foreground"}`}>
                    {l.warehouse_type}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="space-y-1 text-sm">
                  {l.storage_rate_per_pallet != null && (
                    <div className="font-semibold text-foreground">
                      ${Number(l.storage_rate_per_pallet).toFixed(2)} / pallet / {l.storage_term?.toLowerCase() ?? "mo"}
                    </div>
                  )}
                  {l.available_pallet_capacity != null && (
                    <div className="text-muted-foreground">{l.available_pallet_capacity} pallets available</div>
                  )}
                  {l.min_pallets != null && (
                    <div className="text-muted-foreground">Min {l.min_pallets} – Max {l.max_pallets} pallets</div>
                  )}
                </div>
                <div className="mt-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelected(l)}>
                    Details
                  </Button>
                  <Link href={`/customer/warehouses/${l.id}`}>
                    <Button size="sm">Request booking</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quick detail modal */}
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
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="text-sm text-muted-foreground">{selected.company_name} · {selected.city}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>✕</Button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Type</div>
                  <Badge variant="secondary">{selected.warehouse_type}</Badge>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Capacity</div>
                  <div>{selected.available_pallet_capacity ?? "—"} pallets available</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Storage rate</div>
                  <div>{selected.storage_rate_per_pallet != null ? `$${Number(selected.storage_rate_per_pallet).toFixed(2)} / pallet / ${selected.storage_term?.toLowerCase() ?? "mo"}` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Inbound handling</div>
                  <div>{selected.inbound_handling_fee_per_pallet != null ? `$${Number(selected.inbound_handling_fee_per_pallet).toFixed(2)} / pallet` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Outbound handling</div>
                  <div>{selected.outbound_handling_fee_per_pallet != null ? `$${Number(selected.outbound_handling_fee_per_pallet).toFixed(2)} / pallet` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Pallet range</div>
                  <div>{selected.min_pallets} – {selected.max_pallets}</div>
                </div>
              </div>
              {selected.receiving_hours && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Receiving hours</div>
                  <p>{selected.receiving_hours}</p>
                </div>
              )}
              {selected.access_restrictions && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Restrictions</div>
                  <p>{selected.access_restrictions}</p>
                </div>
              )}
              {selected.notes && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Notes</div>
                  <p>{selected.notes}</p>
                </div>
              )}
              <div className="pt-2 border-t">
                <Link href={`/customer/warehouses/${selected.id}`}>
                  <Button className="w-full">Request booking</Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
