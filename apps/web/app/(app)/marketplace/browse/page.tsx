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
import { Store, MapPin, Building2, Plus, Search, ChevronRight } from "lucide-react";
import {
  SERVICE_TYPES, serviceTypeLabel, subcategoryLabel, isInsuranceType, type ServiceType,
} from "@/lib/serviceMarketplace";
import { useExplore, useActionGuard } from "@/lib/explore-store";

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
  cargo_rate_percent: number | null;
  min_premium: number | null;
  negotiable: boolean | null;
  certifications: string | null;
  company: { id: string; name: string; city: string | null } | null;
}

const TYPE_BADGE: Record<ServiceType, "success" | "warning" | "secondary"> = {
  service: "success",
  equipment_rental: "warning",
  crane_service: "warning",
  mobile_repair: "secondary",
  cargo_insurance: "warning",
};

/** Explore-mode sample listings — matches MarketListing shape exactly. */
const SAMPLE_MARKET_LISTINGS: MarketListing[] = [
  { id: "ex-ml-1", company_id: "ex-co-r1", service_type: "equipment_rental", subcategory: "crane", title: "Operated Crane — 20t", description: "Operated mobile crane for lifts, by the day or half day. Certified operator included.", coverage_area: ["Surrey", "Langley", "Delta"], hourly_rate: 220, per_job_rate: null, daily_rate: 1500, weekly_rate: null, minimum_hours: 4, cargo_rate_percent: null, min_premium: null, negotiable: true, certifications: "Red Seal operator", company: { id: "ex-co-r1", name: "WestCoast Crane & Rigging", city: "Surrey" } },
  { id: "ex-ml-2", company_id: "ex-co-r2", service_type: "mobile_repair", subcategory: "reefer_repair", title: "Mobile Reefer & Trailer Repair", description: "On-site reefer, trailer and forklift repair technicians, available 24/7 across Metro Vancouver.", coverage_area: ["Vancouver", "Burnaby", "Richmond"], hourly_rate: 145, per_job_rate: null, daily_rate: null, weekly_rate: null, minimum_hours: 1, cargo_rate_percent: null, min_premium: null, negotiable: false, certifications: "310T certified", company: { id: "ex-co-r2", name: "RapidFix Mobile Service", city: "Burnaby" } },
  { id: "ex-ml-3", company_id: "ex-co-r3", service_type: "cargo_insurance", subcategory: null, title: "Per-Shipment Cargo Cover", description: "Freight cargo insurance, per-shipment or annual policies. Fast binding, instant certificates.", coverage_area: ["Vancouver", "Toronto", "Calgary"], hourly_rate: null, per_job_rate: null, daily_rate: null, weekly_rate: null, minimum_hours: null, cargo_rate_percent: 0.4, min_premium: 85, negotiable: false, certifications: null, company: { id: "ex-co-r3", name: "Harbour Underwriters", city: "Vancouver" } },
  { id: "ex-ml-4", company_id: "ex-co-r4", service_type: "equipment_rental", subcategory: "forklift", title: "Forklift Rental — 5,000 lb", description: "Warehouse forklift rental, daily or weekly. Delivery and pickup available.", coverage_area: ["Richmond", "Delta"], hourly_rate: null, per_job_rate: null, daily_rate: 180, weekly_rate: 720, minimum_hours: null, cargo_rate_percent: null, min_premium: null, negotiable: true, certifications: null, company: { id: "ex-co-r4", name: "Fraser Equipment Co.", city: "Richmond" } },
  { id: "ex-ml-5", company_id: "ex-co-r5", service_type: "service", subcategory: "customs_brokerage", title: "Customs Clearance (Import/Export)", description: "PARS/PAPS, HS classification, duty & tax remittance. CIFFA & CBSA compliant.", coverage_area: ["Delta", "Vancouver"], hourly_rate: 120, per_job_rate: 250, daily_rate: null, weekly_rate: null, minimum_hours: 1, cargo_rate_percent: null, min_premium: null, negotiable: false, certifications: "CIFFA", company: { id: "ex-co-r5", name: "Pacific Customs Brokers", city: "Delta" } },
  { id: "ex-ml-6", company_id: "ex-co-r6", service_type: "mobile_repair", subcategory: "tire_service", title: "24/7 Mobile Tire Service", description: "Roadside and yard tire replacement for trucks and trailers.", coverage_area: ["Vancouver", "Surrey", "Abbotsford"], hourly_rate: 130, per_job_rate: null, daily_rate: null, weekly_rate: null, minimum_hours: 1, cargo_rate_percent: null, min_premium: null, negotiable: true, certifications: null, company: { id: "ex-co-r6", name: "RoadReady Tire", city: "Surrey" } },
];

