"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ruler, Plus, Trash2, CheckCircle2, XCircle, Receipt, PauseCircle, PlayCircle } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const SAMPLE_SPACES: SpaceRow[] = [
  { id: "ex-sp-1", name: "Bay C — floor storage", space_kind: "Floor", city: "Delta", total_sqft: 12000, booked_sqft: 7200, min_sqft: 200, base_rate_per_sqft_month: 1.85, currency: "CAD", min_term_months: 1, term_discount_3m_pct: 5, term_discount_6m_pct: 10, term_discount_12m_pct: 15, status: "Active", warehouse_space_tiers: [{ id: "ex-t-1", min_sqft: 2000, rate_per_sqft_month: 1.65 }, { id: "ex-t-2", min_sqft: 5000, rate_per_sqft_month: 1.45 }], warehouse_space_addons: [{ id: "ex-a-1", name: "Forklift & handling", pricing_unit: "per_month", rate: 350, is_required: false }] },
  { id: "ex-sp-2", name: "Racked pick module", space_kind: "Rack", city: "Richmond", total_sqft: 4800, booked_sqft: 1200, min_sqft: 100, base_rate_per_sqft_month: 2.4, currency: "CAD", min_term_months: 3, term_discount_3m_pct: 4, term_discount_6m_pct: 8, term_discount_12m_pct: 12, status: "Active", warehouse_space_tiers: [], warehouse_space_addons: [] },
  { id: "ex-sp-3", name: "Climate cage — cold", space_kind: "ClimateControlled", city: "Vancouver", total_sqft: 2600, booked_sqft: 2600, min_sqft: 100, base_rate_per_sqft_month: 4.1, currency: "CAD", min_term_months: 6, term_discount_3m_pct: 0, term_discount_6m_pct: 8, term_discount_12m_pct: 14, status: "Paused", warehouse_space_tiers: [], warehouse_space_addons: [] },
];
const SAMPLE_SPACE_BOOKINGS: BookingRow[] = [
  { id: "ex-sb-1", space_name: "Bay C — floor storage", customer_name: "Preview Retail Co.", sqft: 2000, term_months: 6, start_date: new Date().toISOString().slice(0, 10), monthly_total: 3300, one_time_total: 350, contract_total: 20150, currency: "CAD", status: "Requested", customer_notes: "Need dock access weekday mornings.", months_billed: 0, quote: { applied_rate: 1.65, term_discount_pct: 10 } },
  { id: "ex-sb-2", space_name: "Racked pick module", customer_name: "Harbour Freight Ltd.", sqft: 1200, term_months: 12, start_date: new Date(Date.now() - 86400000 * 20).toISOString().slice(0, 10), monthly_total: 2880, one_time_total: 0, contract_total: 34560, currency: "CAD", status: "Active", customer_notes: "", months_billed: 2, quote: { applied_rate: 2.4, term_discount_pct: 12 } },
];

interface TierRow { id: string; min_sqft: number; rate_per_sqft_month: number }
interface AddonRow { id: string; name: string; pricing_unit: string; rate: number; is_required: boolean }
interface SpaceRow {
  id: string;
  name: string;
  space_kind: string;
  city: string;
  total_sqft: number;
  booked_sqft: number;
  min_sqft: number;
  base_rate_per_sqft_month: number;
  currency: string;
  min_term_months: number;
  term_discount_3m_pct: number;
  term_discount_6m_pct: number;
  term_discount_12m_pct: number;
  status: string;
  warehouse_space_tiers: TierRow[];
  warehouse_space_addons: AddonRow[];
}
interface BookingRow {
  id: string;
  space_name: string;
  customer_name: string;
  sqft: number;
  term_months: number;
  start_date: string;
  monthly_total: number;
  one_time_total: number;
  contract_total: number;
  currency: string;
  status: string;
  customer_notes: string;
  months_billed: number;
  quote: { applied_rate?: number; term_discount_pct?: number } | null;
}

