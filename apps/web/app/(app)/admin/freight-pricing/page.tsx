"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Globe, Building2, Trash2 } from "lucide-react";

interface RateCardRow {
  id: string;
  company_id: string | null;
  vehicle_type: string;
  base_price: number;
  per_km: number;
  per_pallet: number;
  same_day_multiplier: number;
}
interface OverrideRow { company_id: string; commission_percentage: number; booking_fee: number }
interface CompanyRow { id: string; name: string; type: string }
interface PlatformSettings {
  warehouse_commission_percentage: number;
  service_commission_percentage: number;
  labour_commission_percentage: number;
  handling_fee_per_pallet_default: number;
  tax_mode: string;
  trucking_commission_percentage: number;
  trucking_booking_fee: number;
}

type RateDraft = { base: string; perKm: string; perPallet: string; sameDay: string };

// Matches the load_vehicle_type enum + mobile VEHICLE_OPTIONS.
const VEHICLES: { type: string; label: string; emoji: string }[] = [
  { type: "Bicycle", label: "Bicycle", emoji: "🚲" },
  { type: "Motorcycle", label: "Motorcycle", emoji: "🏍️" },
  { type: "Car", label: "Car", emoji: "🚗" },
  { type: "Pickup", label: "Pickup", emoji: "🛻" },
  { type: "MovingTruck", label: "Moving truck", emoji: "🚚" },
  { type: "FiveTon", label: "5-ton", emoji: "🚛" },
  { type: "FlatDeck", label: "Flat deck", emoji: "🛞" },
  { type: "Semi", label: "Semi", emoji: "🚜" },
];

const DEFAULTS: Record<string, RateDraft> = {
  Bicycle: { base: "6", perKm: "1.2", perPallet: "8", sameDay: "1.4" },
  Motorcycle: { base: "8", perKm: "1.5", perPallet: "8", sameDay: "1.4" },
  Car: { base: "12", perKm: "1.8", perPallet: "8", sameDay: "1.4" },
  Pickup: { base: "25", perKm: "2.2", perPallet: "8", sameDay: "1.4" },
  MovingTruck: { base: "60", perKm: "3.0", perPallet: "8", sameDay: "1.4" },
  FiveTon: { base: "90", perKm: "3.5", perPallet: "8", sameDay: "1.4" },
  FlatDeck: { base: "120", perKm: "4.0", perPallet: "8", sameDay: "1.4" },
  Semi: { base: "200", perKm: "4.5", perPallet: "8", sameDay: "1.4" },
};

