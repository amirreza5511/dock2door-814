"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Star } from "lucide-react";
import {
  serviceTypeLabel, subcategoryLabel, type ServiceType,
} from "@/lib/serviceMarketplace";

interface Listing {
  id: string;
  service_type: ServiceType;
  subcategory: string | null;
  title: string | null;
  description: string | null;
  hourly_rate: number | null;
  per_job_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  cargo_rate_percent: number | null;
  min_premium: number | null;
  negotiable: boolean | null;
}

const TYPE_BADGE: Record<ServiceType, "success" | "warning" | "secondary"> = {
  service: "success",
  equipment_rental: "warning",
  mobile_repair: "secondary",
  cargo_insurance: "warning",
};

function priceLabel(l: Listing): string {
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

export default function ProviderProfilePage() {
  const supabase = getBrowserSupabase();
  const params = useParams<{ id: string }>();
  const companyId = params.id;

  const profileQ = useQuery({
    queryKey: ["marketplace", "provider", companyId],
    queryFn: async () => {
      const [{ data: company }, { data: listings }, { data: reviews }] = await Promise.all([
        supabase.from("companies").select("id,name,city").eq("id", companyId).maybeSingle(),
        supabase
          .from("service_listings")
          .select("*")
          .eq("company_id", companyId)
          .eq("status", "Active")
          .order("created_at", { ascending: false }),
        supabase.from("reviews").select("rating").eq("target_id", companyId),
      ]);
      const rows = reviews ?? [];
      const reviewCount = rows.length;
      const rating = reviewCount > 0 ? rows.reduce((s, r) => s + Number(r.rating ?? 0), 0) / reviewCount : 0;
      return {
        company: company as { id: string; name: string; city: string | null } | null,
        listings: (listings ?? []) as Listing[],
        rating: Math.round(rating * 10) / 10,
        reviewCount,
      };
    },
  });

  const data = profileQ.data;
  const listings = useMemo(() => data?.listings ?? [], [data]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {profileQ.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading provider…</p>
      ) : !data?.company ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Provider not found.</p>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                <Building2 className="h-8 w-8" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{data.company.name}</h1>
              {data.company.city && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" /> {data.company.city}
                </div>
              )}
              <div className="mt-2 flex items-center gap-6">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-xl font-bold">
                    <Star className="h-5 w-5 text-amber-500" fill={data.reviewCount > 0 ? "currentColor" : "none"} />
                    {data.reviewCount > 0 ? data.rating.toFixed(1) : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">{data.reviewCount} reviews</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold">{listings.length}</div>
                  <div className="text-xs text-muted-foreground">listings</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div>
            <h2 className="mb-3 text-lg font-semibold">Listings</h2>
            {listings.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No active listings.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {listings.map((l) => (
                  <Link key={l.id} href={`/marketplace/browse?type=${l.service_type}`} className="block">
                    <Card className="cursor-pointer transition-colors hover:border-primary/40">
                      <CardContent className="space-y-2 p-5">
                        <Badge variant={TYPE_BADGE[l.service_type]}>{serviceTypeLabel(l.service_type)}</Badge>
                        <h3 className="font-semibold leading-tight">
                          {l.title || subcategoryLabel(l.subcategory) || serviceTypeLabel(l.service_type)}
                        </h3>
                        {l.description && <p className="line-clamp-2 text-sm text-muted-foreground">{l.description}</p>}
                        <span className="font-bold text-emerald-500">{priceLabel(l)}</span>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