function priceLabel(l: MarketListing): string {
  if (l.service_type === "cargo_insurance") {
    if (l.cargo_rate_percent) return `${l.cargo_rate_percent}% of value`;
    if (l.min_premium) return `from $${l.min_premium}`;
    return l.negotiable ? "Negotiable" : "—";
  }
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
  const { isExploring } = useExplore();
  const guard = useActionGuard();
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
  const [cargoValue, setCargoValue] = useState("");
  const [notes, setNotes] = useState("");
  const insurance = selected ? isInsuranceType(selected.service_type) : false;

  const listingsQ = useQuery({
    queryKey: ["marketplace", "listings"],
    enabled: !isExploring,
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

  const listings = useMemo(() => (isExploring ? SAMPLE_MARKET_LISTINGS : (listingsQ.data ?? [])), [listingsQ.data, isExploring]);

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
      if (!guard("Request a quote")) return;
      if (!selected) throw new Error("No listing selected.");
      if (!city.trim() || !dateTime.trim()) {
        throw new Error("Please fill city and date/time.");
      }
      const durationHours = insurance ? 1 : Number(duration);
      if (!insurance && (!Number.isFinite(durationHours) || durationHours <= 0)) {
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
      const { data, error } = await supabase.from("service_jobs").insert({
        service_id: selected.id,
        customer_company_id: membership.company_id,
        location_address: address.trim(),
        location_city: city.trim(),
        date_time_start: dateTime,
        duration_hours: durationHours || 1,
        notes: notes.trim(),
        total_price: 0,
        status: "Requested",
        payment_status: "Pending",
        quote_status: "requested",
        cargo_value: insurance && cargoValue ? Number(cargoValue) : null,
      }).select("id").single();
      if (error) throw error;
      return data?.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace", "listings"] });
      setSelected(null);
      setAddress(""); setCity(""); setDateTime(""); setDuration(""); setCargoValue(""); setNotes("");
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

      {!isExploring && listingsQ.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading marketplace…</p>
      ) : !isExploring && listingsQ.isError ? (
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
                  <Link
                    href={`/marketplace/provider/${l.company_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <Building2 className="h-3.5 w-3.5" /> {l.company?.name ?? "Provider"}
                    <ChevronRight className="h-3 w-3" />
                  </Link>
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
                  {(insurance
                    ? [
                        ["Rate", selected.cargo_rate_percent ? `${selected.cargo_rate_percent}%` : "—"],
                        ["Min Premium", selected.min_premium ? `$${selected.min_premium}` : "—"],
                        ["Pricing", selected.negotiable ? "Negotiable" : "Quoted"],
                      ]
                    : [
                        ["Hourly", selected.hourly_rate ? `$${selected.hourly_rate}` : "—"],
                        ["Daily", selected.daily_rate ? `$${selected.daily_rate}` : "—"],
                        ["Weekly", selected.weekly_rate ? `$${selected.weekly_rate}` : "—"],
                        ["Per Job", selected.per_job_rate ? `$${selected.per_job_rate}` : "—"],
                        ["Min Hours", `${selected.minimum_hours ?? 1}h`],
                        ["Pricing", selected.negotiable ? "Negotiable" : "Fixed"],
                      ]
                  ).map(([label, val]) => (
                    <div key={label}>
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="font-semibold">{val}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium">Request a quote</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Location address</Label>
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="8800 Bridgeport Rd" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>City</Label>
                      <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Richmond" />
                    </div>
                    {insurance ? (
                      <div className="space-y-1.5">
                        <Label>Declared cargo value ($)</Label>
                        <Input type="number" min={0} value={cargoValue} onChange={(e) => setCargoValue(e.target.value)} placeholder="50000" />
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label>Duration (hours)</Label>
                        <Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="8" />
                      </div>
                    )}
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Start date/time</Label>
                      <Input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Notes</Label>
                      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details, access, equipment specs, cargo type…" rows={3} />
                    </div>
                  </div>
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">The provider reviews your request and sends an official price. You can accept or decline it.</p>
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
                  {request.isPending ? "Sending…" : "Request quote"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
