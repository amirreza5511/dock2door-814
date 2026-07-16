"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Clock, Fuel, Gauge, Route, Timer, TrendingUp, Truck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/hooks/use-loads";
import {
  useCarrierCompanyId,
  useSettlementLoads,
  useCompanyShifts,
  useFuelSurcharges,
  useDrivers,
  loadDriverPay,
  freightOf,
} from "@/lib/hooks/use-pay-model";

const PERIODS: [number, string][] = [[7, "7d"], [30, "30d"], [90, "90d"]];

/** Reports & KPIs for a carrier company (trucking or drayage). */
export function ReportsPage({ companyType }: { companyType: "trucking_company" | "drayage_company" }) {
  const supabase = getBrowserSupabase();
  const companyId = useCarrierCompanyId(companyType);
  const deliveredQ = useSettlementLoads(companyId);
  const shiftsQ = useCompanyShifts(companyId, 90);
  const fscQ = useFuelSurcharges();
  const driversQ = useDrivers();
  const [days, setDays] = useState(30);

  const activeQ = useQuery({
    queryKey: ["loads", "active", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loads")
        .select("id,status,assigned_truck_id,accepted_driver_user_id")
        .eq("accepted_company_id", companyId as string)
        .in("status", ["Accepted", "EnRoute", "Arrived"])
        .is("archived_at", null)
        .limit(500);
      if (error) return [];
      return (data ?? []) as { id: string; status: string; assigned_truck_id: string | null }[];
    },
  });

  const trucksQ = useQuery({
    queryKey: ["fleet", "trucks", "report"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trucks").select("id,status").is("archived_at", null);
      if (error) return [];
      return (data ?? []) as { id: string; status: string | null }[];
    },
  });

  const allDelivered = deliveredQ.data ?? [];
  const shifts = shiftsQ.data ?? [];
  const fscRows = fscQ.data ?? [];
  const drivers = driversQ.data ?? [];

  const delivered = useMemo(() => {
    const since = Date.now() - days * 86_400_000;
    return allDelivered.filter((l) => (l.delivered_at ? new Date(l.delivered_at).getTime() : 0) >= since);
  }, [allDelivered, days]);

  const rateByUid = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of drivers) { const uid = d.data?.userId; if (uid) m.set(uid, Number(d.data?.defaultHourlyRate ?? 0)); }
    return m;
  }, [drivers]);

  const nameByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) { const uid = d.data?.userId; if (uid) m.set(uid, d.name || d.data?.name || "Driver"); }
    return m;
  }, [drivers]);

  const fscPercentForMonth = (iso: string | null): number => {
    if (!iso) return fscRows[0] ? Number(fscRows[0].percent) : 0;
    const key = iso.slice(0, 7);
    const row = fscRows.find((r) => (r.month || "").slice(0, 7) === key);
    return row ? Number(row.percent) : 0;
  };

  const hourlyPay = useMemo(() => {
    const since = Date.now() - days * 86_400_000;
    let total = 0;
    for (const s of shifts) {
      if (!s.ended_at) continue;
      if (new Date(s.started_at).getTime() < since) continue;
      total += (Number(s.minutes ?? 0) / 60) * (rateByUid.get(s.driver_user_id) ?? 0);
    }
    return Math.round(total);
  }, [shifts, days, rateByUid]);

  const kpis = useMemo(() => {
    let revenue = 0, cost = 0, fsc = 0, withDeadline = 0, onTime = 0;
    for (const l of delivered) {
      revenue += Number(l.provider_net ?? 0);
      cost += loadDriverPay(l) + Number(l.fuel_cost ?? 0);
      fsc += Math.round(freightOf(l) * fscPercentForMonth(l.delivered_at)) / 100;
    }
    cost += hourlyPay;
    const active = activeQ.data ?? [];
    const busyTrucks = new Set(active.filter((l) => l.assigned_truck_id).map((l) => l.assigned_truck_id as string)).size;
    const totalTrucks = (trucksQ.data ?? []).filter((t) => (t.status ?? "Active") === "Active").length;
    return {
      revenue, cost, fsc, hourlyPay, profit: revenue - cost,
      onTimePct: withDeadline > 0 ? Math.round((onTime / withDeadline) * 100) : null,
      utilization: totalTrucks > 0 ? Math.round((busyTrucks / totalTrucks) * 100) : null,
      busyTrucks, totalTrucks, activeCount: active.length, completedCount: delivered.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivered, hourlyPay, activeQ.data, trucksQ.data, fscRows]);

  const perDriver = useMemo(() => {
    const map = new Map<string, { name: string; loads: number; revenue: number; pay: number; profit: number }>();
    for (const l of delivered) {
      const key = l.accepted_driver_user_id ?? l.driver_name ?? "unknown";
      const name = l.driver_name?.trim() || (l.accepted_driver_user_id ? nameByUid.get(l.accepted_driver_user_id) : null) || "Unassigned";
      if (!map.has(key)) map.set(key, { name, loads: 0, revenue: 0, pay: 0, profit: 0 });
      const g = map.get(key)!;
      g.loads += 1;
      g.revenue += Number(l.provider_net ?? 0);
      g.pay += loadDriverPay(l);
      g.profit += Number(l.provider_net ?? 0) - loadDriverPay(l) - Number(l.fuel_cost ?? 0);
    }
    return Array.from(map.values()).sort((a, b) => b.loads - a.loads);
  }, [delivered, nameByUid]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Reports</p>
          <h1 className="text-2xl font-semibold tracking-tight">Reports &amp; KPIs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fleet performance for the last {days} days.</p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map(([d, lbl]) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${days === d ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>{lbl}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Clock className="h-4 w-4 text-green-500" />} label="On-time" value={kpis.onTimePct === null ? "—" : `${kpis.onTimePct}%`} sub="delivered by deadline" />
        <Kpi icon={<Gauge className="h-4 w-4 text-primary" />} label="Fleet use" value={kpis.utilization === null ? "—" : `${kpis.utilization}%`} sub={`${kpis.busyTrucks}/${kpis.totalTrucks} trucks`} />
        <Kpi icon={<Truck className="h-4 w-4 text-blue-500" />} label="Loads" value={`${kpis.activeCount}`} sub={`${kpis.completedCount} completed`} />
        <Kpi icon={<Route className="h-4 w-4 text-yellow-500" />} label="Completed" value={`${kpis.completedCount}`} sub="in period" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Period summary</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Row label="Revenue" value={money(kpis.revenue)} />
          <Row label={<span className="flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5 text-blue-500" />Fuel surcharge collected</span>} value={money(kpis.fsc)} valueClass="text-blue-500" />
          <Row label={<span className="flex items-center gap-1.5"><Timer className="h-3.5 w-3.5 text-primary" />Hourly pay</span>} value={`-${money(kpis.hourlyPay)}`} valueClass="text-muted-foreground" />
          <Row label="Driver + fuel cost" value={`-${money(kpis.cost)}`} valueClass="text-muted-foreground" />
          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="flex items-center gap-1.5 font-semibold"><TrendingUp className="h-4 w-4 text-green-500" />Net profit</span>
            <span className={`text-xl font-bold ${kpis.profit >= 0 ? "text-green-500" : "text-red-500"}`}>{money(kpis.profit)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Driver performance</CardTitle></CardHeader>
        <CardContent>
          {perDriver.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No completed loads in this period yet.</p>
          ) : (
            <div className="space-y-3">
              {perDriver.map((g) => (
                <div key={g.name} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">{g.name}</span>
                    <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">{g.loads} load{g.loads > 1 ? "s" : ""}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div><p className="text-[10px] uppercase text-muted-foreground">Revenue</p><p className="font-semibold">{money(g.revenue)}</p></div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Paid</p><p className="font-semibold text-primary">{money(g.pay)}</p></div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Profit</p><p className={`font-semibold ${g.profit >= 0 ? "text-green-500" : "text-red-500"}`}>{money(g.profit)}</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-1.5">{icon}<CardDescription>{label}</CardDescription></div>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent><p className="text-xs text-muted-foreground">{sub}</p></CardContent>
    </Card>
  );
}

function Row({ label, value, valueClass }: { label: React.ReactNode; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

export default function TruckingReportsPage() {
  return <ReportsPage companyType="trucking_company" />;
}
