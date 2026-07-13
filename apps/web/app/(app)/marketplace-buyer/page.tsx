"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search, ShoppingBag, ChevronRight, Wrench, Forklift, Hammer, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { SERVICE_TYPES, serviceTypeLabel, subcategoryLabel, type ServiceType } from "@/lib/serviceMarketplace";

const TYPE_ICON: Record<ServiceType, LucideIcon> = {
  service: Wrench,
  equipment_rental: Forklift,
  mobile_repair: Hammer,
  cargo_insurance: ShieldCheck,
};

const TYPE_ACCENT: Record<ServiceType, string> = {
  service: "text-emerald-500",
  equipment_rental: "text-amber-500",
  mobile_repair: "text-purple-500",
  cargo_insurance: "text-yellow-500",
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  Completed: "success",
  InProgress: "success",
  Scheduled: "warning",
  Accepted: "warning",
  Requested: "secondary",
  Cancelled: "destructive",
};

export default function MarketplaceBuyerPage() {
  const supabase = getBrowserSupabase();

  const requestsQ = useQuery({
    queryKey: ["buyer", "my-requests"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: membership } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      const companyId = membership?.company_id as string | undefined;

      let query = supabase
        .from("service_jobs")
        .select("id, status, quote_status, quoted_amount, total_price, location_city, created_at, service_type, subcategory")
        .order("created_at", { ascending: false })
        .limit(30);
      query = companyId
        ? query.or(`customer_company_id.eq.${companyId},customer_id.eq.${user.id}`)
        : query.eq("customer_id", user.id);
      const { data } = await query;
      return data ?? [];
    },
  });

  const requests = requestsQ.data ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <ShoppingBag className="h-4 w-4" /> Marketplace Buyer
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Find what you need</h1>
        <p className="text-sm text-muted-foreground">
          Rent equipment, book mobile repair and insure your cargo — all in one place.
        </p>
      </div>

      <Link href="/marketplace/browse" className="block">
        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10">
              <Search className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">Browse the marketplace</div>
              <div className="text-sm text-muted-foreground">Find equipment, technicians and insurers near you</div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Browse by type</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICE_TYPES.map((t) => {
            const Icon = TYPE_ICON[t.id];
            return (
              <Link key={t.id} href={`/marketplace/browse?type=${t.id}`} className="block">
                <Card className="h-full transition-colors hover:border-primary/40">
                  <CardContent className="space-y-2 p-5">
                    <Icon className={`h-7 w-7 ${TYPE_ACCENT[t.id]}`} />
                    <div className="font-semibold">{t.label}</div>
                    <div className="text-sm text-muted-foreground">{t.blurb}</div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">My requests</h2>
        {requests.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No requests yet. Browse the marketplace to send your first request.</CardContent></Card>
        ) : (
          <div className="grid gap-2">
            {requests.map((j: any) => (
              <Link key={j.id} href={`/marketplace/order/${j.id}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <div className="font-medium">
                        {serviceTypeLabel(j.service_type)}
                        {j.subcategory ? ` · ${subcategoryLabel(j.subcategory)}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {j.location_city ?? "—"} · {j.created_at ? new Date(j.created_at).toLocaleDateString("en-CA") : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">
                        {j.quoted_amount != null ? `$${Number(j.quoted_amount).toFixed(0)}` : j.total_price ? `$${Number(j.total_price).toFixed(0)}` : "Awaiting quote"}
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
