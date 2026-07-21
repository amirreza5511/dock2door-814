"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Globe, Plane, Ship, Truck, Boxes, Plus, Package, Send } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { UserRole } from "@/lib/types";
import {
  freightRoleKind, FREIGHT_MODES, FREIGHT_MODE_LABEL, DELIVERY_METHODS,
  FREIGHT_STATUS_META, CURRENCY_CODES, COUNTRY_NAMES, formatMoney,
  type FreightMode, type DeliveryMethod, type FreightQuoteStatus,
} from "@/lib/global-freight";
import { formatDate } from "@/lib/utils";

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

const MODE_ICON: Record<FreightMode, typeof Plane> = { air: Plane, ocean: Ship, truck: Truck, fcl: Boxes, lcl: Boxes };

export function FreightClient({ role }: { role: UserRole | null }) {
  const kind = freightRoleKind(role);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Global Freight</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Globe className="h-6 w-6 text-blue-400" /> International shipping & freight exchange</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {kind === "customer"
            ? "Post one request and receive competing quotes from forwarders, carriers and truckers."
            : kind === "ground"
              ? "Quote the container pickup / drayage leg on approved freight requests."
              : kind === "freight"
                ? "Browse approved requests and send competing quotes across every mode."
                : "International freight quote exchange."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FREIGHT_MODES.map((m) => {
          const Icon = MODE_ICON[m.value];
          return (
            <span key={m.value} className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-card/60 px-3 py-1.5 text-sm">
              <Icon className="h-4 w-4 text-blue-400" /> {FREIGHT_MODE_LABEL[m.value]}
            </span>
          );
        })}
      </div>

      {kind === "customer" ? <CustomerHub /> : kind === "freight" || kind === "ground" ? <ProviderBoard kind={kind} /> : (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Sign in as an importer/exporter, forwarder, carrier or trucker to use Global Freight.</CardContent></Card>
      )}
    </div>
  );
}

/* ---------------- Customer ---------------- */

