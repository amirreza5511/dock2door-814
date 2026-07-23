"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Tag, Inbox, Store, ChevronRight, UserCircle, type LucideIcon } from "lucide-react";
import type { ServiceType } from "@/lib/serviceMarketplace";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const mpDate = (h: number): string => new Date(Date.now() + h * 3600e3).toISOString();
function sampleProviderData(type: ServiceType) {
  return {
    companyId: null as string | null,
    listings: [
      { id: "ex-pl-1", title: type === "cargo_insurance" ? "Per-Shipment Cargo Cover" : type === "equipment_rental" ? "Operated Crane — 20t" : "Mobile Reefer & Trailer Repair", service_type: type, subcategory: null, status: "Active", hourly_rate: 145 },
      { id: "ex-pl-2", title: type === "cargo_insurance" ? "Annual Freight Policy" : type === "equipment_rental" ? "Reach Forklift — daily" : "Forklift Field Service", service_type: type, subcategory: null, status: "Active", hourly_rate: 120 },
    ],
    jobs: [
      { id: "ex-pj-1", status: "Requested", quote_status: "requested", quoted_amount: null, total_price: null, commission_amount: 0, location_city: "Burnaby", date_time_start: mpDate(26), payment_status: "Pending", created_at: mpDate(-4) },
      { id: "ex-pj-2", status: "Scheduled", quote_status: "accepted", quoted_amount: 880, total_price: 880, commission_amount: 88, location_city: "Surrey", date_time_start: mpDate(48), payment_status: "Held", created_at: mpDate(-26) },
      { id: "ex-pj-3", status: "Completed", quote_status: "accepted", quoted_amount: 290, total_price: 290, commission_amount: 29, location_city: "Delta", date_time_start: mpDate(-40), payment_status: "Paid", created_at: mpDate(-96) },
    ] as any[],
  };
}

export interface ProviderDashboardConfig {
  kicker: string;
  tagline: string;
  primaryType: ServiceType;
  icon: LucideIcon;
  accent: string; // tailwind text color class, e.g. "text-amber-500"
  jobNoun: string;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive" | "default"> = {
  Completed: "success",
  InProgress: "success",
  Scheduled: "warning",
  Accepted: "warning",
  Requested: "secondary",
  Cancelled: "destructive",
};

/**
 * Full provider dashboard shared by every Domain 5 provider role on the web
 * (equipment/crane rental, mobile repair, cargo insurer). Reads the same
 * marketplace tables and links into the shared marketplace flow.
 */
export default function MarketplaceProviderDashboard({ config }: { config: ProviderDashboardConfig }) {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const supabase = getBrowserSupabase();
  const Icon = config.icon;

  const dataQ = useQuery({
    queryKey: ["provider-dashboard", config.primaryType],
    enabled: !isExploring,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: membership } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      const companyId = membership?.company_id as string | undefined;
      if (!companyId) return { companyId: null, listings: [], jobs: [] };

      const { data: listings } = await supabase
        .from("service_listings")
        .select("id, title, service_type, subcategory, status, hourly_rate")
        .eq("company_id", companyId);
      const listingIds = ((listings ?? []) as { id: string }[]).map((l) => l.id);

      let jobs: any[] = [];
      if (listingIds.length > 0) {
        const { data } = await supabase
          .from("service_jobs")
          .select("id, status, quote_status, quoted_amount, total_price, commission_amount, location_city, date_time_start, payment_status, created_at")
          .in("service_id", listingIds)
          .order("created_at", { ascending: false })
          .limit(50);
        jobs = data ?? [];
      }
      return { companyId, listings: listings ?? [], jobs };
    },
  });

  const sample = isExploring ? sampleProviderData(config.primaryType) : null;
  const listings = sample?.listings ?? dataQ.data?.listings ?? [];
  const jobs = sample?.jobs ?? dataQ.data?.jobs ?? [];
  const companyId = sample?.companyId ?? dataQ.data?.companyId ?? null;

  const stats = {
    active: listings.filter((l: any) => l.status === "Active" || l.status === "Available").length,
    pending: jobs.filter((j: any) => j.status === "Requested" || j.quote_status === "requested").length,
    completed: jobs.filter((j: any) => j.status === "Completed").length,
    revenue: jobs
      .filter((j: any) => j.status === "Completed")
      .reduce((s: number, j: any) => s + Math.max(0, Number(j.total_price ?? 0) - Number(j.commission_amount ?? 0)), 0),
  };

  const manageCards = [
    { href: "/marketplace/requests", icon: Inbox, title: "Requests & Quotes", desc: `Respond to ${config.jobNoun}s, send quotes & schedule`, accent: "text-blue-500" },
    { href: "/marketplace/my-listings", icon: Tag, title: "My Listings", desc: `${listings.length} published · edit pricing & availability`, accent: config.accent },
    { href: "/marketplace/browse", icon: Store, title: "Browse Marketplace", desc: "See what others rent, repair & insure", accent: "text-emerald-500" },
    ...(companyId ? [{ href: `/marketplace/provider/${companyId}`, icon: UserCircle, title: "My Public Profile", desc: "How buyers see your business", accent: "text-purple-500" }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${config.accent}`}>
            <Icon className="h-4 w-4" /> {config.kicker}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Provider dashboard</h1>
          <p className="text-sm text-muted-foreground">{config.tagline}</p>
        </div>
        {isExploring ? (
          <button
            type="button"
            onClick={() => guard("Create a new listing")}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New listing
          </button>
        ) : (
          <Link
            href={`/marketplace/create?type=${config.primaryType}`}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New listing
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Active listings", value: stats.active },
          { label: `Pending ${config.jobNoun}s`, value: stats.pending },
          { label: "Completed", value: stats.completed },
          { label: "Net revenue", value: `$${stats.revenue.toLocaleString()}` },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="text-3xl font-bold">{s.value}</div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.pending > 0 && (
        <Link href="/marketplace/requests" className="block">
          <Card className="border-amber-500/40 bg-amber-500/10 transition-colors hover:border-amber-500/60">
            <CardContent className="flex items-center gap-3 p-4 text-sm text-amber-700">
              <Inbox className="h-4 w-4" />
              {stats.pending} {config.jobNoun}(s) awaiting your quote — tap to respond
            </CardContent>
          </Card>
        </Link>
      )}

      <div className="grid gap-3">
        {manageCards.map((c) => {
          const CIcon = c.icon;
          return (
            <Link key={c.href} href={c.href} className="block">
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent">
                    <CIcon className={`h-5 w-5 ${c.accent}`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{c.title}</div>
                    <div className="text-sm text-muted-foreground">{c.desc}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent {config.jobNoun}s</h2>
        {jobs.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No {config.jobNoun}s yet. Publish a listing to start receiving requests.</CardContent></Card>
        ) : (
          <div className="grid gap-2">
            {jobs.slice(0, 8).map((j: any) => (
              <Link key={j.id} href={`/marketplace/order/${j.id}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <div className="font-medium">{j.location_city ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{j.date_time_start ? new Date(j.date_time_start).toLocaleDateString("en-CA") : ""}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">
                        {j.quoted_amount != null ? `$${Number(j.quoted_amount).toFixed(0)}` : j.total_price ? `$${Number(j.total_price).toFixed(0)}` : "Quote pending"}
                      </span>
                      <Badge variant={STATUS_VARIANT[j.status] ?? "secondary"}>{j.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
