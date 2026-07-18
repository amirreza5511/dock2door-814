"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeDollarSign } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface BillingRow {
  id: string;
  title: string;
  customer_name: string;
  cleared_at: string | null;
  fee: number;
  platform_fee: number;
  net_to_broker: number;
  invoice_status: string | null;
  currency: string;
}

export default function BrokerBillingPage() {
  const supabase = getBrowserSupabase();

  const q = useQuery({
    queryKey: ["broker", "billing"],
    queryFn: async (): Promise<BillingRow[]> => {
      const { data, error } = await supabase.rpc("broker_list_billing");
      if (error) return [];
      return (data as BillingRow[] | null) ?? [];
    },
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const totals = useMemo(
    () => ({
      fees: rows.reduce((s, r) => s + Number(r.fee ?? 0), 0),
      commission: rows.reduce((s, r) => s + Number(r.platform_fee ?? 0), 0),
      net: rows.reduce((s, r) => s + Number(r.net_to_broker ?? 0), 0),
    }),
    [rows],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Customs Broker</p>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cleared shipments — your brokerage fee, Dock2Door&apos;s commission and your net.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat value={`$${totals.fees.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Brokerage fees billed" />
        <Stat value={`$${totals.commission.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Platform commission" />
        <Stat value={`$${totals.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Net to broker" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Cleared shipments ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <BadgeDollarSign className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nothing billed yet. When you clear a shipment, the invoice and fee split appear here.</p>
            </div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.customer_name}{r.cleared_at ? ` · Cleared ${formatDate(r.cleared_at)}` : ""}</p>
                  </div>
                  <Badge className={r.invoice_status === "Paid" ? "bg-emerald-500/15 text-emerald-300" : "bg-yellow-500/15 text-yellow-300"}>
                    {r.invoice_status || "Issued"}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <span className="text-muted-foreground">Fee <span className="font-medium text-foreground">${Number(r.fee).toFixed(2)}</span></span>
                  <span className="text-muted-foreground">Commission <span className="font-medium text-red-300">−${Number(r.platform_fee).toFixed(2)}</span></span>
                  <span className="text-muted-foreground">Net <span className="font-semibold text-emerald-300">${Number(r.net_to_broker).toFixed(2)}</span></span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
