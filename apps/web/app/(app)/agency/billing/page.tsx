"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useExplore } from "@/lib/explore-store";

interface PayableRow {
  payable_id: string;
  shift_title: string;
  shift_date: string | null;
  worker_name: string;
  confirmed_hours: number;
  hourly_rate: number;
  gross_pay: number;
  agency_fee: number;
  net_to_agency: number;
  status: string;
  invoice_status: string | null;
  paid_at: string | null;
}

type Filter = "all" | "Pending" | "Approved" | "Paid";

const STATUS_CLASS: Record<string, string> = {
  Pending: "bg-yellow-500/15 text-yellow-300",
  Approved: "bg-blue-500/15 text-blue-300",
  Paid: "bg-emerald-500/15 text-emerald-300",
  Cancelled: "bg-white/10 text-muted-foreground",
};

const SAMPLE_PAYABLES: PayableRow[] = [
  { payable_id: "ex-pay-1", shift_title: "Warehouse Loader", shift_date: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10), worker_name: "Marcus Lee", confirmed_hours: 8, hourly_rate: 24, gross_pay: 192, agency_fee: 19.2, net_to_agency: 172.8, status: "Paid", invoice_status: "Paid", paid_at: new Date(Date.now() - 86400000).toISOString() },
  { payable_id: "ex-pay-2", shift_title: "Forklift Operator", shift_date: new Date(Date.now() - 86400000 * 4).toISOString().slice(0, 10), worker_name: "Priya Sharma", confirmed_hours: 8, hourly_rate: 31, gross_pay: 248, agency_fee: 24.8, net_to_agency: 223.2, status: "Approved", invoice_status: "Issued", paid_at: null },
  { payable_id: "ex-pay-3", shift_title: "Order Picker (evening)", shift_date: new Date(Date.now() - 86400000 * 6).toISOString().slice(0, 10), worker_name: "Dan Kowalski", confirmed_hours: 7, hourly_rate: 26, gross_pay: 182, agency_fee: 18.2, net_to_agency: 163.8, status: "Pending", invoice_status: null, paid_at: null },
];

export default function AgencyBillingPage() {
  const supabase = getBrowserSupabase();
  const { isExploring } = useExplore();
  const [filter, setFilter] = useState<Filter>("all");

  const q = useQuery({
    queryKey: ["agency", "payables"],
    enabled: !isExploring,
    queryFn: async (): Promise<PayableRow[]> => {
      const { data, error } = await supabase.rpc("agency_list_payables");
      if (error) return [];
      return (data as PayableRow[] | null) ?? [];
    },
  });

  const rows = useMemo(() => (isExploring ? SAMPLE_PAYABLES : (q.data ?? [])), [q.data, isExploring]);
  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const totals = useMemo(
    () => ({
      gross: rows.reduce((s, r) => s + Number(r.gross_pay ?? 0), 0),
      fees: rows.reduce((s, r) => s + Number(r.agency_fee ?? 0), 0),
      net: rows.reduce((s, r) => s + Number(r.net_to_agency ?? 0), 0),
    }),
    [rows],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Employment Agency</p>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Shift payables routed to your agency — gross, platform premium and your net.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat value={`$${totals.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Gross pay (all shifts)" />
        <Stat value={`$${totals.fees.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Agency premium fees" />
        <Stat value={`$${totals.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Net to agency" />
      </div>

      <div className="flex gap-2">
        {(["all", "Pending", "Approved", "Paid"] as Filter[]).map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Payables ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!isExploring && q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CreditCard className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No payables yet. When your workers complete shifts, agency earnings appear here.</p>
            </div>
          ) : (
            filtered.map((r) => (
              <div key={r.payable_id} className="rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.shift_title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.worker_name}{r.shift_date ? ` · ${r.shift_date}` : ""} · {Number(r.confirmed_hours ?? 0)}h × ${Number(r.hourly_rate ?? 0).toFixed(2)}
                    </p>
                  </div>
                  <Badge className={STATUS_CLASS[r.status] ?? ""}>{r.status}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <span className="text-muted-foreground">Gross <span className="font-medium text-foreground">${Number(r.gross_pay).toFixed(2)}</span></span>
                  <span className="text-muted-foreground">Premium fee <span className="font-medium text-red-300">−${Number(r.agency_fee).toFixed(2)}</span></span>
                  <span className="text-muted-foreground">Net <span className="font-semibold text-emerald-300">${Number(r.net_to_agency).toFixed(2)}</span></span>
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
