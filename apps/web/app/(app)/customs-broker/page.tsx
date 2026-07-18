"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Landmark, FileCheck2, BadgeDollarSign, ArrowRight } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface RequestRow {
  id: string;
  title: string;
  status: string;
  customer_name: string;
  created_at: string;
  [k: string]: unknown;
}

interface BillingRow {
  id: string;
  net_to_broker: number;
  [k: string]: unknown;
}

const ACTIVE_STATUSES = ["Quoted", "InProgress", "DocsRequired"];

export default function CustomsBrokerDashboardPage() {
  const supabase = getBrowserSupabase();

  const openQ = useQuery({
    queryKey: ["broker", "requests", "open"],
    refetchInterval: 30000,
    queryFn: async (): Promise<RequestRow[]> => {
      const { data, error } = await supabase.rpc("broker_list_requests", { p_scope: "open" });
      if (error) return [];
      return (data as RequestRow[] | null) ?? [];
    },
  });
  const mineQ = useQuery({
    queryKey: ["broker", "requests", "mine"],
    queryFn: async (): Promise<RequestRow[]> => {
      const { data, error } = await supabase.rpc("broker_list_requests", { p_scope: "mine" });
      if (error) return [];
      return (data as RequestRow[] | null) ?? [];
    },
  });
  const billingQ = useQuery({
    queryKey: ["broker", "billing"],
    queryFn: async (): Promise<BillingRow[]> => {
      const { data, error } = await supabase.rpc("broker_list_billing");
      if (error) return [];
      return (data as BillingRow[] | null) ?? [];
    },
  });

  const open = useMemo(() => openQ.data ?? [], [openQ.data]);
  const mine = useMemo(() => mineQ.data ?? [], [mineQ.data]);
  const active = mine.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const cleared = mine.filter((r) => r.status === "Cleared");
  const earned = (billingQ.data ?? []).reduce((s, b) => s + Number(b.net_to_broker ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Customs Broker</p>
        <h1 className="text-2xl font-semibold tracking-tight">Brokerage dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Receive clearance requests, quote, collect documents and clear shipments — all on Dock2Door.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat icon={<Inbox className="h-5 w-5 text-yellow-400" />} value={String(open.length)} label="Open requests" />
        <Stat icon={<FileCheck2 className="h-5 w-5 text-blue-400" />} value={String(active.length)} label="In progress" />
        <Stat icon={<Landmark className="h-5 w-5 text-emerald-400" />} value={String(cleared.length)} label="Cleared" />
        <Stat icon={<BadgeDollarSign className="h-5 w-5 text-primary" />} value={`$${earned.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Net earned" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/customs-broker/requests">
          <Card className="transition-colors hover:border-primary/40">
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted"><Inbox className="h-5 w-5 text-primary" /></div>
              <div className="flex-1">
                <p className="font-medium">Open pool</p>
                <p className="text-xs text-muted-foreground">{open.length} request{open.length === 1 ? "" : "s"} waiting for a broker</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/customs-broker/billing">
          <Card className="transition-colors hover:border-primary/40">
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted"><BadgeDollarSign className="h-5 w-5 text-emerald-400" /></div>
              <div className="flex-1">
                <p className="font-medium">Billing</p>
                <p className="text-xs text-muted-foreground">Fees, platform commission & net</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Active clearances</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {active.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No active clearances. Claim a request from the open pool to get started.</p>
          ) : (
            active.slice(0, 8).map((r) => (
              <Link key={r.id} href={`/customs-broker/requests/${r.id}`} className="flex items-center justify-between rounded-lg border border-white/5 bg-card/60 px-4 py-3 transition-colors hover:border-white/15">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{r.customer_name}</p>
                </div>
                <Badge>{r.status}</Badge>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted">{icon}</div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
