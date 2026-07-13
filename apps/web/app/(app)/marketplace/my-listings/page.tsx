"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tag, Plus, MapPin } from "lucide-react";
import {
  serviceTypeLabel, subcategoryLabel, type ServiceType,
} from "@/lib/serviceMarketplace";

interface Listing {
  id: string;
  service_type: ServiceType | null;
  subcategory: string | null;
  title: string | null;
  status: string;
  coverage_area: string[] | null;
  hourly_rate: number | null;
  per_job_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  negotiable: boolean | null;
}

const TYPE_BADGE: Record<ServiceType, "success" | "warning" | "secondary"> = {
  service: "success",
  equipment_rental: "warning",
  mobile_repair: "secondary",
  cargo_insurance: "warning",
};

function priceLabel(l: Listing): string {
  if (l.service_type === "equipment_rental") {
    if (l.daily_rate) return `$${l.daily_rate}/day`;
    if (l.weekly_rate) return `$${l.weekly_rate}/wk`;
  }
  if (l.hourly_rate) return `$${l.hourly_rate}/hr`;
  if (l.per_job_rate) return `$${l.per_job_rate}/job`;
  return l.negotiable ? "Negotiable" : "—";
}

export default function MyListingsPage() {
  const supabase = getBrowserSupabase();

  const listingsQ = useQuery({
    queryKey: ["marketplace", "my-listings"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as Listing[];
      const { data: membership } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      const companyId = membership?.company_id as string | undefined;
      if (!companyId) return [] as Listing[];
      const { data, error } = await supabase
        .from("service_listings")
        .select("id, service_type, subcategory, title, status, coverage_area, hourly_rate, per_job_rate, daily_rate, weekly_rate, negotiable")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Listing[];
    },
  });

  const listings = useMemo(() => listingsQ.data ?? [], [listingsQ.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Tag className="h-6 w-6 text-primary" /> My listings
          </h1>
          <p className="text-sm text-muted-foreground">Everything your company has published on the marketplace.</p>
        </div>
        <Link href="/marketplace/create">
          <Button><Plus className="mr-1 h-4 w-4" /> New listing</Button>
        </Link>
      </div>

      {listingsQ.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : listingsQ.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(listingsQ.error as Error).message}
        </div>
      ) : listings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Tag className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">No listings yet</p>
          <p className="text-sm text-muted-foreground">Publish equipment, mobile repair or a service to start getting requests.</p>
          <Link href="/marketplace/create" className="mt-2">
            <Button><Plus className="mr-1 h-4 w-4" /> Post a listing</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => {
            const type = (l.service_type ?? "service") as ServiceType;
            return (
              <Card key={l.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <Badge variant={TYPE_BADGE[type]}>{serviceTypeLabel(type)}</Badge>
                    <Badge variant={l.status === "Active" ? "success" : "secondary"}>{l.status}</Badge>
                  </div>
                  <h3 className="font-semibold leading-tight">
                    {l.title || subcategoryLabel(l.subcategory) || serviceTypeLabel(type)}
                  </h3>
                  {(l.coverage_area ?? []).length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" /> {(l.coverage_area ?? []).join(" · ")}
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-border pt-3">
                    <span className="text-lg font-bold text-emerald-500">{priceLabel(l)}</span>
                    {l.negotiable && <Badge variant="secondary">Negotiable</Badge>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
