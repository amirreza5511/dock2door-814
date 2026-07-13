"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Store, MapPin, Building2, Plus, Search } from "lucide-react";
import {
  SERVICE_TYPES, serviceTypeLabel, subcategoryLabel, type ServiceType,
} from "@/lib/serviceMarketplace";

interface MarketListing {
  id: string;
  company_id: string;
  service_type: ServiceType;
  subcategory: string | null;
  title: string | null;
  description: string | null;
  coverage_area: string[] | null;
  hourly_rate: number | null;
  per_job_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  minimum_hours: number | null;
  negotiable: boolean | null;
  certifications: string | null;
  company: { id: string; name: string; city: string | null } | null;
}

const TYPE_BADGE: Record<ServiceType, "success" | "warning" | "secondary"> = {
  service: "success",
  equipment_rental: "warning",
  mobile_repair: "secondary",
};

function priceLabel(l: MarketListing): string {
  if (l.service_type === "equipment_rental") {
    if (l.daily_rate) return `$${l.daily_rate}/day`;
    if (l.weekly_rate) return `$${l.weekly_rate}/wk`;
    if (l.hourly_rate) return `$${l.hourly_rate}/hr`;
    return l.negotiable ? "Negotiable" : "—";
  }
  if (l.hourly_rate) return `$${l.hourly_rate}/hr`;
  if (l.per_job_rate) return `$${l.per_job_rate}/job`;
  return l.negotiable ? "Negotiable" : "—";
}

export default function MarketplaceBrowsePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type");

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ServiceType | "All">(
    SERVICE_TYPES.some((t) => t.id === initialType) ? (initialType as ServiceType) : "All",
  );
  const [selected, setSelected] = useState<MarketListing | null>(null);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");

  const listingsQ = useQuery({
    queryKey: ["marketplace", "listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_listings")
        .select("*, company:companies(id,name,city)")
        .eq("status", "Active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MarketListing[];
    },
  });

  const listings = useMemo(() => listingsQ.data ?? [], [listingsQ.data]);

  const filtered = useMemo(() => listings.filter((l) => {
    const matchType = typeFilter === "All" || l.service_type === typeFilter;
    const q = query.trim().toLowerCase();
    const matchQ = !q ||
      (l.company?.name ?? "").toLowerCase().includes(q) ||
      (l.title ?? "").toLowerCase().includes(q) ||
      subcategoryLabel(l.subcategory).toLowerCase().includes(q) ||
      (l.coverage_area ?? []).some((c) => c.toLowerCase().includes(q));
    return matchType && matchQ;
  }), [listings, typeFilter, query]);

  const request = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No listing selected.");
      if (!address.trim() || !city.trim() || !dateTime.trim() || !duration.trim()) {
        throw new Error("Please fill address, city, date/time and duration.");
      }
      const durationHours = Number(duration);
      if (!Number.isFinite(durationHours) || durationHours <= 0) {
        throw new Error("Enter a valid duration in hours.");
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: membership, error: memErr } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      if (memErr || !membership?.company_id) throw new Error("No company associated with your account.");
      const rate = selected.hourly_rate ?? 0;
      const { error } = await supabase.from("service_jobs").insert({
        service_id: selected.id,
        customer_company_id: membership.company_id,
        location_address: address.trim(),
        location_city: city.trim(),
        date_time_start: dateTime,
        duration_hours: durationHours,
        notes: notes.trim(),
        total_price: rate > 0 ? rate * durationHours : 0,
        status: "Requested",
        payment_status: "Pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace", "listings"] });
      setSelected(null);
      setAddress(""); setCity(""); setDateTime(""); setDuration(""); setNotes("");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Store className="h-6 w-6 text-primary" /> Browse listings
          </h1>
          <p className="text-sm text-muted-foreground">
            Equipment rental, mobile repair & services from every company on Dock2Door.
          </p>
        </div>
        <Link href="/marketplace/create">
          <Button><Plus className="mr-1 h-4 w-4" /> List something</Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search equipment, repair, services, city…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          {(["All", ...SERVICE_TYPES.map((t) => t.id)] as (ServiceType | "All")[]).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                typeFilter === t
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {t === "All" ? "All" : serviceTypeLabel(t)}
            </button>
          ))}
        </div>
      </div>

      {listingsQ.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading marketplace…</p>
      ) : listingsQ.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(listingsQ.error as Error).message}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Store className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">No listings yet</p>
          <p className="text-sm text-muted-foreground">Be the first — list equipment, a repair service or labour.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l) => (
            <Card
              key={l.id}
              className="cursor-pointer transition-colors hover:border-primary/40"
              onClick={() => setSelected(l)}
            >
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between">
                  <Badge variant={TYPE_BADGE[l.service_type]}>{serviceTypeLabel(l.service_type)}</Badge>
                  {l.subcategory && <span className="text-xs text-muted-foreground">{subcategoryLabel(l.subcategory)}</span>}
                </div>
                <div>
                  <h3 className="font-semibold leading-tight">
                    {l.title || subcategoryLabel(l.subcategory) || serviceTypeLabel(l.service_type)}
                  </h3>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" /> {l.company?.name ?? "Provider"}
                  </div>
                  {(l.coverage_area ?? []).length > 0 && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" /> {(l.coverage_area ?? []).join(" · ")}
                    </div>
                  )}
                </div>
                {l.description && <p className="line-clamp-2 text-sm text-muted-foreground">{l.description}</p>}
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-lg font-bold text-emerald-500">{priceLabel(l)}</span>
                  {l.negotiable && <Badge variant="secondary">Negotiable</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge variant={TYPE_BADGE[selected.service_type]}>{serviceTypeLabel(selected.service_type)}</Badge>
                  {selected.title || subcategoryLabel(selected.subcategory)}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5"><Building2 className="h-4 w-4" /> {selected.company?.name}{selected.company?.city ? ` · ${selected.company.city}` : ""}</div>
                  {(selected.coverage_area ?? []).length > 0 && (
                    <div className="mt-1 flex items-center gap-1.5"><MapPin className="h-4 w-4" /> Covers: {(selected.coverage_area ?? []).join(", ")}</div>
                  )}
                </div>
                {selected.description && <p className="text-sm">{selected.description}</p>}
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-border p-3 text-sm">
                  {[
                    ["Hourly", selected.hourly_rate ? `$${selected.hourly_rate}` : "—"],
                    ["Daily", selected.daily_rate ? `$${selected.daily_rate}` : "—"],
                    ["Weekly", selected.weekly_rate ? `$${selected.weekly_rate}` : "—"],
                    ["Per Job", selected.per_job_rate ? `$${selected.per_job_rate}` : "—"],
                    ["Min Hours", `${selected.minimum_hours ?? 1}h`],
                    ["Pricing", selected.negotiable ? "Negotiable" : "Fixed"],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="font-semibold">{val}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium">Request this {serviceTypeLabel(selected.service_type).toLowerCase()}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Location address</Label>
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="8800 Bridgeport Rd" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>City</Label>
                      <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Richmond" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Duration (hours)</Label>
                      <Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="8" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Start date/time</Label>
                      <Input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Notes</Label>
                      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details, access, equipment specs…" rows={3} />
                    </div>
                  </div>
                </div>
                {request.error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {(request.error as Error).message}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
                <Button disabled={request.isPending} onClick={() => request.mutate()}>
                  {request.isPending ? "Sending…" : "Send request"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