/** Admin › Freight pricing. Web mirror of expo/app/admin/freight-pricing.tsx. */
export default function AdminFreightPricingPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [scope, setScope] = useState<string>("global");

  const dataQ = useQuery({
    queryKey: ["admin", "freight-pricing"],
    queryFn: async () => {
      const [settings, rateCards, overrides, companies] = await Promise.all([
        supabase.from("platform_settings").select("*").limit(1).single(),
        supabase.from("load_rate_cards").select("id,company_id,vehicle_type,base_price,per_km,per_pallet,same_day_multiplier"),
        supabase.from("load_commission_overrides").select("company_id,commission_percentage,booking_fee"),
        supabase.from("companies").select("id,name,type").in("type", ["TruckingCompany", "Shipper", "Customer"]).order("name"),
      ]);
      if (settings.error) throw settings.error;
      return {
        settings: settings.data as PlatformSettings,
        rateCards: (rateCards.data ?? []) as RateCardRow[],
        overrides: (overrides.data ?? []) as OverrideRow[],
        companies: (companies.data ?? []) as CompanyRow[],
      };
    },
  });

  const settings = dataQ.data?.settings;
  const rateCards = useMemo(() => dataQ.data?.rateCards ?? [], [dataQ.data]);
  const overrides = useMemo(() => dataQ.data?.overrides ?? [], [dataQ.data]);
  const companies = dataQ.data?.companies ?? [];

  const [globalCommission, setGlobalCommission] = useState("12");
  const [globalBookingFee, setGlobalBookingFee] = useState("5");
  const [companyCommission, setCompanyCommission] = useState("");
  const [companyBookingFee, setCompanyBookingFee] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({});

  useEffect(() => {
    if (settings) {
      setGlobalCommission(String(settings.trucking_commission_percentage ?? 12));
      setGlobalBookingFee(String(settings.trucking_booking_fee ?? 5));
    }
  }, [settings]);

  useEffect(() => {
    const next: Record<string, RateDraft> = {};
    for (const v of VEHICLES) {
      const row = rateCards.find((r) => r.vehicle_type === v.type && (scope === "global" ? r.company_id === null : r.company_id === scope));
      const globalRow = rateCards.find((r) => r.vehicle_type === v.type && r.company_id === null);
      const fallback = globalRow
        ? { base: String(globalRow.base_price), perKm: String(globalRow.per_km), perPallet: String(globalRow.per_pallet), sameDay: String(globalRow.same_day_multiplier) }
        : DEFAULTS[v.type];
      next[v.type] = row
        ? { base: String(row.base_price), perKm: String(row.per_km), perPallet: String(row.per_pallet), sameDay: String(row.same_day_multiplier) }
        : fallback;
    }
    setDrafts(next);
    if (scope !== "global") {
      const ov = overrides.find((o) => o.company_id === scope);
      setCompanyCommission(ov ? String(ov.commission_percentage) : "");
      setCompanyBookingFee(ov ? String(ov.booking_fee) : "");
    }
  }, [scope, rateCards, overrides]);

  const setDraft = (type: string, key: keyof RateDraft, value: string) => setDrafts((p) => ({ ...p, [type]: { ...p[type], [key]: value } }));

  const saveRate = useMutation({
    mutationFn: async (type: string) => {
      const d = drafts[type];
      const { error } = await supabase.rpc("admin_upsert_rate_card", {
        p_company_id: scope === "global" ? null : scope,
        p_vehicle_type: type,
        p_base_price: Number(d.base) || 0,
        p_per_km: Number(d.perKm) || 0,
        p_per_pallet: Number(d.perPallet) || 0,
        p_same_day_multiplier: Number(d.sameDay) || 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "freight-pricing"] }),
  });

  const deleteRate = useMutation({
    mutationFn: async (type: string) => {
      const row = rateCards.find((r) => r.vehicle_type === type && r.company_id === scope);
      if (!row) throw new Error("This vehicle already uses the global rate.");
      const { error } = await supabase.rpc("admin_delete_rate_card", { p_id: row.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "freight-pricing"] }),
  });

  const saveGlobalCommission = useMutation({
    mutationFn: async () => {
      if (!settings) throw new Error("Settings not loaded");
      const { error } = await supabase.rpc("admin_update_platform_settings", {
        p_warehouse_commission_percentage: settings.warehouse_commission_percentage,
        p_service_commission_percentage: settings.service_commission_percentage,
        p_labour_commission_percentage: settings.labour_commission_percentage,
        p_handling_fee_per_pallet_default: settings.handling_fee_per_pallet_default,
        p_tax_mode: settings.tax_mode,
        p_trucking_commission_percentage: Number(globalCommission) || 0,
        p_trucking_booking_fee: Number(globalBookingFee) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "freight-pricing"] }),
  });

  const saveOverride = useMutation({
    mutationFn: async () => {
      if (scope === "global") return;
      const { error } = await supabase.rpc("admin_upsert_commission_override", {
        p_company_id: scope,
        p_commission_percentage: Number(companyCommission) || 0,
        p_booking_fee: Number(companyBookingFee) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "freight-pricing"] }),
  });

  const deleteOverride = useMutation({
    mutationFn: async () => {
      if (scope === "global") return;
      const { error } = await supabase.rpc("admin_delete_commission_override", { p_company_id: scope });
      if (error) throw error;
    },
    onSuccess: () => { setCompanyCommission(""); setCompanyBookingFee(""); qc.invalidateQueries({ queryKey: ["admin", "freight-pricing"] }); },
  });

  const overrideCompanyIds = new Set(overrides.map((o) => o.company_id));
  const activeCompany = companies.find((c) => c.id === scope);

  const sample = useMemo(() => {
    const d = drafts.Pickup ?? DEFAULTS.Pickup;
    const distance = 25, pallets = 2;
    const freight = Number(d.base) + Number(d.perKm) * distance + Number(d.perPallet) * pallets;
    const pct = scope === "global" ? Number(globalCommission) : (companyCommission !== "" ? Number(companyCommission) : Number(globalCommission));
    const fee = scope === "global" ? Number(globalBookingFee) : (companyBookingFee !== "" ? Number(companyBookingFee) : Number(globalBookingFee));
    const commission = (freight * (pct || 0)) / 100;
    return {
      freight: freight.toFixed(2), fee: (fee || 0).toFixed(2), commission: commission.toFixed(2),
      carrierNet: (freight - commission).toFixed(2), platform: (commission + (fee || 0)).toFixed(2), shipperPays: (freight + (fee || 0)).toFixed(2),
    };
  }, [drafts, scope, globalCommission, globalBookingFee, companyCommission, companyBookingFee]);

  if (dataQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading pricing…</div>;
  if (dataQ.error) return <div className="p-6 text-sm text-red-600">{(dataQ.error as Error).message}</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Freight pricing</h1>
        <p className="text-sm text-muted-foreground">Rate cards &amp; commission per vehicle and company.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setScope("global")}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${scope === "global" ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
          <Globe className="h-3.5 w-3.5" /> Global default
        </button>
        {companies.map((c) => (
          <button key={c.id} onClick={() => setScope(c.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${scope === c.id ? "border-primary bg-primary text-primary-foreground" : overrideCompanyIds.has(c.id) ? "border-emerald-500/50 text-emerald-500" : "border-border text-muted-foreground"}`}>
            <Building2 className="h-3.5 w-3.5" /> {c.name}
          </button>
        ))}
      </div>

      {scope !== "global" && (
        <p className="text-sm text-muted-foreground">Editing overrides for <span className="font-medium text-foreground">{activeCompany?.name}</span>. Vehicles without a saved override use the global rate.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Commission &amp; booking fee</CardTitle>
          {scope !== "global" && <CardDescription>Leave blank to use the global commission for this company.</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          {scope === "global" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Commission (%)</Label><Input type="number" value={globalCommission} onChange={(e) => setGlobalCommission(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Booking fee ($)</Label><Input type="number" value={globalBookingFee} onChange={(e) => setGlobalBookingFee(e.target.value)} /></div>
              </div>
              {saveGlobalCommission.error && <p className="text-sm text-red-600">{(saveGlobalCommission.error as Error).message}</p>}
              <Button disabled={saveGlobalCommission.isPending} onClick={() => saveGlobalCommission.mutate()}>{saveGlobalCommission.isPending ? "Saving…" : "Save commission"}</Button>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Commission (%)</Label><Input type="number" placeholder={globalCommission} value={companyCommission} onChange={(e) => setCompanyCommission(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Booking fee ($)</Label><Input type="number" placeholder={globalBookingFee} value={companyBookingFee} onChange={(e) => setCompanyBookingFee(e.target.value)} /></div>
              </div>
              {saveOverride.error && <p className="text-sm text-red-600">{(saveOverride.error as Error).message}</p>}
              <div className="flex gap-2">
                <Button disabled={saveOverride.isPending} onClick={() => saveOverride.mutate()}>{saveOverride.isPending ? "Saving…" : "Save company commission"}</Button>
                {overrideCompanyIds.has(scope) && (
                  <Button variant="outline" disabled={deleteOverride.isPending} onClick={() => deleteOverride.mutate()}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove override
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sample: Pickup · 25 km · 2 pallets</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <SampleRow label="Freight price" value={`$${sample.freight}`} />
          <SampleRow label="Booking fee" value={`$${sample.fee}`} />
          <SampleRow label="Commission" value={`- $${sample.commission}`} />
          <div className="my-2 border-t" />
          <SampleRow label="Carrier nets" value={`$${sample.carrierNet}`} strong className="text-emerald-500" />
          <SampleRow label="Platform earns" value={`$${sample.platform}`} strong className="text-primary" />
          <SampleRow label="Shipper pays" value={`$${sample.shipperPays}`} strong />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Rate card</h2>
        <div className="space-y-4">
          {VEHICLES.map((v) => {
            const d = drafts[v.type] ?? DEFAULTS[v.type];
            const hasCompanyRow = scope !== "global" && rateCards.some((r) => r.vehicle_type === v.type && r.company_id === scope);
            return (
              <Card key={v.type}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{v.emoji} {v.label}</span>
                    {scope !== "global" && <span className={`text-xs font-semibold ${hasCompanyRow ? "text-emerald-500" : "text-muted-foreground"}`}>{hasCompanyRow ? "Custom" : "Global"}</span>}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label>Base ($)</Label><Input type="number" value={d.base} onChange={(e) => setDraft(v.type, "base", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Per km ($)</Label><Input type="number" value={d.perKm} onChange={(e) => setDraft(v.type, "perKm", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Per pallet ($)</Label><Input type="number" value={d.perPallet} onChange={(e) => setDraft(v.type, "perPallet", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Same-day ×</Label><Input type="number" value={d.sameDay} onChange={(e) => setDraft(v.type, "sameDay", e.target.value)} /></div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={saveRate.isPending} onClick={() => saveRate.mutate(v.type)}>{scope === "global" ? "Save rate" : "Save override"}</Button>
                    {scope !== "global" && hasCompanyRow && (
                      <Button size="sm" variant="outline" disabled={deleteRate.isPending} onClick={() => deleteRate.mutate(v.type)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SampleRow({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`${strong ? "font-bold" : "font-medium"} ${className ?? ""}`}>{value}</span>
    </div>
  );
}
