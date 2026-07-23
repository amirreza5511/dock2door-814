"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Truck, Layers, Boxes, Home, Plus, Package, Send, ChevronRight, ClipboardList } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { UserRole } from "@/lib/types";
import {
  freightRoleKind, FREIGHT_MODE_LABEL, FREIGHT_STATUS_META,
  CURRENCY_CODES, COUNTRY_NAMES, formatMoney,
  type FreightMode, type FreightQuoteStatus,
} from "@/lib/global-freight";
import {
  COVERAGE_AREAS, LOAD_TYPES, LOAD_TYPE_MAP, GROUND_FREIGHT_MODES, estimateGroundLoad,
  type CoverageArea, type LoadType,
} from "@/lib/ground-freight";
import { formatDate } from "@/lib/utils";
import { useExplore, useActionGuard } from "@/lib/explore-store";
import { SAMPLE_GROUND_LOADS } from "@/lib/explore-samples";

interface FreightRequest {
  id: string; reference_code: string; title: string; freight_mode: FreightMode;
  origin_country: string; origin_city: string; dest_country: string; dest_city: string;
  weight: number; weight_unit: string; pieces: number; currency: string;
  needs_container_pickup: boolean; status: FreightQuoteStatus;
  awarded_amount: number; offer_count: number; ground_offer_count: number; created_at: string;
  [k: string]: unknown;
}

interface BoardRow {
  id: string; reference_code: string; title: string; freight_mode: FreightMode;
  origin_country: string; origin_city: string; dest_country: string; dest_city: string;
  weight: number; weight_unit: string; pieces: number; currency: string;
  commodity: string; needs_container_pickup: boolean; status: string; customer_name: string;
  my_offer_amount: number | null; my_offer_currency: string | null; my_offer_status: string | null;
  offer_kind: string; created_at: string; [k: string]: unknown;
}

const LOAD_ICON: Record<LoadType, typeof Truck> = { ltl: Layers, ftl: Truck, lcl: Boxes };

