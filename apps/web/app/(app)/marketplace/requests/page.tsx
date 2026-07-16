"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, Send, MapPin, Clock, Building2 } from "lucide-react";
import { subcategoryLabel } from "@/lib/serviceMarketplace";

interface JobRow {
  id: string;
  service_id: string;
  customer_company_id: string;
  location_address: string | null;
  location_city: string | null;
  duration_hours: number | null;
  total_price: number | null;
  status: string;
  quote_status: string | null;
  quoted_amount: number | null;
  service_listings: {
    company_id: string;
    title: string | null;
    subcategory: string | null;
    company: { name: string | null } | null;
  } | null;
  customer: { name: string | null } | null;
}

const STATUS_BADGE: Record<string, "success" | "warning" | "secondary" | "outline"> = {
  Requested: "warning",
  Accepted: "outline",
  Scheduled: "outline",
  InProgress: "outline",
  Completed: "success",
  Cancelled: "secondary",
};

type Tab = "incoming" | "sent";

export default function MarketplaceRequestsPage() {
  const supabase = getBrowserSupabase();
  const [tab, setTab] = useState<Tab>("incoming");

  const dataQ = useQuery({
    queryKey: ["marketplace", "requests"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { incoming: [] as JobRow[], sent: [] as JobRow[] };
      const { data: membership } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      const companyId = membership?.company_id as string | undefined;
      if (!companyId) return { incoming: [] as JobRow[], sent: [] as JobRow[] };

      const select =
        "id, service_id, customer_company_id, location_address, location_city, duration_hours, total_price, status, quote_status, quoted_amount, " +
        "service_listings:service_listings!service_jobs_service_id_fkey(company_id, title, subcategory, company:companies(name)), " +
        "customer:companies!service_jobs_customer_company_id_fkey(name)";

      const { data: sent } = await supabase
        .from("service_jobs")
        .select(select)
        .eq("customer_company_id", companyId)
        .order("created_at", { ascending: false });

      const { data: myList } = await supabase
        .from("service_listings")
        .select("id")
        .eq("company_id", companyId);
      const listingIds = ((myList ?? []) as { id: string }[]).map((l) => l.id);

      let incoming: JobRow[] = [];
      if (listingIds.length > 0) {
        const { data: inc } = await supabase
          .from("service_jobs")
          .select(select)
          .in("service_id", listingIds)
          .order("created_at", { ascending: false });
        incoming = (inc ?? []) as unknown as JobRow[];
      }
      return { incoming, sent: (sent ?? []) as unknown as JobRow[] };
    },
  });

  const incoming = useMemo(() => dataQ.data?.incoming ?? [], [dataQ.data]);
  const sent = useMemo(() => dataQ.data?.sent ?? [], [dataQ.data]);
  const rows = tab === "incoming" ? incoming : sent;

  const titleFor = (j: JobRow) =>
    j.service_listings?.title || subcategoryLabel(j.service_listings?.subcategory) || "Marketplace request";
  const counterpartyFor = (j: JobRow) =>
    tab === "incoming"
      ? j.customer?.name ?? "Requesting company"
      : j.service_listings?.company?.name ?? "Provider";
  const QUOTE_LABEL: Record<string, string> = {
    requested: "Quote requested",
    quoted: "Quote sent",
    accepted: "Quote accepted",
    declined: "Quote declined",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Inbox className="h-6 w-6 text-primary" /> Requests
        </h1>
        <p className="text-sm text-muted-foreground">Marketplace bookings for your company — incoming and sent.</p>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "incoming" ? "default" : "secondary"} onClick={() => setTab("incoming")}>
          <Inbox className="mr-1 h-4 w-4" /> Incoming ({incoming.length})
        </Button>
        <Button variant={tab === "sent" ? "default" : "secondary"} onClick={() => setTab("sent")}>
          <Send className="mr-1 h-4 w-4" /> Sent ({sent.length})
        </Button>
      </div>

      {dataQ.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : dataQ.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(dataQ.error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          {tab === "incoming" ? <Inbox className="h-10 w-10 text-muted-foreground" /> : <Send className="h-10 w-10 text-muted-foreground" />}
          <p className="font-semibold">{tab === "incoming" ? "No incoming requests" : "No requests sent"}</p>
          <p className="text-sm text-muted-foreground">
            {tab === "incoming"
              ? "When another company requests one of your listings, it shows up here."
              : "Browse the marketplace and request equipment or a service to see it here."}
          </p>
          {tab === "sent" && (
            <Link href="/marketplace/browse" className="mt-2">
              <Button>Browse marketplace</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((j) => (
            <Link key={j.id} href={`/marketplace/order/${j.id}`} className="block">
            <Card className="cursor-pointer transition-colors hover:border-primary/40">
              <CardContent className="space-y-2 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold leading-tight">{titleFor(j)}</h3>
                  <Badge variant={STATUS_BADGE[j.status] ?? "secondary"}>{j.status}</Badge>
                </div>
                {j.quote_status && j.quote_status !== "none" && QUOTE_LABEL[j.quote_status] && (
                  <Badge variant="warning">{QUOTE_LABEL[j.quote_status]}{j.quoted_amount ? ` · $${j.quoted_amount.toLocaleString()}` : ""}</Badge>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" /> {counterpartyFor(j)}
                </div>
                {(j.location_city || j.location_address) && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> {[j.location_address, j.location_city].filter(Boolean).join(", ")}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> {j.duration_hours ?? 0}h
                  </span>
                  {(j.total_price ?? 0) > 0 && <span className="font-bold text-emerald-500">${j.total_price}</span>}
                </div>
              </CardContent>
            </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
