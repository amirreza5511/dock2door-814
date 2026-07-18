"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ruler, MapPin, Percent, CheckCircle2, X } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface TierInfo { id: string; min_sqft: number; rate: number }
interface AddonInfo { id: string; name: string; pricing_unit: string; rate: number; required: boolean }
interface SpaceRow {
  id: string;
  name: string;
  space_kind: string;
  city: string;
  address: string;
  provider_name: string;
  total_sqft: number;
  available_sqft: number;
  min_sqft: number;
  max_sqft: number | null;
  base_rate_per_sqft_month: number;
  currency: string;
  min_term_months: number;
  term_discount_3m_pct: number;
  term_discount_6m_pct: number;
  term_discount_12m_pct: number;
  features: string[];
  notes: string;
  tiers: TierInfo[];
  addons: AddonInfo[];
}
interface QuoteResult {
  applied_rate: number;
  tier_min_sqft: number | null;
  term_discount_pct: number;
  term_discount_label: string;
  space_monthly: number;
  addons: { id: string; name: string; monthly: number; one_time: number }[];
  monthly_total: number;
  one_time_total: number;
  contract_total: number;
  currency: string;
}
interface MyBooking {
  id: string;
  space_name: string;
  provider_name: string;
  sqft: number;
  term_months: number;
  start_date: string;
  monthly_total: number;
  contract_total: number;
  currency: string;
  status: string;
  months_billed: number;
}

