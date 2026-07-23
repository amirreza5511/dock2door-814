"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, MapPin, Printer, Truck, CheckCircle2, Clock } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCode } from "@/components/qr-code";
import { qrSvgString } from "@/lib/qr";

type Service = "regular" | "expedited" | "xpresspost" | "priority";
const SERVICES: { key: Service; label: string; eta: string }[] = [
  { key: "regular", label: "Regular", eta: "5–9 business days" },
  { key: "expedited", label: "Expedited", eta: "2–5 business days" },
  { key: "xpresspost", label: "Xpresspost", eta: "1–2 business days" },
  { key: "priority", label: "Priority", eta: "Next business day" },
];
const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AED", "CNY"] as const;

interface Parcel {
  id: string;
  tracking_number: string;
  status: string;
  to_name: string;
  to_city: string;
  to_region: string;
  to_country: string;
  from_city: string;
  from_country: string;
  service: string;
  price: number;
  currency: string;
  weight: number;
  weight_unit: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  dim_unit: string;
  is_placeholder: boolean;
  created_at: string;
}

interface Quote {
  chargeable_kg: number;
  price: number;
  currency: string;
  is_placeholder: boolean;
}

export default function CustomerParcelPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [labelParcel, setLabelParcel] = useState<Parcel | null>(null);

  const listQuery = useQuery({
    queryKey: ["parcel", "mine"],
    queryFn: async (): Promise<Parcel[]> => {
      const { data, error } = await supabase.rpc("parcel_list_mine");
      if (error) return [];
      return (data as Parcel[] | null) ?? [];
    },
  });

  const parcels = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const onCreated = useCallback(
    async (parcel: Parcel | null) => {
      setWizardOpen(false);
      await qc.invalidateQueries({ queryKey: ["parcel", "mine"] });
      if (parcel) setLabelParcel(parcel);
    },
    [qc],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Parcel Counter</p>
          <h1 className="text-2xl font-semibold tracking-tight">Ship a parcel</h1>
          <p className="mt-1 text-sm text-muted-foreground">Size a parcel, get a price, and print a drop-off label with a scannable barcode.</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>New parcel</Button>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : parcels.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Package className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No parcels yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Tap &quot;New parcel&quot; to size a parcel, get a price, and print a drop-off label.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {parcels.map((p) => (
            <button
              key={p.id}
              onClick={() => setLabelParcel(p)}
              className="block w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-white/20"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-sm font-bold">
                  <Package className="h-4 w-4 text-primary" />
                  {p.tracking_number}
                </span>
                <Badge variant="secondary">{p.status}</Badge>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {p.from_city || p.from_country} → {p.to_city}, {p.to_region || p.to_country}
              </p>
              <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  {SERVICES.find((s) => s.key === p.service)?.label ?? p.service} · {p.weight} {p.weight_unit}
                </span>
                <span className="text-sm font-bold">
                  {p.currency} {Number(p.price).toFixed(2)}
                </span>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Printer className="h-3 w-3" /> Tap to view / print label
              </p>
            </button>
          ))}
        </div>
      )}

      {wizardOpen && <ParcelWizard onClose={() => setWizardOpen(false)} onCreated={onCreated} />}
      {labelParcel && <LabelDialog parcel={labelParcel} onClose={() => setLabelParcel(null)} />}
    </div>
  );
}

function ParcelWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (parcel: Parcel | null) => void }) {
  const supabase = getBrowserSupabase();
  const [step, setStep] = useState<0 | 1>(0);

  const [toName, setToName] = useState<string>("");
  const [toLine1, setToLine1] = useState<string>("");
  const [toCity, setToCity] = useState<string>("");
  const [toRegion, setToRegion] = useState<string>("");
  const [toPostal, setToPostal] = useState<string>("");
  const [toCountry, setToCountry] = useState<string>("CA");
  const [fromCity, setFromCity] = useState<string>("");
  const [fromRegion, setFromRegion] = useState<string>("");
  const [fromPostal, setFromPostal] = useState<string>("");
  const [length, setLength] = useState<string>("");
  const [width, setWidth] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [dimUnit, setDimUnit] = useState<"cm" | "in">("cm");
  const [weight, setWeight] = useState<string>("");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lb">("kg");
  const [service, setService] = useState<Service>("regular");
  const [currency, setCurrency] = useState<string>("CAD");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quoteMutation = useMutation({
    mutationFn: async (): Promise<Quote | null> => {
      const w = Number(weight);
      if (!Number.isFinite(w) || w <= 0) return null;
      const { data, error: err } = await supabase.rpc("parcel_quote", {
        p_length: Number(length) || 0,
        p_width: Number(width) || 0,
        p_height: Number(height) || 0,
        p_dim_unit: dimUnit,
        p_weight: w,
        p_weight_unit: weightUnit,
        p_service: service,
        p_currency: currency,
      });
      if (err) throw new Error(err.message);
      const row = Array.isArray(data) ? data[0] : data;
      return (row as Quote) ?? null;
    },
    onSuccess: (q) => setQuote(q),
    onError: () => setQuote(null),
  });

  const create = useMutation({
    mutationFn: async (): Promise<Parcel | null> => {
      const w = Number(weight);
      if (!Number.isFinite(w) || w <= 0) throw new Error("Enter the parcel weight.");
      const { data, error: err } = await supabase.rpc("parcel_create", {
        p_from_name: "",
        p_from_line1: "",
        p_from_city: fromCity,
        p_from_region: fromRegion,
        p_from_postal: fromPostal,
        p_from_country: "CA",
        p_to_name: toName.trim(),
        p_to_line1: toLine1,
        p_to_city: toCity.trim(),
        p_to_region: toRegion,
        p_to_postal: toPostal,
        p_to_country: toCountry,
        p_length: Number(length) || 0,
        p_width: Number(width) || 0,
        p_height: Number(height) || 0,
        p_dim_unit: dimUnit,
        p_weight: w,
        p_weight_unit: weightUnit,
        p_service: service,
        p_currency: currency,
        p_notes: "",
      });
      if (err) throw new Error(err.message);
      const id = data as string;
      const { data: row } = await supabase.rpc("parcel_get", { p_id: id });
      const parcel = Array.isArray(row) ? row[0] : row;
      return (parcel as Parcel) ?? null;
    },
    onSuccess: (parcel) => onCreated(parcel),
    onError: (e: Error) => setError(e.message),
  });

  const goToPricing = () => {
    if (!toName.trim() || !toCity.trim()) {
      setError("Recipient name and city are required.");
      return;
    }
    setError(null);
    setStep(1);
    quoteMutation.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step === 0 ? "Addresses" : "Size, service & price"}</DialogTitle>
        </DialogHeader>
        <div className="mt-1 flex gap-1.5">
          {[0, 1].map((s) => (
            <span key={s} className={`h-1 flex-1 rounded-full ${step >= s ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>

        {step === 0 ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ship to</p>
            <Field label="Recipient name *">
              <Input value={toName} onChange={(e) => setToName(e.target.value)} placeholder="Jane Doe" />
            </Field>
            <Field label="Address">
              <Input value={toLine1} onChange={(e) => setToLine1(e.target.value)} placeholder="123 King St W" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City *">
                <Input value={toCity} onChange={(e) => setToCity(e.target.value)} placeholder="Toronto" />
              </Field>
              <Field label="Region">
                <Input value={toRegion} onChange={(e) => setToRegion(e.target.value)} placeholder="ON" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Postal / ZIP">
                <Input value={toPostal} onChange={(e) => setToPostal(e.target.value)} placeholder="M5V 1J2" />
              </Field>
              <Field label="Country">
                <Input value={toCountry} onChange={(e) => setToCountry(e.target.value)} placeholder="CA" />
              </Field>
            </div>
            <p className="mt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Ship from (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input value={fromCity} onChange={(e) => setFromCity(e.target.value)} placeholder="Vancouver" />
              </Field>
              <Field label="Region">
                <Input value={fromRegion} onChange={(e) => setFromRegion(e.target.value)} placeholder="BC" />
              </Field>
            </div>
            <Field label="Postal / ZIP">
              <Input value={fromPostal} onChange={(e) => setFromPostal(e.target.value)} placeholder="V6B 1A1" />
            </Field>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <Button className="w-full" onClick={goToPricing}>Continue</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Dimensions</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="L"><Input value={length} onChange={(e) => setLength(e.target.value)} inputMode="numeric" placeholder="40" /></Field>
              <Field label="W"><Input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="numeric" placeholder="30" /></Field>
              <Field label="H"><Input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="numeric" placeholder="20" /></Field>
            </div>
            <Toggle options={["cm", "in"]} value={dimUnit} onChange={(v) => setDimUnit(v as "cm" | "in")} />
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Weight</p>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field label="Weight *"><Input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" placeholder="3" /></Field>
              </div>
              <Toggle options={["kg", "lb"]} value={weightUnit} onChange={(v) => setWeightUnit(v as "kg" | "lb")} />
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Service</p>
            <div className="space-y-2">
              {SERVICES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setService(s.key)}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors ${
                    service === s.key ? "border-primary bg-primary/10" : "border-border hover:border-white/20"
                  }`}
                >
                  <span>
                    <span className={`block text-sm font-bold ${service === s.key ? "text-primary" : ""}`}>{s.label}</span>
                    <span className="block text-xs text-muted-foreground">{s.eta}</span>
                  </span>
                  {service === s.key && <CheckCircle2 className="h-5 w-5 text-primary" />}
                </button>
              ))}
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Currency</p>
            <div className="flex flex-wrap gap-2">
              {CURRENCIES.map((cur) => (
                <button
                  key={cur}
                  onClick={() => setCurrency(cur)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    currency === cur ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {cur}
                </button>
              ))}
            </div>
            <Button variant="secondary" className="w-full" disabled={quoteMutation.isPending} onClick={() => quoteMutation.mutate()}>
              Get price
            </Button>
            {quote && (
              <div className="rounded-xl border border-primary bg-primary/10 p-4 text-center">
                <p className="text-xs font-semibold text-muted-foreground">Estimated price</p>
                <p className="text-3xl font-bold text-primary">{quote.currency} {Number(quote.price).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Chargeable weight {Number(quote.chargeable_kg).toFixed(1)} kg</p>
                {quote.is_placeholder && (
                  <p className="mt-1 text-xs text-yellow-400">Placeholder rate — live Canada Post rates apply once API keys are added.</p>
                )}
              </div>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => setStep(0)}>Back</Button>
              <Button className="flex-[2]" disabled={create.isPending} onClick={() => { setError(null); create.mutate(); }}>
                Create &amp; get label
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LabelDialog({ parcel, onClose }: { parcel: Parcel; onClose: () => void }) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const setStatus = useMutation({
    mutationFn: async (status: "DroppedOff" | "InTransit" | "Delivered") => {
      const { error } = await supabase.rpc("parcel_set_status", { p_id: parcel.id, p_status: status });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["parcel", "mine"] });
    },
  });

  const svc = SERVICES.find((s) => s.key === parcel.service)?.label ?? parcel.service;

  const handlePrint = useCallback(() => {
    const qrSvg = qrSvgString(parcel.tracking_number, 6, 8);
    const html = `
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1"/>
      <style>
        body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:24px;color:#111}
        .label{border:2px solid #111;border-radius:12px;padding:20px;max-width:420px;margin:0 auto}
        .row{display:flex;justify-content:space-between;align-items:flex-start}
        .svc{font-size:22px;font-weight:800;text-transform:uppercase}
        .ph{background:#ffe08a;color:#7a5900;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px}
        .sec{margin-top:14px;padding-top:14px;border-top:1px dashed #999}
        .lbl{font-size:10px;letter-spacing:1px;color:#666;text-transform:uppercase}
        .val{font-size:15px;font-weight:600;margin-top:2px}
        .qr{text-align:center;margin-top:16px}
        .qr svg{width:180px;height:180px}
        .track{font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;text-align:center;margin-top:6px}
      </style></head>
      <body><div class="label">
        <div class="row"><div class="svc">${svc}</div>${parcel.is_placeholder ? '<div class="ph">PLACEHOLDER</div>' : ""}</div>
        <div class="sec"><div class="lbl">To</div><div class="val">${parcel.to_name}</div>
          <div class="val">${parcel.to_city}, ${parcel.to_region || ""} ${parcel.to_country}</div></div>
        <div class="sec"><div class="lbl">Weight / Price</div>
          <div class="val">${parcel.weight} ${parcel.weight_unit} · ${parcel.currency} ${Number(parcel.price).toFixed(2)}</div></div>
        <div class="qr">${qrSvg}</div>
        <div class="track">${parcel.tracking_number}</div>
      </div>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=520,height=720");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }, [parcel, svc]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Shipping label</DialogTitle>
        </DialogHeader>
        <div className="mt-3 space-y-4">
          <div className="rounded-2xl border-2 border-black bg-white p-5 text-black">
            <div className="flex items-start justify-between">
              <span className="text-2xl font-extrabold">{svc.toUpperCase()}</span>
              {parcel.is_placeholder && (
                <span className="rounded bg-[#ffe08a] px-2 py-0.5 text-[10px] font-extrabold text-[#7a5900]">PLACEHOLDER</span>
              )}
            </div>
            <div className="mt-3 border-t border-dashed border-gray-300 pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">To</p>
              <p className="text-sm font-semibold">{parcel.to_name}</p>
              <p className="text-sm font-semibold">{parcel.to_city}, {parcel.to_region || ""} {parcel.to_country}</p>
            </div>
            <div className="mt-3 border-t border-dashed border-gray-300 pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Weight / Price</p>
              <p className="text-sm font-semibold">{parcel.weight} {parcel.weight_unit} · {parcel.currency} {Number(parcel.price).toFixed(2)}</p>
            </div>
            <div className="mt-4 flex justify-center">
              <QRCode value={parcel.tracking_number} size={170} />
            </div>
            <p className="mt-2 text-center font-mono text-lg font-bold tracking-widest">{parcel.tracking_number}</p>
          </div>

          {parcel.is_placeholder && (
            <p className="text-center text-xs text-yellow-400">
              Placeholder label &amp; barcode so you can test the full flow. Real Canada Post labels + rates activate once API keys are added.
            </p>
          )}

          <Button className="w-full" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" /> Print / share label
          </Button>

          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Update status</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { s: "DroppedOff" as const, icon: Package, label: "Dropped off" },
              { s: "InTransit" as const, icon: Truck, label: "In transit" },
              { s: "Delivered" as const, icon: CheckCircle2, label: "Delivered" },
            ]).map(({ s, icon: Icon, label }) => (
              <button
                key={s}
                onClick={() => setStatus.mutate(s)}
                className={`flex flex-col items-center gap-1 rounded-xl border py-3 transition-colors ${
                  parcel.status === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="text-[11px] font-semibold">{label}</span>
              </button>
            ))}
          </div>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Current: {parcel.status}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-md border px-4 py-2 text-sm font-semibold transition-colors ${
            value === o ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
