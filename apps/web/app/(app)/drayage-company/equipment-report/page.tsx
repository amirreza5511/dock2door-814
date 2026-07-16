"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Layers, DollarSign, AlertTriangle, Truck } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { Card, CardContent } from "@/components/ui/card";
import { orderCharges, chargeChipLabel } from "@/lib/drayage-charges";

const URGENCY_TEXT: Record<string, string> = { over: "text-red-400", soon: "text-yellow-400", ok: "text-emerald-400", none: "text-muted-foreground" };
const URGENCY_BG: Record<string, string> = { over: "bg-red-500/15", soon: "bg-yellow-500/15", ok: "bg-emerald-500/15", none: "bg-muted" };

export default function DrayageEquipmentReportPage() {
  const supabase = getBrowserSupabase();
  const companyId = useActiveCompanyId("DrayageCompany") ?? null;

  const equipQ = useQuery({
    queryKey: ["dc", "equipment-report", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [ch, tr, ord] = await Promise.all([
        supabase.from("chassis").select("*").eq("company_id", companyId).is("archived_at", null),
        supabase.from("trailers").select("*").eq("company_id", companyId).is("archived_at", null),
        supabase.from("drayage_orders").select("*").eq("drayage_company_id", companyId).order("created_at", { ascending: false }).limit(200),
      ]);
      return {
        chassis: (ch.data as Record<string, unknown>[] | null) ?? [],
        trailers: (tr.data as Record<string, unknown>[] | null) ?? [],
        orders: (ord.data as Record<string, unknown>[] | null) ?? [],
      };
    },
  });

  const chassis = useMemo(() => equipQ.data?.chassis ?? [], [equipQ.data]);
  const trailers = useMemo(() => equipQ.data?.trailers ?? [], [equipQ.data]);
  const orders = useMemo(() => equipQ.data?.orders ?? [], [equipQ.data]);

  const all = useMemo(() => [...chassis, ...trailers], [chassis, trailers]);
  const rentalMonthly = useMemo(() => all.filter((e) => e.is_rental).reduce((s, e) => s + (Number(e.rental_daily_rate) || 0) * 30, 0), [all]);
  const rentedCount = useMemo(() => all.filter((e) => e.is_rental).length, [all]);
  const attachedCount = useMemo(() => all.filter((e) => !e.is_dropped && e.current_truck_id).length, [all]);
  const droppedCount = useMemo(() => all.filter((e) => e.is_dropped).length, [all]);

  const accessorials = useMemo(() => {
    let total = 0;
    const rows: { order: Record<string, unknown>; charges: ReturnType<typeof orderCharges> }[] = [];
    for (const o of orders) {
      if (["Delivered", "Cancelled", "Completed"].includes(o.status as string)) continue;
      const ch = orderCharges(o).filter((c) => c.amount > 0 || c.urgency === "soon" || c.urgency === "over");
      if (ch.length === 0) continue;
      total += ch.reduce((s, c) => s + c.amount, 0);
      rows.push({ order: o, charges: ch });
    }
    return { total: Math.round(total * 100) / 100, rows };
  }, [orders]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Drayage Company</p>
        <h1 className="text-2xl font-semibold tracking-tight">Equipment &amp; accessorials</h1>
        <p className="mt-1 text-sm text-muted-foreground">Rental exposure and outstanding per diem / demurrage / storage.</p>
      </div>

      {equipQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={<Layers className="h-4 w-4 text-blue-400" />} value={all.length} label="Equipment" />
            <Stat icon={<Truck className="h-4 w-4 text-emerald-400" />} value={attachedCount} label="On trucks" />
            <Stat icon={<AlertTriangle className="h-4 w-4 text-yellow-400" />} value={droppedCount} label="Dropped" />
          </div>

          <Card>
            <CardContent className="space-y-1 py-4">
              <p className="flex items-center gap-2 text-sm font-medium"><DollarSign className="h-4 w-4 text-primary" /> Rental exposure</p>
              <p className="text-3xl font-bold">${rentalMonthly.toLocaleString()}<span className="text-sm font-medium text-muted-foreground"> / mo est.</span></p>
              <p className="text-xs text-muted-foreground">{rentedCount} rented unit(s) across chassis &amp; trailers.</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1 py-4">
              <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-red-400" /> Outstanding accessorials</p>
              <p className={`text-3xl font-bold ${accessorials.total > 0 ? "text-red-400" : ""}`}>${accessorials.total.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Per diem / demurrage / storage accrued on active orders — billed to customers.</p>
            </CardContent>
          </Card>

          {accessorials.rows.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">By order</h2>
              {accessorials.rows.map(({ order, charges }) => (
                <Link key={order.id as string} href={`/drayage-company/${order.id as string}`}>
                  <Card className="transition hover:border-primary/50">
                    <CardContent className="space-y-2 py-4">
                      <p className="font-semibold">{order.reference_code as string}</p>
                      <div className="flex flex-wrap gap-2">
                        {charges.map((c) => (
                          <span key={c.kind} className={`rounded-full px-2.5 py-1 text-xs font-bold ${URGENCY_BG[c.urgency]} ${URGENCY_TEXT[c.urgency]}`}>{chargeChipLabel(c)}</span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-1 py-4">
        {icon}
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
