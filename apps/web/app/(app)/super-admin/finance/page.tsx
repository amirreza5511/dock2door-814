"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Wallet, Zap, CircleDollarSign, TrendingUp, Truck, Warehouse, Wrench,
  CircleCheck, Clock, Building2, User, Megaphone, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type PaymentsMode = "sandbox" | "stripe" | "off";
type Kind = "drayage" | "warehouse" | "service";

interface UnsettledRow { id: string; kind: Kind; amount: number; createdAt: string }
interface PayoutRow { id: string; net_amount: number; status: string; companyName: string }
interface PayableRow { id: string; gross_pay: number; status: string; workerName: string }

interface AnyRecord { [k: string]: unknown }

const money = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const KIND_ICON: Record<Kind, typeof Truck> = { drayage: Truck, warehouse: Warehouse, service: Wrench };

export default function SuperAdminFinancePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ["sa-finance", "settings"],
    queryFn: async () => {
      const { data } = await supabase.from("platform_settings").select("*").limit(1).maybeSingle();
      const row = (data ?? {}) as AnyRecord;
      return { paymentsMode: (row.payments_mode as string) ?? "sandbox" };
    },
  });

  const overviewQ = useQuery({
    queryKey: ["sa-finance", "overview"],
    queryFn: async () => {
      const [paymentsRes, payoutsRes, payablesRes, commissionsRes, invoicesRes] = await Promise.all([
        supabase.from("payments").select("gross_amount,commission_amount,net_amount,status,category"),
        supabase.from("payouts").select("net_amount,status").is("archived_at", null),
        supabase.from("worker_payables").select("gross_pay,status"),
        supabase.from("commission_entries").select("amount,status"),
        supabase.from("invoices").select("id,status"),
      ]);
      const settled = ["Paid", "Captured"];
      const payments = (paymentsRes.data as AnyRecord[] | null) ?? [];
      const captured = payments.filter((p) => settled.includes(String(p.status)));
      const collected = captured.reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);
      const revenue = captured.reduce((s, p) => s + Number(p.commission_amount ?? 0), 0);
      const byCategory: Record<string, number> = {};
      for (const p of captured) {
        const key = String(p.category ?? "other");
        byCategory[key] = (byCategory[key] ?? 0) + Number(p.commission_amount ?? 0);
      }
      const payouts = (payoutsRes.data as AnyRecord[] | null) ?? [];
      const payables = (payablesRes.data as AnyRecord[] | null) ?? [];
      const commissions = (commissionsRes.data as AnyRecord[] | null) ?? [];
      const invoices = (invoicesRes.data as AnyRecord[] | null) ?? [];
      const sum = (rows: AnyRecord[], field: string, statuses: string[]) =>
        rows.filter((r) => statuses.includes(String(r.status))).reduce((s, r) => s + Number(r[field] ?? 0), 0);
      return {
        collected: Math.round(collected),
        revenue: Math.round(revenue),
        revenueByCategory: byCategory,
        providerPayoutsPending: Math.round(sum(payouts, "net_amount", ["Pending", "Processing"])),
        workerPayoutsPending: Math.round(sum(payables, "gross_pay", ["Pending", "Approved"])),
        agentCommissionsPending: Math.round(sum(commissions, "amount", ["Pending", "Approved"])),
      };
    },
  });

  const unsettledQ = useQuery({
    queryKey: ["sa-finance", "unsettled"],
    queryFn: async (): Promise<UnsettledRow[]> => {
      const [orders, bookings, jobs, invoices] = await Promise.all([
        supabase.from("drayage_orders").select("id,status,total_price,created_at").in("status", ["Delivered", "EmptyReturned"]),
        supabase.from("warehouse_bookings").select("id,status,final_price,counter_offer_price,proposed_price,created_at").in("status", ["Completed", "InProgress"]),
        supabase.from("service_jobs").select("id,status,total_price,created_at").eq("status", "Completed"),
        supabase.from("invoices").select("drayage_order_id,booking_id,service_job_id"),
      ]);
      const inv = (invoices.data as AnyRecord[] | null) ?? [];
      const invDray = new Set(inv.map((i) => String(i.drayage_order_id)).filter((x) => x !== "null"));
      const invBook = new Set(inv.map((i) => String(i.booking_id)).filter((x) => x !== "null"));
      const invJob = new Set(inv.map((i) => String(i.service_job_id)).filter((x) => x !== "null"));
      const dray = ((orders.data as AnyRecord[] | null) ?? [])
        .filter((o) => Number(o.total_price ?? 0) > 0 && !invDray.has(String(o.id)))
        .map((o) => ({ id: String(o.id), kind: "drayage" as const, amount: Number(o.total_price ?? 0), createdAt: String(o.created_at) }));
      const book = ((bookings.data as AnyRecord[] | null) ?? [])
        .map((b) => ({ id: String(b.id), amount: Number(b.final_price ?? b.counter_offer_price ?? b.proposed_price ?? 0), createdAt: String(b.created_at) }))
        .filter((b) => b.amount > 0 && !invBook.has(b.id))
        .map((b) => ({ id: b.id, kind: "warehouse" as const, amount: b.amount, createdAt: b.createdAt }));
      const job = ((jobs.data as AnyRecord[] | null) ?? [])
        .filter((j) => Number(j.total_price ?? 0) > 0 && !invJob.has(String(j.id)))
        .map((j) => ({ id: String(j.id), kind: "service" as const, amount: Number(j.total_price ?? 0), createdAt: String(j.created_at) }));
      return [...dray, ...book, ...job].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
  });

  const payoutsQ = useQuery({
    queryKey: ["sa-finance", "payouts"],
    queryFn: async (): Promise<PayoutRow[]> => {
      const { data } = await supabase.from("payouts").select("*").is("archived_at", null).order("created_at", { ascending: false }).limit(200);
      const rows = (data as AnyRecord[] | null) ?? [];
      const ids = Array.from(new Set(rows.map((r) => r.company_id as string).filter(Boolean)));
      const { data: companies } = ids.length ? await supabase.from("companies").select("id,name").in("id", ids) : { data: [] as AnyRecord[] };
      const nameMap = new Map(((companies as AnyRecord[] | null) ?? []).map((c) => [c.id as string, c.name as string]));
      return rows.map((r) => ({ id: String(r.id), net_amount: Number(r.net_amount ?? 0), status: String(r.status ?? ""), companyName: nameMap.get(r.company_id as string) ?? "Provider" }));
    },
  });

  const payablesQ = useQuery({
    queryKey: ["sa-finance", "payables"],
    queryFn: async (): Promise<PayableRow[]> => {
      const { data } = await supabase.from("worker_payables").select("*").order("created_at", { ascending: false }).limit(200);
      const rows = (data as AnyRecord[] | null) ?? [];
      const ids = Array.from(new Set(rows.map((r) => r.worker_user_id as string).filter(Boolean)));
      const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,name").in("id", ids) : { data: [] as AnyRecord[] };
      const nameMap = new Map(((profiles as AnyRecord[] | null) ?? []).map((p) => [p.id as string, p.name as string]));
      return rows.map((r) => ({ id: String(r.id), gross_pay: Number(r.gross_pay ?? 0), status: String(r.status ?? ""), workerName: nameMap.get(r.worker_user_id as string) ?? "Worker" }));
    },
  });

  const refetchAll = useCallback(() => { qc.invalidateQueries({ queryKey: ["sa-finance"] }); }, [qc]);

  const setModeM = useMutation({
    mutationFn: async (mode: PaymentsMode) => {
      const { error } = await supabase.rpc("admin_set_payments_mode", { p_mode: mode });
      if (error) throw error;
    },
    onSuccess: refetchAll,
  });
  const settleAllM = useMutation({
    mutationFn: async () => {
      for (const row of unsettled) {
        const rpc = row.kind === "drayage" ? ["settle_drayage_order", { p_order_id: row.id }] as const
          : row.kind === "warehouse" ? ["settle_booking_invoice", { p_booking_id: row.id }] as const
          : ["settle_service_job_invoice", { p_job_id: row.id }] as const;
        await supabase.rpc(rpc[0], rpc[1]);
      }
    },
    onSuccess: refetchAll,
  });
  const settleOneM = useMutation({
    mutationFn: async (row: UnsettledRow) => {
      const rpc = row.kind === "drayage" ? ["settle_drayage_order", { p_order_id: row.id }] as const
        : row.kind === "warehouse" ? ["settle_booking_invoice", { p_booking_id: row.id }] as const
        : ["settle_service_job_invoice", { p_job_id: row.id }] as const;
      const { error } = await supabase.rpc(rpc[0], rpc[1]);
      if (error) throw error;
    },
    onSuccess: refetchAll,
  });
  const runPayoutM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("sandbox_pay_payout", { p_payout_id: id });
      if (error) throw error;
    },
    onSuccess: refetchAll,
  });
  const runAllPayoutsM = useMutation({
    mutationFn: async () => { for (const p of payouts) await supabase.rpc("sandbox_pay_payout", { p_payout_id: p.id }); },
    onSuccess: refetchAll,
  });
  const payWorkerM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("sandbox_pay_worker", { p_payable_id: id });
      if (error) throw error;
    },
    onSuccess: refetchAll,
  });

  const mode = (settingsQ.data?.paymentsMode as PaymentsMode | undefined) ?? "sandbox";
  const overview = overviewQ.data;
  const revenueByCategory = (overview?.revenueByCategory ?? {}) as Record<string, number>;
  const unsettled = useMemo(() => unsettledQ.data ?? [], [unsettledQ.data]);
  const payouts = useMemo(() => (payoutsQ.data ?? []).filter((p) => p.status !== "Paid"), [payoutsQ.data]);
  const payables = useMemo(() => (payablesQ.data ?? []).filter((p) => p.status !== "Paid" && p.status !== "Cancelled"), [payablesQ.data]);

  const changeMode = (next: PaymentsMode) => {
    if (next === "stripe") { window.alert("Real card payments need a Stripe key, which isn't connected yet. Keep using the internal sandbox for testing."); return; }
    setModeM.mutate(next);
  };
  const settleOne = (row: UnsettledRow) => {
    setBusy(row.id);
    settleOneM.mutate(row, { onSettled: () => setBusy(null) });
  };

  const isLoading = settingsQ.isLoading || overviewQ.isLoading;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments &amp; Finance</h1>
          <p className="text-sm text-muted-foreground">Internal sandbox engine — simulate money movement without a real gateway.</p>
        </div>
        <Button size="sm" variant="outline" onClick={refetchAll}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh</Button>
      </div>

      {isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading finance…</p>
      ) : (
        <>
          {/* Payment engine */}
          <Card>
            <CardContent className="space-y-4 py-5">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10"><Wallet className="h-4 w-4 text-primary" /></div>
                <div>
                  <p className="text-base font-semibold">Payment engine</p>
                  <p className="text-xs text-muted-foreground">Simulate money movement without a real gateway.</p>
                </div>
              </div>
              <div className="flex gap-2">
                {(["sandbox", "stripe", "off"] as const).map((m) => {
                  const active = mode === m;
                  const label = m === "sandbox" ? "Sandbox" : m === "stripe" ? "Stripe (off)" : "Off";
                  return (
                    <button key={m} onClick={() => changeMode(m)} disabled={setModeM.isPending}
                      className={`flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
                        active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
                      } ${m === "stripe" ? "opacity-60" : ""}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3">
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  {mode === "sandbox" ? "Sandbox on — invoices, payments and payouts are simulated. No real money moves."
                    : mode === "off" ? "Payments are off — nothing will settle automatically."
                    : "Stripe selected but not connected."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Overview */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={<CircleDollarSign className="h-4 w-4 text-emerald-500" />} label="Collected" value={money(overview?.collected ?? 0)} tone="text-emerald-500" />
            <StatTile icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Platform revenue" value={money(overview?.revenue ?? 0)} tone="text-primary" />
            <StatTile icon={<Building2 className="h-4 w-4 text-blue-400" />} label="Provider payouts due" value={money(overview?.providerPayoutsPending ?? 0)} tone="text-blue-400" />
            <StatTile icon={<User className="h-4 w-4 text-amber-500" />} label="Worker pay due" value={money(overview?.workerPayoutsPending ?? 0)} tone="text-amber-500" />
          </div>

          {/* Revenue by area */}
          {Object.keys(revenueByCategory).length > 0 && (
            <Card>
              <CardContent className="space-y-2 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by area</p>
                {Object.entries(revenueByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                  <div key={cat} className="flex items-center justify-between">
                    <span className="text-sm capitalize">{cat}</span>
                    <span className="text-sm font-semibold">{money(amt)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Settle queue */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Settle completed jobs</h2>
              {unsettled.length > 0 && (
                <Button size="sm" disabled={settleAllM.isPending} onClick={() => settleAllM.mutate()}>
                  <Zap className="mr-1 h-3.5 w-3.5" /> {settleAllM.isPending ? "Settling…" : `Settle all (${unsettled.length})`}
                </Button>
              )}
            </div>
            {unsettled.length === 0 ? (
              <Card><CardContent className="flex items-center gap-2 py-4"><CircleCheck className="h-5 w-5 text-emerald-500" /><span className="text-sm text-muted-foreground">Everything completed has been billed.</span></CardContent></Card>
            ) : unsettled.map((row) => {
              const Icon = KIND_ICON[row.kind];
              return (
                <Card key={`${row.kind}-${row.id}`}>
                  <CardContent className="flex items-center gap-3 py-3">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize">{row.kind}</p>
                      <p className="text-xs text-muted-foreground">{money(row.amount)}</p>
                    </div>
                    <Button size="sm" variant="outline" disabled={busy === row.id} onClick={() => settleOne(row)}>{busy === row.id ? "…" : "Settle"}</Button>
                  </CardContent>
                </Card>
              );
            })}
          </section>

          {/* Provider payouts */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Provider payouts</h2>
              {payouts.length > 0 && (
                <Button size="sm" disabled={runAllPayoutsM.isPending} onClick={() => runAllPayoutsM.mutate()}>
                  <CircleCheck className="mr-1 h-3.5 w-3.5" /> {runAllPayoutsM.isPending ? "Paying…" : `Pay all (${payouts.length})`}
                </Button>
              )}
            </div>
            {payouts.length === 0 ? (
              <Card><CardContent className="flex items-center gap-2 py-4"><CircleCheck className="h-5 w-5 text-emerald-500" /><span className="text-sm text-muted-foreground">No provider payouts pending.</span></CardContent></Card>
            ) : payouts.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-500/10"><Building2 className="h-4 w-4 text-blue-400" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{p.companyName}</p>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-500"><Clock className="h-3 w-3" />{p.status}</span>
                  </div>
                  <span className="text-sm font-bold">{money(p.net_amount)}</span>
                  <Button size="sm" variant="outline" disabled={runPayoutM.isPending} onClick={() => runPayoutM.mutate(p.id)}>Pay</Button>
                </CardContent>
              </Card>
            ))}
          </section>

          {/* Worker pay */}
          {payables.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Worker pay</h2>
              {payables.map((p) => (
                <Card key={p.id}>
                  <CardContent className="flex items-center gap-3 py-3">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/10"><User className="h-4 w-4 text-amber-500" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{p.workerName}</p>
                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-500"><Clock className="h-3 w-3" />{p.status}</span>
                    </div>
                    <span className="text-sm font-bold">{money(p.gross_pay)}</span>
                    <Button size="sm" variant="outline" disabled={payWorkerM.isPending} onClick={() => payWorkerM.mutate(p.id)}>Pay</Button>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {/* Related */}
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Related</h2>
            <Link href="/admin/sales-agents" className="block">
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10"><TrendingUp className="h-4 w-4 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Sales agents &amp; commissions</p>
                    <p className="text-xs text-muted-foreground">Agent payouts: {money(overview?.agentCommissionsPending ?? 0)} pending</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/super-admin/ads" className="block">
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10"><Megaphone className="h-4 w-4 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Advertising payments</p>
                    <p className="text-xs text-muted-foreground">Approve paid ads to bill &amp; activate them</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <div>{icon}</div>
        <p className={`text-xl font-bold tracking-tight ${tone ?? ""}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