const KIND_LABEL: Record<string, string> = {
  Floor: "Floor storage", Rack: "Racked", ClimateControlled: "Climate controlled",
  Secured: "Secured cage", Outdoor: "Outdoor yard", Hazmat: "Hazmat certified",
};
const STATUS_CLASS: Record<string, string> = {
  Requested: "bg-yellow-500/15 text-yellow-300",
  Active: "bg-emerald-500/15 text-emerald-300",
  Declined: "bg-red-500/15 text-red-300",
  Cancelled: "bg-white/10 text-muted-foreground",
  Completed: "bg-blue-500/15 text-blue-300",
};

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Shared flex-space marketplace: rent warehouse square footage with transparent pricing. */
export default function SpacesBrowsePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [error, setError] = useState("");

  const browseQ = useQuery({
    queryKey: ["spaces", "browse"],
    refetchInterval: 30000,
    queryFn: async (): Promise<SpaceRow[]> => {
      const { data, error: e } = await supabase.rpc("space_browse");
      if (e) return [];
      return (data as SpaceRow[] | null) ?? [];
    },
  });

  const mineQ = useQuery({
    queryKey: ["spaces", "bookings", "customer"],
    refetchInterval: 20000,
    queryFn: async (): Promise<MyBooking[]> => {
      const { data, error: e } = await supabase.rpc("space_list_bookings", { p_scope: "customer" });
      if (e) return [];
      return (data as MyBooking[] | null) ?? [];
    },
  });

  // Booking dialog state
  const [selected, setSelected] = useState<SpaceRow | null>(null);
  const [sqft, setSqft] = useState("");
  const [term, setTerm] = useState("1");
  const [startDate, setStartDate] = useState(todayPlus(3));
  const [picked, setPicked] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const sqftNum = Number(sqft) || 0;
  const termNum = Number(term) || 0;
  const quoteEnabled = !!selected
    && sqftNum >= (selected?.min_sqft ?? 1)
    && sqftNum <= (selected?.available_sqft ?? 0)
    && termNum >= (selected?.min_term_months ?? 1);

  const quoteQ = useQuery({
    queryKey: ["spaces", "quote", selected?.id, sqftNum, termNum, picked],
    enabled: quoteEnabled,
    queryFn: async (): Promise<QuoteResult> => {
      const { data, error: e } = await supabase.rpc("warehouse_space_quote", {
        p_space_id: selected?.id, p_sqft: sqftNum, p_term_months: termNum, p_addon_ids: picked,
      });
      if (e) throw new Error(e.message);
      return data as QuoteResult;
    },
  });
  const quote = quoteQ.data;

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a space first");
      const { error: e } = await supabase.rpc("space_request_booking", {
        p_space_id: selected.id, p_sqft: sqftNum, p_term_months: termNum,
        p_start_date: startDate, p_addon_ids: picked, p_notes: notes.trim(),
      });
      if (e) throw new Error(e.message);
    },
    onSuccess: () => {
      setSelected(null);
      setError("");
      void qc.invalidateQueries({ queryKey: ["spaces"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const withdrawMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error: e } = await supabase.rpc("space_end_booking", { p_booking_id: bookingId, p_note: "" });
      if (e) throw new Error(e.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["spaces"] }),
    onError: (e: Error) => setError(e.message),
  });

  const openBooking = (s: SpaceRow) => {
    setSelected(s);
    setSqft(String(s.min_sqft));
    setTerm(String(s.min_term_months));
    setStartDate(todayPlus(3));
    setPicked(s.addons.filter((a) => a.required).map((a) => a.id));
    setNotes("");
    setError("");
  };

  const toggleAddon = (a: AddonInfo) => {
    if (a.required) return;
    setPicked((prev) => (prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]));
  };

  const spaces = useMemo(() => browseQ.data ?? [], [browseQ.data]);
  const mine = useMemo(() => mineQ.data ?? [], [mineQ.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Shared warehousing</p>
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse space, by the square foot</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pay only for the footprint you use — volume tiers, term discounts and add-on services, all priced transparently.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {mine.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">My rentals</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {mine.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{b.space_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.provider_name} · {Number(b.sqft).toLocaleString()} sqft · ${Number(b.monthly_total).toFixed(2)}/mo × {b.term_months} mo
                    {b.status === "Active" ? ` · billed ${b.months_billed}/${b.term_months}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_CLASS[b.status] ?? ""}>{b.status}</Badge>
                  {b.status === "Requested" && (
                    <Button size="sm" variant="outline" disabled={withdrawMutation.isPending} onClick={() => withdrawMutation.mutate(b.id)}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Available spaces ({spaces.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {browseQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : spaces.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Ruler className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No spaces listed yet. Warehouse providers publish square footage here — floor, racked, climate-controlled, secured and outdoor.</p>
            </div>
          ) : (
            spaces.map((s) => (
              <div key={s.id} className="rounded-lg border border-white/5 bg-card/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.provider_name}</p>
                    {(s.city || s.address) && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />{[s.address, s.city].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                  <Badge className="bg-primary/15 text-primary">{KIND_LABEL[s.space_kind] ?? s.space_kind}</Badge>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xl font-bold">${Number(s.base_rate_per_sqft_month).toFixed(2)}<span className="text-xs font-medium text-muted-foreground"> /sqft/mo</span></p>
                    <p className="text-xs text-muted-foreground">{Number(s.available_sqft).toLocaleString()} sqft available · min {Number(s.min_sqft).toLocaleString()}</p>
                  </div>
                  <Button size="sm" onClick={() => openBooking(s)}>Get a price</Button>
                </div>
                {(s.tiers.length > 0 || s.term_discount_12m_pct > 0 || s.term_discount_6m_pct > 0 || s.term_discount_3m_pct > 0) && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                    <Percent className="h-3 w-3" />
                    {[
                      s.tiers.length > 0 ? `volume tiers from $${Math.min(...s.tiers.map((t) => Number(t.rate))).toFixed(2)}` : "",
                      s.term_discount_12m_pct > 0 ? `up to −${s.term_discount_12m_pct}% on 12-mo terms` : s.term_discount_6m_pct > 0 ? `−${s.term_discount_6m_pct}% on 6-mo terms` : s.term_discount_3m_pct > 0 ? `−${s.term_discount_3m_pct}% on 3-mo terms` : "",
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Quote + request dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {selected?.provider_name} · {Number(selected?.available_sqft ?? 0).toLocaleString()} sqft available
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Square feet (min {Number(selected?.min_sqft ?? 0).toLocaleString()})</Label>
                <Input type="number" value={sqft} onChange={(e) => setSqft(e.target.value)} />
              </div>
              <div>
                <Label>Term (months, min {selected?.min_term_months ?? 1})</Label>
                <Input type="number" value={term} onChange={(e) => setTerm(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>

            {(selected?.addons ?? []).length > 0 && (
              <div>
                <Label>Add-on services</Label>
                <div className="mt-1 space-y-1.5">
                  {(selected?.addons ?? []).map((a) => {
                    const on = picked.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        disabled={a.required}
                        onClick={() => toggleAddon(a)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${on ? "border-primary bg-primary/10" : "border-white/10"}`}
                      >
                        {on ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <X className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="flex-1">{a.name}{a.required ? " (required)" : ""}</span>
                        <span className="font-semibold">
                          ${Number(a.rate).toFixed(2)} {a.pricing_unit === "per_sqft_month" ? "/sqft/mo" : a.pricing_unit === "per_month" ? "/mo" : "once"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <Label>Notes for the warehouse</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What are you storing? Any handling needs?" />
            </div>

            {/* Live breakdown */}
            <div className="rounded-lg bg-muted/40 p-3 text-xs">
              {!quoteEnabled ? (
                <p className="text-center text-muted-foreground">
                  Enter at least {Number(selected?.min_sqft ?? 0).toLocaleString()} sqft (max {Number(selected?.available_sqft ?? 0).toLocaleString()}) and {selected?.min_term_months ?? 1}+ months to see your price.
                </p>
              ) : quoteQ.isLoading ? (
                <p className="text-center text-muted-foreground">Calculating…</p>
              ) : quoteQ.error ? (
                <p className="text-center text-red-400">{(quoteQ.error as Error).message}</p>
              ) : quote ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Rate</span><span>${Number(quote.applied_rate).toFixed(2)}/sqft/mo{quote.tier_min_sqft ? ` (tier ${Number(quote.tier_min_sqft).toLocaleString()}+)` : ""}</span></div>
                  {quote.term_discount_pct > 0 && (
                    <div className="flex justify-between"><span className="text-muted-foreground">{quote.term_discount_label}</span><span className="text-emerald-300">−{quote.term_discount_pct}%</span></div>
                  )}
                  <div className="flex justify-between"><span className="text-muted-foreground">Space ({sqftNum.toLocaleString()} sqft)</span><span>${Number(quote.space_monthly).toFixed(2)}/mo</span></div>
                  {(quote.addons ?? []).map((a) => (
                    <div key={a.id} className="flex justify-between"><span className="text-muted-foreground">{a.name}</span><span>{a.monthly > 0 ? `$${Number(a.monthly).toFixed(2)}/mo` : `$${Number(a.one_time).toFixed(2)} once`}</span></div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-white/10 pt-1.5 font-semibold">
                    <span>Monthly total</span><span className="text-emerald-300">${Number(quote.monthly_total).toFixed(2)} {quote.currency}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Contract ({termNum} mo{Number(quote.one_time_total) > 0 ? " + one-time" : ""})</span><span>${Number(quote.contract_total).toFixed(2)} {quote.currency}</span></div>
                </div>
              ) : null}
            </div>

            <Button className="w-full" disabled={!quoteEnabled || requestMutation.isPending} onClick={() => requestMutation.mutate()}>
              {requestMutation.isPending ? "Sending…" : "Request this space"}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              The warehouse reviews your request. On approval the footprint is reserved, the price above is locked in, and your first monthly invoice is issued.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