export function GroundFreightClient({ role }: { role: UserRole | null }) {
  const guard = useActionGuard();
  const kind = freightRoleKind(role);
  const isCustomer = kind === "customer";
  const isProvider = kind === "freight" || kind === "ground";

  const [coverage, setCoverage] = useState<CoverageArea>("canada");
  const [loadType, setLoadType] = useState<LoadType>("ltl");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-emerald-500/15 bg-gradient-to-br from-emerald-950/60 to-transparent p-6">
        <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/15">
          <Truck className="h-7 w-7 text-emerald-400" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">LTL &amp; FTL Quotes</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Get a price for any truck load.</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Local, across Canada, or worldwide with final-mile to the door. Post your load once and
          carriers and companies send competing prices to win it.
        </p>
      </div>

      {/* Coverage */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">Coverage</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {COVERAGE_AREAS.map((cov) => {
            const active = coverage === cov.value;
            return (
              <button key={cov.value} type="button" onClick={() => setCoverage(cov.value)}
                className={`rounded-xl border p-3 text-left transition ${active ? "border-emerald-500 bg-emerald-500/10" : "border-white/5 bg-card/60 hover:border-white/20"}`}>
                <p className="text-sm font-semibold">{cov.label}</p>
                <p className="text-xs text-muted-foreground">{cov.sublabel}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Load type */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">Load type</p>
        <div className="flex flex-wrap gap-2">
          {LOAD_TYPES.map((l) => {
            const Icon = LOAD_ICON[l.value];
            const active = loadType === l.value;
            return (
              <button key={l.value} type="button" onClick={() => setLoadType(l.value)}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 transition ${active ? "border-emerald-500 bg-emerald-500 text-white" : "border-white/5 bg-card/60 hover:border-white/20"}`}>
                <Icon className={`h-4 w-4 ${active ? "text-white" : "text-emerald-400"}`} />
                <span className="text-sm font-semibold">{l.short}</span>
              </button>
            );
          })}
          <span className="flex items-center gap-2 rounded-xl border border-white/5 bg-card/60 px-4 py-2.5">
            <Home className="h-4 w-4 text-blue-400" /><span className="text-sm font-semibold">+ Final-mile</span>
          </span>
        </div>
      </div>

      {/* CTAs */}
      <div className="space-y-3">
        {isCustomer || kind === "none" || kind === "admin" ? (
          <Button size="lg" className="w-full bg-emerald-600 hover:bg-emerald-500" onClick={() => { if (guard("Get quotes for my load")) setWizardOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Get quotes for my load
          </Button>
        ) : null}
        {isProvider ? (
          <Button size="lg" variant="secondary" className="w-full" onClick={() => setShowBoard((v) => !v)}>
            <ClipboardList className="mr-1.5 h-4 w-4" /> Browse open loads &amp; quote
          </Button>
        ) : null}
      </div>

      {/* Provider board */}
      {isProvider && showBoard ? <ProviderBoard kind={kind === "ground" ? "ground" : "freight"} /> : null}

      {/* Customer's loads */}
      {isCustomer ? <MyLoads onPost={() => setWizardOpen(true)} /> : null}

      {/* How it works */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">How it works</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Layers, title: "Describe it once", desc: "Pickup, drop-off, load type and size — plus an instant ballpark price." },
            { icon: Boxes, title: "Providers compete", desc: "Carriers and companies send prices and transit times to win your load." },
            { icon: Truck, title: "Pick & go", desc: "Compare quotes side by side, chat, then accept the one you want." },
          ].map((f) => (
            <Card key={f.title}><CardContent className="space-y-2 py-4">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-500/15"><f.icon className="h-5 w-5 text-emerald-400" /></div>
              <p className="text-sm font-semibold">{f.title}</p>
              <p className="text-xs text-muted-foreground">{f.desc}</p>
            </CardContent></Card>
          ))}
        </div>
      </div>

      <GroundLoadWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialCoverage={coverage}
        initialLoadType={loadType}
      />
    </div>
  );
}

/* ---------------- Customer loads ---------------- */

function MyLoads({ onPost }: { onPost: () => void }) {
  const { isExploring } = useExplore();
  const supabase = getBrowserSupabase();
  const q = useQuery({
    queryKey: ["freight", "mine"],
    enabled: !isExploring,
    queryFn: async (): Promise<FreightRequest[]> => {
      const { data, error } = await supabase.rpc("freight_list_mine");
      if (error) throw error;
      return (data as FreightRequest[] | null) ?? [];
    },
  });
  const loads = useMemo<FreightRequest[]>(
    () => (isExploring
      ? (SAMPLE_GROUND_LOADS as unknown as FreightRequest[])
      : (q.data ?? []).filter((r) => GROUND_FREIGHT_MODES.includes(r.freight_mode))),
    [q.data, isExploring],
  );

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">My loads</p>
      {!isExploring && q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loads.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <Package className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No loads yet.</p>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={onPost}>Get quotes for my load</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {loads.map((r) => {
            const meta = FREIGHT_STATUS_META[r.status];
            return (
              <Link key={r.id} href={`/global-freight/${r.id}`} className="block">
                <Card className="transition hover:border-emerald-500">
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-muted-foreground">{r.reference_code}</span>
                        <Badge className={meta.className}>{meta.label}</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{r.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {FREIGHT_MODE_LABEL[r.freight_mode]} · {r.origin_city || r.origin_country} → {r.dest_city || r.dest_country} · {formatDate(r.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm font-medium text-emerald-400">
                      {r.status === "Accepted" && r.awarded_amount > 0 ? `Booked · ${formatMoney(r.awarded_amount, r.currency)}` : `${r.offer_count} quote${r.offer_count === 1 ? "" : "s"}`}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Customer wizard ---------------- */

function GroundLoadWizard({ open, onOpenChange, initialCoverage, initialLoadType }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  initialCoverage: CoverageArea; initialLoadType: LoadType;
}) {
  const supabase = getBrowserSupabase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const [coverage, setCoverage] = useState<CoverageArea>(initialCoverage);
  const [loadType, setLoadType] = useState<LoadType>(initialLoadType);
  const [originCity, setOriginCity] = useState("");
  const [originCountry, setOriginCountry] = useState("Canada");
  const [destCity, setDestCity] = useState("");
  const [destCountry, setDestCountry] = useState("Canada");
  const [weight, setWeight] = useState("");
  const [pallets, setPallets] = useState("1");
  const [readyDate, setReadyDate] = useState("");
  const [finalMile, setFinalMile] = useState(false);
  const [notes, setNotes] = useState("");

  const estimate = useMemo(
    () => estimateGroundLoad({
      loadType, coverage, weightKg: Number(weight) || 0, pallets: Number(pallets) || 1, finalMile,
    }),
    [loadType, coverage, weight, pallets, finalMile],
  );

  const reset = useCallback(() => {
    setCoverage(initialCoverage); setLoadType(initialLoadType); setOriginCity(""); setOriginCountry("Canada");
    setDestCity(""); setDestCountry("Canada"); setWeight(""); setPallets("1"); setReadyDate("");
    setFinalMile(false); setNotes(""); setError(""); setDone(false);
  }, [initialCoverage, initialLoadType]);

  const canSubmit = originCity.trim().length > 0 && destCity.trim().length > 0 && Number(weight) > 0;

  const submit = useCallback(async () => {
    setSubmitting(true); setError("");
    try {
      const def = LOAD_TYPE_MAP[loadType];
      const isIntl = coverage === "international";
      const { error: e } = await supabase.rpc("freight_create_quote", {
        p_title: `${def.short} — ${originCity} → ${destCity}`,
        p_origin_country: originCountry, p_origin_city: originCity, p_origin_port: "",
        p_dest_country: isIntl ? destCountry : originCountry, p_dest_city: destCity, p_dest_port: "",
        p_freight_mode: def.freightMode, p_weight: Number(weight) || 0, p_weight_unit: "kg",
        p_volume: 0, p_volume_unit: "cbm", p_pieces: Math.max(Number(pallets) || 1, 1),
        p_commodity: `${def.label} · ${COVERAGE_AREAS.find((c) => c.value === coverage)?.label}`,
        p_declared_value: 0, p_currency: "CAD", p_notes: notes,
        p_delivery_method: finalMile ? "door_pickup" : "port_delivery",
        p_needs_container_pickup: finalMile,
      });
      if (e) throw e;
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit load.");
    } finally {
      setSubmitting(false);
    }
  }, [supabase, loadType, coverage, originCity, originCountry, destCity, destCountry, weight, pallets, finalMile, notes]);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Get quotes for my load</DialogTitle></DialogHeader>

        {done ? (
          <div className="space-y-3 py-4 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15"><Send className="h-6 w-6 text-emerald-400" /></div>
            <p className="text-sm font-medium">Load posted!</p>
            <p className="text-xs text-muted-foreground">An admin reviews it, then it opens for competing quotes. You&apos;ll see prices roll in under “My loads”.</p>
            <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={() => { onOpenChange(false); reset(); }}>Done</Button>
          </div>
        ) : (
          <>
            <div className="max-h-[55vh] space-y-3 overflow-y-auto py-1">
              <div>
                <Label className="mb-1.5 block">Coverage</Label>
                <div className="grid grid-cols-3 gap-2">
                  {COVERAGE_AREAS.map((c) => (
                    <button key={c.value} type="button" onClick={() => setCoverage(c.value)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${coverage === c.value ? "border-emerald-500 bg-emerald-500/10" : "border-white/5 bg-card/60"}`}>{c.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block">Load type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {LOAD_TYPES.map((l) => (
                    <button key={l.value} type="button" onClick={() => setLoadType(l.value)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${loadType === l.value ? "border-emerald-500 bg-emerald-500/10" : "border-white/5 bg-card/60"}`}>{l.short}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Pickup city"><Input value={originCity} onChange={(e) => setOriginCity(e.target.value)} placeholder="e.g. Toronto" /></Field>
                <Field label="Drop-off city"><Input value={destCity} onChange={(e) => setDestCity(e.target.value)} placeholder="e.g. Montreal" /></Field>
              </div>
              {coverage === "international" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Pickup country"><CountryInput value={originCountry} onChange={setOriginCountry} /></Field>
                  <Field label="Destination country"><CountryInput value={destCountry} onChange={setDestCountry} /></Field>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Total weight (kg)"><Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" /></Field>
                <Field label={loadType === "ftl" ? "Trucks" : "Pallets"}><Input type="number" value={pallets} onChange={(e) => setPallets(e.target.value)} placeholder="1" /></Field>
              </div>
              <Field label="Ready date (optional)"><Input type="date" value={readyDate} onChange={(e) => setReadyDate(e.target.value)} /></Field>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/5 bg-card/60 p-3">
                <input type="checkbox" checked={finalMile} onChange={(e) => setFinalMile(e.target.checked)} />
                <span className="text-sm">Deliver to the door (final-mile)</span>
              </label>
              <Field label="Notes (optional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything providers should know" /></Field>

              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-xs text-muted-foreground">Instant ballpark estimate</p>
                <p className="text-lg font-semibold text-emerald-300">{formatMoney(estimate.low, estimate.currency)} – {formatMoney(estimate.high, estimate.currency)}</p>
                <p className="text-[11px] text-muted-foreground">Guidance only — real provider quotes may vary.</p>
              </div>
              {error ? <p className="text-sm text-red-400">{error}</p> : null}
            </div>
            <Button className="bg-emerald-600 hover:bg-emerald-500" disabled={!canSubmit || submitting} onClick={() => void submit()}>
              <Send className="mr-1.5 h-4 w-4" /> {submitting ? "Posting…" : "Post load & get quotes"}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Provider board (ground modes only) ---------------- */

function ProviderBoard({ kind }: { kind: "freight" | "ground" }) {
  const supabase = getBrowserSupabase();
  const [scope, setScope] = useState<"open" | "mine">("open");
  const [target, setTarget] = useState<BoardRow | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [transit, setTransit] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const q = useQuery({
    queryKey: ["freight", "board", scope],
    queryFn: async (): Promise<BoardRow[]> => {
      const { data, error: e } = await supabase.rpc("freight_provider_board", { p_scope: scope });
      if (e) throw e;
      return (data as BoardRow[] | null) ?? [];
    },
  });
  const rows = useMemo(
    () => (q.data ?? []).filter((r) => GROUND_FREIGHT_MODES.includes(r.freight_mode)),
    [q.data],
  );

  const openQuote = (r: BoardRow) => {
    setTarget(r); setAmount(r.my_offer_amount ? String(r.my_offer_amount) : "");
    setCurrency(r.my_offer_currency ?? r.currency ?? "CAD"); setTransit(""); setNote(""); setError("");
  };

  const submit = async () => {
    if (!target || !(Number(amount) > 0)) { setError("Enter an amount greater than zero."); return; }
    setBusy(true); setError("");
    try {
      const { error: e } = await supabase.rpc("freight_submit_offer", {
        p_quote_id: target.id, p_amount: Number(amount), p_currency: currency,
        p_transit_days: Number(transit) || 0, p_note: note,
      });
      if (e) throw e;
      setTarget(null);
      await q.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit quote.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Open truck loads</p>
        <div className="flex gap-2">
          {(["open", "mine"] as const).map((s) => (
            <Button key={s} variant={scope === s ? "default" : "secondary"} size="sm" onClick={() => setScope(s)}>
              {s === "open" ? "Open loads" : "My quotes"}
            </Button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No open truck loads right now. Approved loads appear here to quote.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const pendingReview = r.status === "PendingReview";
            const hasOffer = r.my_offer_amount != null;
            return (
              <Card key={r.id}>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">{r.reference_code}</span>
                    {pendingReview ? <Badge className="bg-amber-500/15 text-amber-300">Pending review</Badge>
                      : hasOffer ? <Badge className="bg-emerald-500/15 text-emerald-300">{r.my_offer_status === "Accepted" ? "Won" : "Quoted"} · {formatMoney(r.my_offer_amount ?? 0, r.my_offer_currency)}</Badge> : null}
                  </div>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.customer_name} · {FREIGHT_MODE_LABEL[r.freight_mode]} · {r.origin_city || r.origin_country} → {r.dest_city || r.dest_country} · {r.weight} {r.weight_unit} · {r.pieces} pcs
                  </p>
                  {pendingReview ? (
                    <p className="text-xs text-amber-300">Quoting opens once an admin approves this load.</p>
                  ) : (
                    <Button size="sm" variant={hasOffer ? "secondary" : "default"} onClick={() => openQuote(r)}>
                      <Send className="mr-1.5 h-4 w-4" /> {hasOffer ? "Update quote" : "Send quote"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(v) => { if (!v) setTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send a quote</DialogTitle></DialogHeader>
          <p className="truncate text-sm text-muted-foreground">{target?.title}</p>
          <div className="flex items-end gap-2">
            <Field label="Amount" className="flex-1"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></Field>
            <Field label="Currency"><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          </div>
          <Field label="Transit days (optional)"><Input type="number" value={transit} onChange={(e) => setTransit(e.target.value)} placeholder="0" /></Field>
          <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Routing, conditions, validity…" /></Field>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={() => void submit()} disabled={busy}>
            <Send className="mr-1.5 h-4 w-4" /> {busy ? "Submitting…" : "Submit quote"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`space-y-1.5 ${className ?? ""}`}><Label>{label}</Label>{children}</div>;
}

function CountryInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Input list="gnd-countries" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Country" />
      <datalist id="gnd-countries">{COUNTRY_NAMES.map((c) => <option key={c} value={c} />)}</datalist>
    </>
  );
}
