"use client";

import { useMemo, useState } from "react";
import { Coins, DollarSign, Fuel, Loader2, Timer, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money, VEHICLE_LABEL } from "@/lib/hooks/use-loads";
import {
  useCarrierCompanyId,
  useSettlementLoads,
  useCompanyShifts,
  useFuelSurcharges,
  useDrivers,
  useSetSettlement,
  useMarkSettled,
  loadDriverPay,
  freightOf,
  type SettlementLoad,
} from "@/lib/hooks/use-pay-model";

type PayType = "Percent" | "Flat" | "Hourly";

/** Driver settlement for a carrier company (trucking or drayage). */
export function SettlementPage({ companyType }: { companyType: "trucking_company" | "drayage_company" }) {
  const companyId = useCarrierCompanyId(companyType);
  const loadsQ = useSettlementLoads(companyId);
  const shiftsQ = useCompanyShifts(companyId, 90);
  const fscQ = useFuelSurcharges();
  const driversQ = useDrivers();
  const setSettlement = useSetSettlement();
  const markSettled = useMarkSettled();

  const [editing, setEditing] = useState<SettlementLoad | null>(null);
  const [payType, setPayType] = useState<PayType>("Percent");
  const [payValue, setPayValue] = useState("");
  const [fuel, setFuel] = useState("");
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loads = loadsQ.data ?? [];
  const shifts = shiftsQ.data ?? [];
  const fscRows = fscQ.data ?? [];
  const drivers = driversQ.data ?? [];

  const fscPercentForMonth = (iso: string | null): number => {
    if (!iso) return fscRows[0] ? Number(fscRows[0].percent) : 0;
    const key = iso.slice(0, 7);
    const row = fscRows.find((r) => (r.month || "").slice(0, 7) === key);
    return row ? Number(row.percent) : 0;
  };

  const hoursByUid = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shifts) {
      if (!s.ended_at) continue;
      const mins = Number(s.minutes ?? 0);
      if (mins <= 0) continue;
      m.set(s.driver_user_id, (m.get(s.driver_user_id) ?? 0) + mins / 60);
    }
    return m;
  }, [shifts]);

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

  const hourlyForUid = (uid: string | null): number => {
    if (!uid) return 0;
    return Math.round((hoursByUid.get(uid) ?? 0) * (rateByUid.get(uid) ?? 0));
  };

  const totals = useMemo(() => {
    let revenue = 0, pay = 0, fuelCost = 0, fsc = 0;
    for (const l of loads) {
      revenue += Number(l.provider_net ?? 0);
      pay += loadDriverPay(l);
      fuelCost += Number(l.fuel_cost ?? 0);
      fsc += Math.round(freightOf(l) * fscPercentForMonth(l.delivered_at)) / 100;
    }
    const uids = new Set<string>();
    for (const l of loads) if (l.accepted_driver_user_id) uids.add(l.accepted_driver_user_id);
    let hourly = 0;
    for (const uid of uids) hourly += hourlyForUid(uid);
    pay += hourly;
    return { revenue, pay, fuelCost, fsc, hourly, profit: revenue - pay - fuelCost };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loads, fscRows, hoursByUid, rateByUid]);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; uid: string | null; loads: SettlementLoad[] }>();
    for (const l of loads) {
      const key = l.accepted_driver_user_id ?? l.driver_name ?? "unknown";
      const name = l.driver_name?.trim() || (l.accepted_driver_user_id ? nameByUid.get(l.accepted_driver_user_id) : null) || "Unassigned";
      if (!map.has(key)) map.set(key, { name, uid: l.accepted_driver_user_id, loads: [] });
      map.get(key)!.loads.push(l);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [loads, nameByUid]);

  const openEdit = (l: SettlementLoad) => {
    setError(null);
    let pt: PayType = (l.driver_pay_type as PayType) || "Percent";
    let pv = l.driver_pay_value != null ? String(l.driver_pay_value) : "";
    if (!l.driver_pay_type && l.accepted_driver_user_id) {
      const d = drivers.find((x) => x.data?.userId === l.accepted_driver_user_id);
      if (d?.data?.driverType === "Company") { pt = "Hourly"; pv = String(rateByUid.get(l.accepted_driver_user_id) ?? ""); }
    }
    setPayType(pt);
    setPayValue(pv);
    setFuel(l.fuel_cost != null ? String(l.fuel_cost) : "");
    setEditing(l);
  };

  const save = async () => {
    if (!editing) return;
    setError(null);
    const val = payValue.trim() === "" ? null : Number(payValue);
    if (val != null && (!Number.isFinite(val) || val < 0)) { setError("Enter a valid amount."); return; }
    const fuelVal = fuel.trim() === "" ? null : Number(fuel);
    try {
      await setSettlement.mutateAsync({ id: editing.id, payType: val == null ? null : payType, payValue: val, fuelCost: fuelVal });
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Settlement</p>
        <h1 className="text-2xl font-semibold tracking-tight">Driver settlement</h1>
        <p className="mt-1 text-sm text-muted-foreground">{loads.length} delivered · pay drivers and see per-trip profit.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={<DollarSign className="h-4 w-4 text-green-500" />} label="Revenue" value={money(totals.revenue)} />
        <Stat icon={<Coins className="h-4 w-4 text-primary" />} label="Driver pay" value={money(totals.pay)} />
        <Stat icon={<Fuel className="h-4 w-4 text-yellow-500" />} label="Fuel" value={money(totals.fuelCost)} />
        <Stat icon={<Fuel className="h-4 w-4 text-blue-500" />} label="Fuel surcharge" value={money(totals.fsc)} />
        <Stat icon={<Timer className="h-4 w-4 text-primary" />} label="Hourly pay" value={money(totals.hourly)} />
        <Stat icon={<TrendingUp className="h-4 w-4 text-green-500" />} label="Profit" value={money(totals.profit)} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} />
        Only unpaid loads
      </label>

      {loadsQ.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></p>
      ) : groups.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No delivered loads yet. Once drivers complete deliveries, settle their pay here.</CardContent></Card>
      ) : (
        groups.map((g) => {
          const gLoads = onlyUnpaid ? g.loads.filter((l) => !l.driver_settled) : g.loads;
          if (gLoads.length === 0) return null;
          const gHourly = hourlyForUid(g.uid);
          const gHours = g.uid ? (hoursByUid.get(g.uid) ?? 0) : 0;
          const gPay = gLoads.reduce((s, l) => s + loadDriverPay(l), 0) + gHourly;
          return (
            <Card key={g.name}>
              <CardHeader>
                <CardTitle className="text-base">{g.name}</CardTitle>
                <CardDescription>
                  {gLoads.length} load{gLoads.length > 1 ? "s" : ""} · {money(gPay)} pay{gHourly > 0 ? ` · ${gHours.toFixed(1)}h hourly` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {gLoads.map((l) => {
                  const pay = loadDriverPay(l);
                  const profit = Number(l.provider_net ?? 0) - pay - Number(l.fuel_cost ?? 0);
                  return (
                    <div key={l.id} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-400">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type}</span>
                        <span className="truncate text-xs text-muted-foreground">{(l.pickup_address || "Pickup")} → {(l.dropoff_address || "Drop-off")}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-sm">
                        <Fig label="Revenue" value={money(Number(l.provider_net ?? 0))} />
                        <Fig label="Driver" value={money(pay)} accent />
                        <Fig label="Fuel" value={money(Number(l.fuel_cost ?? 0))} />
                        <Fig label="Profit" value={money(profit)} green={profit >= 0} />
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(l)}>
                          {l.driver_pay_type ? (l.driver_pay_type === "Percent" ? `${l.driver_pay_value}%` : l.driver_pay_type === "Flat" ? money(Number(l.driver_pay_value)) : "Hourly") : "Set pay"}
                        </Button>
                        <Button
                          size="sm"
                          variant={l.driver_settled ? "secondary" : "outline"}
                          disabled={markSettled.isPending}
                          onClick={() => markSettled.mutate({ id: l.id, settled: !l.driver_settled })}
                        >
                          {l.driver_settled ? "Paid" : "Mark paid"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold">Driver pay plan</h2>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>✕</Button>
            </div>
            {error && <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
            <div className="mb-4 flex gap-2">
              {(["Percent", "Flat", "Hourly"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPayType(t)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${payType === t ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
                >
                  {t === "Percent" ? "% of net" : t === "Flat" ? "Flat rate" : "Hourly"}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>{payType === "Percent" ? "Percent of carrier net (%)" : payType === "Flat" ? "Flat trip amount ($)" : "Hourly rate ($/h)"}</Label>
              <Input value={payValue} onChange={(e) => setPayValue(e.target.value)} placeholder={payType === "Percent" ? "e.g. 70" : payType === "Flat" ? "e.g. 850" : "e.g. 28"} inputMode="decimal" />
            </div>
            {payType === "Hourly" && (
              <p className="mt-2 text-xs text-muted-foreground">Hourly drivers are paid from their logged shift hours × this rate. The per-load figure stays $0; hourly pay is summed per driver from the shift clock.</p>
            )}
            <div className="mt-3 space-y-1.5">
              <Label>Fuel cost for this trip ($)</Label>
              <Input value={fuel} onChange={(e) => setFuel(e.target.value)} placeholder="e.g. 220" inputMode="decimal" />
            </div>
            <Button className="mt-4 w-full" disabled={setSettlement.isPending} onClick={() => void save()}>
              {setSettlement.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save pay plan
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        {icon}
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function Fig({ label, value, accent, green }: { label: string; value: string; accent?: boolean; green?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-semibold ${accent ? "text-primary" : green === true ? "text-green-500" : green === false ? "text-red-500" : ""}`}>{value}</p>
    </div>
  );
}

export default function TruckingSettlementPage() {
  return <SettlementPage companyType="trucking_company" />;
}
