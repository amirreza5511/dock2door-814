"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Box, Zap, Check, BadgeCheck, Package } from "lucide-react";
import {
  PRESET_BOXES, SERVICE_LEVELS, estimateBasePriceCad, deriveCourierQuotes, type CourierQuote,
} from "@/lib/couriers";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ServiceLevel = "regular" | "expedited" | "xpresspost" | "priority";

interface LiveRate {
  carrier: "SHIPPO" | "EASYPOST";
  provider: string;
  service_level: string;
  service_name: string;
  amount: number;
  currency: string;
  est_delivery_days?: number;
  carrier_rate_id: string;
}

export default function ShipQuotePage() {
  const [preset, setPreset] = useState("small");
  const [length, setLength] = useState("25");
  const [width, setWidth] = useState("20");
  const [height, setHeight] = useState("15");
  const [weight, setWeight] = useState("1");
  const [service, setService] = useState<ServiceLevel>("regular");
  const [quotes, setQuotes] = useState<CourierQuote[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fromPostal, setFromPostal] = useState("");
  const [toPostal, setToPostal] = useState("");
  const [country, setCountry] = useState("CA");
  const [liveRates, setLiveRates] = useState<LiveRate[] | null>(null);
  const [selectedLive, setSelectedLive] = useState<string | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);

  const applyPreset = (key: string) => {
    const b = PRESET_BOXES.find((x) => x.key === key);
    if (!b) return;
    setPreset(key);
    setLength(String(b.l)); setWidth(String(b.w)); setHeight(String(b.h)); setWeight(String(b.kg));
    setQuotes(null); setSelected(null); setLiveRates(null); setSelectedLive(null);
  };

  const getQuotes = async () => {
    const base = estimateBasePriceCad(Number(length) || 0, Number(width) || 0, Number(height) || 0, Number(weight) || 0, service);
    const derived = deriveCourierQuotes(base);
    setQuotes(derived);
    setSelected(derived[0]?.courier.code ?? null);

    if (fromPostal.trim() && toPostal.trim()) {
      setLoadingLive(true);
      try {
        const supabase = getBrowserSupabase();
        const { data, error } = await supabase.functions.invoke("parcel-rate-shop", {
          body: {
            from: { zip: fromPostal.trim(), country: country.trim() || "CA" },
            to: { zip: toPostal.trim(), country: country.trim() || "CA" },
            parcel: {
              length_cm: Number(length) || 10,
              width_cm: Number(width) || 10,
              height_cm: Number(height) || 10,
              weight_kg: Number(weight) || 0.5,
            },
          },
        });
        const rates = (!error && data ? (data as { rates?: LiveRate[] }).rates ?? [] : []) as LiveRate[];
        setLiveRates(rates);
        setSelectedLive(rates[0]?.carrier_rate_id ?? null);
      } catch {
        setLiveRates(null);
      } finally {
        setLoadingLive(false);
      }
    } else {
      setLiveRates(null);
      setSelectedLive(null);
    }
  };

  const fastest = useMemo(() => {
    if (!quotes || quotes.length === 0) return null;
    return [...quotes].sort((a, b) => a.courier.speedRank - b.courier.speedRank)[0]?.courier.code ?? null;
  }, [quotes]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <Link href="/ship" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="mb-6 text-2xl font-bold tracking-tight">Send a parcel</h1>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pick a size</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {PRESET_BOXES.map((b) => {
          const on = preset === b.key;
          return (
            <button key={b.key} onClick={() => applyPreset(b.key)}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${on ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
              <Box className={`h-5 w-5 ${on ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <p className="font-semibold">{b.label}</p>
                <p className="text-xs text-muted-foreground">{b.sub}</p>
              </div>
            </button>
          );
        })}
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Or enter exact size (cm · kg)</h2>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <div><label className="text-xs text-muted-foreground">Length</label><Input value={length} onChange={(e) => { setLength(e.target.value); setPreset(""); }} inputMode="numeric" /></div>
        <div><label className="text-xs text-muted-foreground">Width</label><Input value={width} onChange={(e) => { setWidth(e.target.value); setPreset(""); }} inputMode="numeric" /></div>
        <div><label className="text-xs text-muted-foreground">Height</label><Input value={height} onChange={(e) => { setHeight(e.target.value); setPreset(""); }} inputMode="numeric" /></div>
      </div>
      <div className="mb-6">
        <label className="text-xs text-muted-foreground">Weight (kg)</label>
        <Input value={weight} onChange={(e) => { setWeight(e.target.value); setPreset(""); }} inputMode="numeric" />
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route (for live rates)</h2>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div><label className="text-xs text-muted-foreground">From postal</label><Input value={fromPostal} onChange={(e) => { setFromPostal(e.target.value); setLiveRates(null); }} placeholder="V6B" /></div>
        <div><label className="text-xs text-muted-foreground">To postal</label><Input value={toPostal} onChange={(e) => { setToPostal(e.target.value); setLiveRates(null); }} placeholder="M5V" /></div>
        <div><label className="text-xs text-muted-foreground">Country</label><Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} placeholder="CA" /></div>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Speed</h2>
      <div className="mb-6 flex flex-wrap gap-2">
        {SERVICE_LEVELS.map((s) => {
          const on = service === s.value;
          return (
            <button key={s.value} onClick={() => { setService(s.value); setQuotes(null); setSelected(null); }}
              className={`rounded-lg border px-4 py-2 text-left transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"}`}>
              <span className="block text-sm font-semibold">{s.label}</span>
              <span className={`block text-xs ${on ? "opacity-80" : "text-muted-foreground"}`}>{s.sub}</span>
            </button>
          );
        })}
      </div>

      <Button onClick={getQuotes} disabled={loadingLive} className="w-full gap-2"><Zap className="h-4 w-4" /> {loadingLive ? "Getting prices…" : quotes ? "Refresh prices" : "Compare couriers"}</Button>

      {liveRates && liveRates.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live rates</h2>
            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600"><BadgeCheck className="h-3 w-3" />Live</span>
          </div>
          <div className="space-y-3">
            {liveRates.map((r, i) => {
              const on = r.carrier_rate_id === selectedLive;
              return (
                <button key={r.carrier_rate_id} onClick={() => setSelectedLive(r.carrier_rate_id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${on ? "border-2 border-primary" : "border"}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[10px] font-bold text-primary">{r.provider.slice(0, 4).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.service_name}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs">
                      {i === 0 && <span className="font-semibold text-emerald-600">Cheapest</span>}
                      {r.est_delivery_days ? <span className="text-muted-foreground">{r.est_delivery_days} days</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{r.currency} {r.amount.toFixed(2)}</span>
                    {on && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Real carrier rates. Sign in to buy a label and get a scannable barcode.</p>
          <Link href="/login?next=/dashboard" className="mt-5 block">
            <Button className="w-full gap-2"><Package className="h-4 w-4" /> Continue in the app to buy this label</Button>
          </Link>
        </div>
      )}

      {quotes && quotes.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose a courier</h2>
          <div className="space-y-3">
            {quotes.map((q, i) => {
              const on = q.courier.code === selected;
              return (
                <button key={q.courier.code} onClick={() => setSelected(q.courier.code)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${on ? "border-2" : "border"}`}
                  style={on ? { borderColor: q.courier.color } : undefined}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: q.courier.color }}>{q.courier.short}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{q.courier.name}</p>
                      {q.courier.implemented
                        ? <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600"><BadgeCheck className="h-3 w-3" />Live-ready</span>
                        : <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Est.</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs">
                      {i === 0 && <span className="font-semibold text-emerald-600">Cheapest</span>}
                      {fastest === q.courier.code && <span className="font-semibold text-amber-600">Fastest</span>}
                      <span className="text-muted-foreground">{q.etaLabel}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">CAD {q.price.toFixed(2)}</span>
                    {on && <Check className="h-4 w-4" style={{ color: q.courier.color }} />}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            These are estimates. Finish your shipment in the app to buy a real label, get a scannable barcode, and drop off or book a pickup.
          </p>
          <Link href="/login?next=/dashboard" className="mt-5 block">
            <Button className="w-full gap-2"><Package className="h-4 w-4" /> Continue in the app to print a label</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