function CustomerHub() {
  const supabase = getBrowserSupabase();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["freight", "mine"],
    queryFn: async (): Promise<FreightRequest[]> => {
      const { data, error } = await supabase.rpc("freight_list_mine");
      if (error) throw error;
      return (data as FreightRequest[] | null) ?? [];
    },
  });
  const requests = useMemo(() => q.data ?? [], [q.data]);

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My requests</h2>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Get a freight quote</Button>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : requests.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Package className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No requests yet. Tap “Get a freight quote” to post your first.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const meta = FREIGHT_STATUS_META[r.status];
            return (
              <Link key={r.id} href={`/global-freight/${r.id}`} className="block">
                <Card className="transition hover:border-primary">
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-muted-foreground">{r.reference_code}</span>
                        <Badge className={meta.className}>{meta.label}</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{r.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {FREIGHT_MODE_LABEL[r.freight_mode]} · {r.weight} {r.weight_unit} · {r.pieces} pcs · {formatDate(r.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm font-medium text-blue-400">
                      {r.status === "Accepted" && r.awarded_amount > 0 ? `Booked · ${formatMoney(r.awarded_amount, r.currency)}` : `${r.offer_count} quote${r.offer_count === 1 ? "" : "s"}`}
                      {r.needs_container_pickup ? ` · ${r.ground_offer_count} ground` : ""}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <QuoteWizard open={open} onOpenChange={setOpen} onSubmitted={() => { setOpen(false); void q.refetch(); }} />
    </>
  );
}

const STEPS = ["Route", "Mode", "Measurements", "Cargo", "Delivery", "Review"];

function QuoteWizard({ open, onOpenChange, onSubmitted }: { open: boolean; onOpenChange: (v: boolean) => void; onSubmitted: () => void }) {
  const supabase = getBrowserSupabase();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [originCountry, setOriginCountry] = useState("");
  const [originCity, setOriginCity] = useState("");
  const [originPort, setOriginPort] = useState("");
  const [destCountry, setDestCountry] = useState("");
  const [destCity, setDestCity] = useState("");
  const [destPort, setDestPort] = useState("");
  const [mode, setMode] = useState<FreightMode>("ocean");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lb">("kg");
  const [volume, setVolume] = useState("");
  const [pieces, setPieces] = useState("1");
  const [commodity, setCommodity] = useState("");
  const [declaredValue, setDeclaredValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [notes, setNotes] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("port_delivery");
  const [needsContainerPickup, setNeedsContainerPickup] = useState(false);

  const reset = useCallback(() => {
    setStep(0); setError(""); setOriginCountry(""); setOriginCity(""); setOriginPort("");
    setDestCountry(""); setDestCity(""); setDestPort(""); setMode("ocean"); setWeight("");
    setWeightUnit("kg"); setVolume(""); setPieces("1"); setCommodity(""); setDeclaredValue("");
    setCurrency("USD"); setNotes(""); setDeliveryMethod("port_delivery"); setNeedsContainerPickup(false);
  }, []);

  const canProceed = step === 0 ? originCountry.trim() && destCountry.trim() : step === 2 ? Number(weight) > 0 : true;
  const usesPort = mode === "air" || mode === "ocean" || mode === "fcl" || mode === "lcl";

  const submit = useCallback(async () => {
    setSubmitting(true); setError("");
    try {
      const from = originCity || originPort || originCountry;
      const to = destCity || destPort || destCountry;
      const { error: e } = await supabase.rpc("freight_create_quote", {
        p_title: `${FREIGHT_MODE_LABEL[mode]} — ${from} → ${to}`,
        p_origin_country: originCountry, p_origin_city: originCity, p_origin_port: usesPort ? originPort : "",
        p_dest_country: destCountry, p_dest_city: destCity, p_dest_port: usesPort ? destPort : "",
        p_freight_mode: mode, p_weight: Number(weight) || 0, p_weight_unit: weightUnit,
        p_volume: Number(volume) || 0, p_volume_unit: "cbm", p_pieces: Math.max(Number(pieces) || 1, 1),
        p_commodity: commodity, p_declared_value: Number(declaredValue) || 0, p_currency: currency,
        p_notes: notes, p_delivery_method: deliveryMethod,
        p_needs_container_pickup: needsContainerPickup || deliveryMethod === "door_pickup",
      });
      if (e) throw e;
      reset();
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit request.");
    } finally {
      setSubmitting(false);
    }
  }, [supabase, mode, originCountry, originCity, originPort, destCountry, destCity, destPort, usesPort, weight, weightUnit, volume, pieces, commodity, declaredValue, currency, notes, deliveryMethod, needsContainerPickup, reset, onSubmitted]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Get a freight quote · {STEPS[step]}</DialogTitle></DialogHeader>
        <div className="h-1 w-full rounded bg-muted"><div className="h-1 rounded bg-blue-500 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto py-2">
          {step === 0 && (
            <>
              <Field label="Origin country"><CountryInput value={originCountry} onChange={setOriginCountry} /></Field>
              <Field label="Origin city"><Input value={originCity} onChange={(e) => setOriginCity(e.target.value)} placeholder="City" /></Field>
              <Field label="Destination country"><CountryInput value={destCountry} onChange={setDestCountry} /></Field>
              <Field label="Destination city"><Input value={destCity} onChange={(e) => setDestCity(e.target.value)} placeholder="City" /></Field>
            </>
          )}
          {step === 1 && (
            <div className="space-y-2">
              {FREIGHT_MODES.map((m) => {
                const Icon = MODE_ICON[m.value];
                const active = mode === m.value;
                return (
                  <button key={m.value} type="button" onClick={() => setMode(m.value)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${active ? "border-blue-500 bg-blue-500/10" : "border-white/5 bg-card/60 hover:border-white/20"}`}>
                    <Icon className="h-5 w-5 text-blue-400" />
                    <div><p className="text-sm font-medium">{m.label}</p><p className="text-xs text-muted-foreground">{m.sublabel}</p></div>
                  </button>
                );
              })}
              {usesPort && (
                <>
                  <Field label={`Origin ${mode === "air" ? "airport" : "port"} (optional)`}><Input value={originPort} onChange={(e) => setOriginPort(e.target.value)} /></Field>
                  <Field label={`Destination ${mode === "air" ? "airport" : "port"} (optional)`}><Input value={destPort} onChange={(e) => setDestPort(e.target.value)} /></Field>
                </>
              )}
            </div>
          )}
          {step === 2 && (
            <>
              <div className="flex items-end gap-2">
                <Field label={`Total weight (${weightUnit})`} className="flex-1"><Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" /></Field>
                <UnitToggle value={weightUnit} options={["kg", "lb"]} onChange={(v) => setWeightUnit(v as "kg" | "lb")} />
              </div>
              <Field label="Total volume (CBM, optional)"><Input type="number" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="0" /></Field>
              <Field label="Pieces"><Input type="number" value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder="1" /></Field>
            </>
          )}
          {step === 3 && (
            <>
              <Field label="Commodity / description"><Input value={commodity} onChange={(e) => setCommodity(e.target.value)} placeholder="e.g. Furniture, electronics" /></Field>
              <div className="flex items-end gap-2">
                <Field label="Declared value" className="flex-1"><Input type="number" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} placeholder="0" /></Field>
                <Field label="Currency"><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
              </div>
              <Field label="Notes (optional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else providers should know" /></Field>
            </>
          )}
          {step === 4 && (
            <div className="space-y-2">
              {DELIVERY_METHODS.map((d) => {
                const active = deliveryMethod === d.value;
                return (
                  <button key={d.value} type="button" onClick={() => setDeliveryMethod(d.value)}
                    className={`flex w-full flex-col rounded-lg border p-3 text-left transition ${active ? "border-blue-500 bg-blue-500/10" : "border-white/5 bg-card/60 hover:border-white/20"}`}>
                    <span className="text-sm font-medium">{d.label}</span>
                    <span className="text-xs text-muted-foreground">{d.sublabel}</span>
                  </button>
                );
              })}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/5 bg-card/60 p-3">
                <input type="checkbox" checked={needsContainerPickup} onChange={(e) => setNeedsContainerPickup(e.target.checked)} />
                <span className="text-sm">I also need container pickup / drayage (truckers quote this leg separately)</span>
              </label>
            </div>
          )}
          {step === 5 && (
            <div className="space-y-1.5 text-sm">
              <ReviewRow label="Mode" value={FREIGHT_MODE_LABEL[mode]} />
              <ReviewRow label="Route" value={`${originCity || originCountry} → ${destCity || destCountry}`} />
              <ReviewRow label="Weight" value={`${weight || "0"} ${weightUnit}${volume ? ` · ${volume} CBM` : ""}`} />
              <ReviewRow label="Pieces" value={pieces || "1"} />
              {commodity ? <ReviewRow label="Commodity" value={commodity} /> : null}
              {declaredValue ? <ReviewRow label="Declared value" value={`${declaredValue} ${currency}`} /> : null}
              <ReviewRow label="Delivery" value={DELIVERY_METHODS.find((d) => d.value === deliveryMethod)?.label ?? ""} />
              {(needsContainerPickup || deliveryMethod === "door_pickup") ? <ReviewRow label="Ground leg" value="Container pickup / drayage requested" /> : null}
              <p className="mt-3 rounded-md bg-amber-500/10 p-3 text-xs text-amber-300">After you submit, an admin reviews the request. Once approved it opens for competing quotes.</p>
            </div>
          )}
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
          {step === STEPS.length - 1 ? (
            <Button onClick={() => void submit()} disabled={submitting}><Send className="mr-1.5 h-4 w-4" /> {submitting ? "Submitting…" : "Submit request"}</Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed}>Continue</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Provider board ---------------- */

function ProviderBoard({ kind }: { kind: "freight" | "ground" }) {
  const supabase = getBrowserSupabase();
  const [scope, setScope] = useState<"open" | "mine">("open");
  const [target, setTarget] = useState<BoardRow | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
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
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const openQuote = (r: BoardRow) => {
    setTarget(r); setAmount(r.my_offer_amount ? String(r.my_offer_amount) : "");
    setCurrency(r.my_offer_currency ?? r.currency ?? "USD"); setTransit(""); setNote(""); setError("");
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
    <>
      <div className="flex gap-2">
        {(["open", "mine"] as const).map((s) => (
          <Button key={s} variant={scope === s ? "default" : "secondary"} size="sm" onClick={() => setScope(s)}>
            {s === "open" ? (kind === "ground" ? "Pickup requests" : "Open requests") : "My quotes"}
          </Button>
        ))}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nothing here yet. Approved requests will appear for you to quote.</CardContent></Card>
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
                    <p className="text-xs text-amber-300">Quoting opens once an admin approves this request.</p>
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
          <DialogHeader><DialogTitle>{kind === "ground" ? "Quote pickup leg" : "Send a quote"}</DialogTitle></DialogHeader>
          <p className="truncate text-sm text-muted-foreground">{target?.title}</p>
          <div className="flex items-end gap-2">
            <Field label="Amount" className="flex-1"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></Field>
            <Field label="Currency"><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          </div>
          <Field label="Transit days (optional)"><Input type="number" value={transit} onChange={(e) => setTransit(e.target.value)} placeholder="0" /></Field>
          <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Routing, conditions, validity…" /></Field>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button onClick={() => void submit()} disabled={busy}><Send className="mr-1.5 h-4 w-4" /> {busy ? "Submitting…" : "Submit quote"}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------------- small helpers ---------------- */

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`space-y-1.5 ${className ?? ""}`}><Label>{label}</Label>{children}</div>;
}

function CountryInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Input list="gf-countries" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Select or type a country" />
      <datalist id="gf-countries">{COUNTRY_NAMES.map((c) => <option key={c} value={c} />)}</datalist>
    </>
  );
}

function UnitToggle({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 rounded-md border border-input p-1">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`rounded px-3 py-1.5 text-sm font-medium ${value === o ? "bg-blue-500 text-white" : "text-muted-foreground"}`}>{o}</button>
      ))}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-white/5 py-2"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>;
}
