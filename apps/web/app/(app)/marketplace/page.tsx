"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import {
  Store, Search, Plus, Tag, Inbox, ChevronRight, Wrench, Forklift, Hammer, ShieldCheck,
} from "lucide-react";
import { SERVICE_TYPES, type ServiceType } from "@/lib/serviceMarketplace";

const TYPE_ICON: Record<ServiceType, typeof Wrench> = {
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

export default function MarketplaceHomePage() {
  const supabase = getBrowserSupabase();

  const statsQ = useQuery({
    queryKey: ["marketplace", "home-stats"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { myListings: 0, incoming: 0, sent: 0 };
      const { data: membership } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      const companyId = membership?.company_id as string | undefined;
      if (!companyId) return { myListings: 0, incoming: 0, sent: 0 };

      const { data: myList } = await supabase
        .from("service_listings")
        .select("id")
        .eq("company_id", companyId);
      const listingIds = (myList ?? []).map((l) => l.id as string);

      const { count: sentCount } = await supabase
        .from("service_jobs")
        .select("id", { count: "exact", head: true })
        .eq("customer_company_id", companyId);

      let incomingCount = 0;
      if (listingIds.length > 0) {
        const { count } = await supabase
          .from("service_jobs")
          .select("id", { count: "exact", head: true })
          .in("service_id", listingIds);
        incomingCount = count ?? 0;
      }
      return {
        myListings: listingIds.length,
        incoming: incomingCount,
        sent: sentCount ?? 0,
      };
    },
  });

  const stats = statsQ.data ?? { myListings: 0, incoming: 0, sent: 0 };

  const cards = useMemo(() => [
    { href: "/marketplace/create", icon: Plus, title: "Post a listing", desc: "Rent out equipment or offer a service", accent: "text-emerald-500" },
    { href: "/marketplace/my-listings", icon: Tag, title: "My listings", desc: `${stats.myListings} published`, accent: "text-primary" },
    { href: "/marketplace/requests", icon: Inbox, title: "Requests", desc: `${stats.incoming} incoming · ${stats.sent} sent`, accent: "text-blue-500" },
  ], [stats]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Store className="h-6 w-6 text-amber-500" /> Rentals &amp; Services
        </h1>
        <p className="text-sm text-muted-foreground">
          Rent equipment, book mobile repair and post services across every company on Dock2Door.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "My listings", value: stats.myListings },
          { label: "Incoming requests", value: stats.incoming },
          { label: "My requests", value: stats.sent },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="text-3xl font-bold">{s.value}</div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Link href="/marketplace/browse" className="block">
        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10">
              <Search className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">Browse the marketplace</div>
              <div className="text-sm text-muted-foreground">Find equipment, mobile repair techs and services near you</div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Browse by type</h2>
        <div className="grid gap-4 sm:grid-cols-3">
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
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Manage</h2>
        <div className="grid gap-3">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.href} href={c.href} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent">
                      <Icon className={`h-5 w-5 ${c.accent}`} />
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
      </div>
    </div>
  );
}
