"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Box, Zap, Check, BadgeCheck, Package } from "lucide-react";
import {
  PRESET_BOXES, SERVICE_LEVELS, estimateBasePriceCad, deriveCourierQuotes, type CourierQuote,
} from "@/lib/couriers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ServiceLevel = "regular" | "expedited" | "xpresspost" | "priority";

export default function ShipQuotePage() {
  const [preset, setPreset] = useState("small");
  const [length, setLength] = useState("25");
  const [width, setWidth] = useState("20");
  const [height, setHeight] = useState("15");
  const [weight, setWeight] = useState("1");
  const [service, setService] = useState<ServiceLevel>("regular");
  const [quotes, setQuotes] = useState<CourierQuote[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const applyPreset = (key: string) => {
    const b = PRESET_BOXES.find((x) => x.key === key);
    if (!b) return;
    setPreset(key);
    setLength(String(b.l)); setWidth(String(b.w)); setHeight(String(b.h)); setWeight(String(b.kg));
    setQuotes(null); setSelected(null);
  };

  const getQuotes = () => {
    const base = estimateBasePriceCad(Number(length) || 0, Number(width) || 0, Number(height) || 0, Number(weight) || 0, service);
    const derived = deriveCourierQuotes(base);
    setQuotes(derived);
    setSelected(derived[0]?.courier.code ?? null);
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

      <Button onClick={getQuotes} className="w-full gap-2"><Zap className="h-4 w-4" /> {quotes ? "Refresh prices" : "Compare couriers"}</Button>

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