const KIND_LABEL: Record<string, string> = {
  Floor: "Floor storage", Rack: "Racked", ClimateControlled: "Climate controlled",
  Secured: "Secured cage", Outdoor: "Outdoor yard", Hazmat: "Hazmat certified",
};
const UNIT_LABEL: Record<string, string> = { per_sqft_month: "$/sqft/mo", per_month: "$/mo", one_time: "one-time" };

/** Provider-side shared-space manager: publish SF space, tune pricing, handle requests. */
export default function WarehouseSpacesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const companyId = useActiveCompanyId("WarehouseProvider");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  const spacesQ = useQuery({
    queryKey: ["spaces", "mine", companyId],
    enabled: !!companyId && !isExploring,
    refetchInterval: 30000,
    queryFn: async (): Promise<SpaceRow[]> => {
      const { data, error: e } = await supabase
        .from("warehouse_spaces")
        .select("*, warehouse_space_tiers(*), warehouse_space_addons(*)")
        .eq("company_id", companyId as string)
        .order("created_at", { ascending: false });
      if (e) return [];
      return (data as SpaceRow[] | null) ?? [];
    },
  });

  const bookingsQ = useQuery({
    queryKey: ["spaces", "bookings", "provider"],
    enabled: !isExploring,
    refetchInterval: 15000,
    queryFn: async (): Promise<BookingRow[]> => {
      const { data, error: e } = await supabase.rpc("space_list_bookings", { p_scope: "provider" });
      if (e) return [];
      return (data as BookingRow[] | null) ?? [];
    },
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["spaces"] });

  const rpc = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown> }) => {
      const { error: e } = await supabase.rpc(fn, args);
      if (e) throw new Error(e.message);
    },
    onSuccess: () => { setError(""); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  // New space form state
  const [f, setF] = useState({
    name: "", kind: "Floor", city: "", totalSqft: "", minSqft: "100", rate: "",
    minTerm: "1", d3: "5", d6: "10", d12: "15", notes: "",
  });

  const createSpace = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No warehouse company found");
      if (!f.name.trim() || !Number(f.totalSqft) || !Number(f.rate)) {
        throw new Error("Name, total sqft and base rate are required");
      }
      const { error: e } = await supabase.from("warehouse_spaces").insert({
        company_id: companyId,
        name: f.name.trim(),
        space_kind: f.kind,
        city: f.city.trim(),
        total_sqft: Number(f.totalSqft),
        min_sqft: Number(f.minSqft) || 100,
        base_rate_per_sqft_month: Number(f.rate),
        min_term_months: Number(f.minTerm) || 1,
        term_discount_3m_pct: Number(f.d3) || 0,
        term_discount_6m_pct: Number(f.d6) || 0,
        term_discount_12m_pct: Number(f.d12) || 0,
        notes: f.notes.trim(),
        status: "Active",
      });
      if (e) throw new Error(e.message);
    },
    onSuccess: () => {
      setShowForm(false);
      setF({ name: "", kind: "Floor", city: "", totalSqft: "", minSqft: "100", rate: "", minTerm: "1", d3: "5", d6: "10", d12: "15", notes: "" });
      setError("");
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async (s: SpaceRow) => {
      const { error: e } = await supabase.from("warehouse_spaces")
        .update({ status: s.status === "Active" ? "Paused" : "Active", updated_at: new Date().toISOString() })
        .eq("id", s.id);
      if (e) throw new Error(e.message);
    },
    onSuccess: invalidate,
  });

  // Inline tier/addon forms
  const [tierFor, setTierFor] = useState<string | null>(null);
  const [tierMin, setTierMin] = useState("");
  const [tierRate, setTierRate] = useState("");
  const [addonFor, setAddonFor] = useState<string | null>(null);
  const [addonName, setAddonName] = useState("");
  const [addonUnit, setAddonUnit] = useState("per_month");
  const [addonRate, setAddonRate] = useState("");

  const addTier = useMutation({
    mutationFn: async (spaceId: string) => {
      const { error: e } = await supabase.from("warehouse_space_tiers").insert({
        space_id: spaceId, min_sqft: Number(tierMin), rate_per_sqft_month: Number(tierRate),
      });
      if (e) throw new Error(e.message);
    },
    onSuccess: () => { setTierFor(null); setTierMin(""); setTierRate(""); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const removeTier = useMutation({
    mutationFn: async (id: string) => { await supabase.from("warehouse_space_tiers").delete().eq("id", id); },
    onSuccess: invalidate,
  });
  const addAddon = useMutation({
    mutationFn: async (spaceId: string) => {
      const { error: e } = await supabase.from("warehouse_space_addons").insert({
        space_id: spaceId, name: addonName.trim(), pricing_unit: addonUnit, rate: Number(addonRate),
      });
      if (e) throw new Error(e.message);
    },
    onSuccess: () => { setAddonFor(null); setAddonName(""); setAddonRate(""); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });
  const removeAddon = useMutation({
    mutationFn: async (id: string) => { await supabase.from("warehouse_space_addons").delete().eq("id", id); },
    onSuccess: invalidate,
  });

  const spaces = useMemo(() => (isExploring ? SAMPLE_SPACES : spacesQ.data ?? []), [spacesQ.data, isExploring]);
  const bookings = useMemo(() => (isExploring ? SAMPLE_SPACE_BOOKINGS : bookingsQ.data ?? []), [bookingsQ.data, isExploring]);
  const requests = bookings.filter((b) => b.status === "Requested");
  const active = bookings.filter((b) => b.status === "Active");
  const totalSqft = spaces.reduce((s, x) => s + Number(x.total_sqft ?? 0), 0);
  const bookedSqft = spaces.reduce((s, x) => s + Number(x.booked_sqft ?? 0), 0);
  const monthly = active.reduce((s, b) => s + Number(b.monthly_total ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Warehouse</p>
          <h1 className="text-2xl font-semibold tracking-tight">Space rentals (per sqft)</h1>
          <p className="mt-1 text-sm text-muted-foreground">Rent out square footage with measured pricing — volume tiers, term discounts and add-ons.</p>
        </div>
        <Dialog open={showForm} onOpenChange={(o) => { if (o && !guard("Publish a space")) return; setShowForm(o); }}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />New space</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Publish space</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Space name *</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Bay C — floor storage" /></div>
              <div>
                <Label>Space type</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(KIND_LABEL).map(([k, label]) => (
                    <Button key={k} type="button" size="sm" variant={f.kind === k ? "default" : "outline"} onClick={() => setF({ ...f, kind: k })}>{label}</Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>City</Label><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
                <div><Label>Total sqft *</Label><Input type="number" value={f.totalSqft} onChange={(e) => setF({ ...f, totalSqft: e.target.value })} /></div>
                <div><Label>Min per booking</Label><Input type="number" value={f.minSqft} onChange={(e) => setF({ ...f, minSqft: e.target.value })} /></div>
                <div><Label>Base $/sqft/month *</Label><Input type="number" step="0.01" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
                <div><Label>Min term (months)</Label><Input type="number" value={f.minTerm} onChange={(e) => setF({ ...f, minTerm: e.target.value })} /></div>
              </div>
              <div>
                <Label>Term discounts % (3 / 6 / 12 months)</Label>
                <div className="mt-1 grid grid-cols-3 gap-3">
                  <Input type="number" value={f.d3} onChange={(e) => setF({ ...f, d3: e.target.value })} placeholder="3m %" />
                  <Input type="number" value={f.d6} onChange={(e) => setF({ ...f, d6: e.target.value })} placeholder="6m %" />
                  <Input type="number" value={f.d12} onChange={(e) => setF({ ...f, d12: e.target.value })} placeholder="12m %" />
                </div>
              </div>
              <div><Label>Notes</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Dock access, racking specs, hours…" /></div>
              <Button className="w-full" disabled={createSpace.isPending} onClick={() => createSpace.mutate()}>
                {createSpace.isPending ? "Publishing…" : "Publish space"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-6"><p className="text-2xl font-bold">{totalSqft.toLocaleString()}</p><p className="text-xs text-muted-foreground">sqft listed</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-2xl font-bold">{totalSqft > 0 ? Math.round((bookedSqft / totalSqft) * 100) : 0}%</p><p className="text-xs text-muted-foreground">occupied</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-2xl font-bold">${monthly.toLocaleString()}</p><p className="text-xs text-muted-foreground">active monthly revenue</p></CardContent></Card>
      </div>

      {requests.length > 0 && (
        <Card className="border-yellow-500/40">
          <CardHeader><CardTitle className="text-base">Requests ({requests.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {requests.map((b) => (
              <div key={b.id} className="rounded-lg border border-white/5 bg-card/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{b.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{b.space_name} · from {b.start_date}</p>
                  </div>
                  <p className="text-lg font-bold text-primary">{Number(b.sqft).toLocaleString()} sqft</p>
                </div>
                <div className="mt-2 rounded-md bg-muted/40 p-3 text-xs">
                  <p>Rate ${Number(b.quote?.applied_rate ?? 0).toFixed(2)}/sqft/mo{Number(b.quote?.term_discount_pct ?? 0) > 0 ? ` · −${b.quote?.term_discount_pct}% term discount` : ""}</p>
                  <p>Monthly ${Number(b.monthly_total).toFixed(2)} × {b.term_months} mo{Number(b.one_time_total) > 0 ? ` + $${Number(b.one_time_total).toFixed(2)} one-time` : ""}</p>
                  <p className="mt-1 font-semibold text-foreground">Contract total: ${Number(b.contract_total).toFixed(2)} {b.currency}</p>
                </div>
                {b.customer_notes ? <p className="mt-2 text-xs italic text-muted-foreground">“{b.customer_notes}”</p> : null}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" className="text-red-300" disabled={rpc.isPending}
                    onClick={() => { if (!guard("Decline this request")) return; rpc.mutate({ fn: "space_respond_booking", args: { p_booking_id: b.id, p_action: "decline", p_note: "" } }); }}>
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />Decline
                  </Button>
                  <Button size="sm" disabled={rpc.isPending}
                    onClick={() => { if (!guard("Approve & invoice")) return; rpc.mutate({ fn: "space_respond_booking", args: { p_booking_id: b.id, p_action: "approve", p_note: "" } }); }}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve & invoice
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {active.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Active rentals ({active.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {active.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{b.customer_name}</p>
                  <p className="text-xs text-muted-foreground">{b.space_name} · {Number(b.sqft).toLocaleString()} sqft · ${Number(b.monthly_total).toFixed(2)}/mo</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-500/15 text-blue-300">{b.months_billed}/{b.term_months} billed</Badge>
                  {b.months_billed < b.term_months && (
                    <Button size="sm" disabled={rpc.isPending} onClick={() => { if (!guard("Bill this month")) return; rpc.mutate({ fn: "space_bill_month", args: { p_booking_id: b.id } }); }}>
                      <Receipt className="mr-1.5 h-3.5 w-3.5" />Bill month {b.months_billed + 1}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={rpc.isPending}
                    onClick={() => { if (!guard("End this rental")) return; rpc.mutate({ fn: "space_end_booking", args: { p_booking_id: b.id, p_note: "" } }); }}>
                    End
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">My spaces ({spaces.length})</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!isExploring && spacesQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : spaces.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Ruler className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No spaces published yet. Publish unused square footage — set a base rate, volume tiers and term discounts, and every quote is calculated transparently.</p>
            </div>
          ) : (
            spaces.map((s) => {
              const free = Math.max(0, Number(s.total_sqft) - Number(s.booked_sqft));
              const tiers = [...(s.warehouse_space_tiers ?? [])].sort((a, b) => a.min_sqft - b.min_sqft);
              const addons = s.warehouse_space_addons ?? [];
              return (
                <div key={s.id} className="rounded-lg border border-white/5 bg-card/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{s.name} {s.status !== "Active" && <Badge className="ml-1 bg-yellow-500/15 text-yellow-300">Paused</Badge>}</p>
                      <p className="text-xs text-muted-foreground">{KIND_LABEL[s.space_kind] ?? s.space_kind}{s.city ? ` · ${s.city}` : ""}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { if (!guard("Change space status")) return; toggleStatus.mutate(s); }}>
                      {s.status === "Active" ? <PauseCircle className="h-4 w-4 text-yellow-400" /> : <PlayCircle className="h-4 w-4 text-emerald-400" />}
                    </Button>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${s.total_sqft > 0 ? Math.round((free / s.total_sqft) * 100) : 0}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {free.toLocaleString()} of {Number(s.total_sqft).toLocaleString()} sqft free · base ${Number(s.base_rate_per_sqft_month).toFixed(2)}/sqft/mo · discounts {s.term_discount_3m_pct}/{s.term_discount_6m_pct}/{s.term_discount_12m_pct}% (3/6/12 mo)
                  </p>

                  <div className="mt-3 border-t border-white/5 pt-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground">Volume tiers</p>
                      <Button size="sm" variant="ghost" onClick={() => { setTierFor(tierFor === s.id ? null : s.id); setAddonFor(null); }}><Plus className="h-3.5 w-3.5" /></Button>
                    </div>
                    {tiers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No tiers — add them so bigger footprints get a better rate.</p>
                    ) : tiers.map((t) => (
                      <div key={t.id} className="flex items-center justify-between text-xs">
                        <span>{Number(t.min_sqft).toLocaleString()}+ sqft → ${Number(t.rate_per_sqft_month).toFixed(2)}/sqft/mo</span>
                        <Button size="sm" variant="ghost" onClick={() => removeTier.mutate(t.id)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                      </div>
                    ))}
                    {tierFor === s.id && (
                      <div className="mt-2 flex gap-2">
                        <Input className="h-8" type="number" placeholder="Min sqft" value={tierMin} onChange={(e) => setTierMin(e.target.value)} />
                        <Input className="h-8" type="number" step="0.01" placeholder="$/sqft/mo" value={tierRate} onChange={(e) => setTierRate(e.target.value)} />
                        <Button size="sm" disabled={!Number(tierMin) || !Number(tierRate) || addTier.isPending} onClick={() => addTier.mutate(s.id)}>Add</Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 border-t border-white/5 pt-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground">Add-on services</p>
                      <Button size="sm" variant="ghost" onClick={() => { setAddonFor(addonFor === s.id ? null : s.id); setTierFor(null); }}><Plus className="h-3.5 w-3.5" /></Button>
                    </div>
                    {addons.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None yet — e.g. forklift & handling, 24/7 access, insurance, pallet in/out.</p>
                    ) : addons.map((a) => (
                      <div key={a.id} className="flex items-center justify-between text-xs">
                        <span>{a.name} — ${Number(a.rate).toFixed(2)} {UNIT_LABEL[a.pricing_unit] ?? a.pricing_unit}</span>
                        <Button size="sm" variant="ghost" onClick={() => removeAddon.mutate(a.id)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                      </div>
                    ))}
                    {addonFor === s.id && (
                      <div className="mt-2 space-y-2">
                        <div className="flex gap-2">
                          <Input className="h-8 flex-[2]" placeholder="Service name" value={addonName} onChange={(e) => setAddonName(e.target.value)} />
                          <Input className="h-8 flex-1" type="number" step="0.01" placeholder="Rate" value={addonRate} onChange={(e) => setAddonRate(e.target.value)} />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {Object.entries(UNIT_LABEL).map(([u, label]) => (
                            <Button key={u} type="button" size="sm" variant={addonUnit === u ? "default" : "outline"} onClick={() => setAddonUnit(u)}>{label}</Button>
                          ))}
                          <Button size="sm" disabled={!addonName.trim() || !Number(addonRate) || addAddon.isPending} onClick={() => addAddon.mutate(s.id)}>Add</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
