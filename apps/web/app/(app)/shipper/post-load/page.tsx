"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Calculator, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQuoteLoad, usePostLoad, useCargoClasses, useSetReceiverContact, VEHICLE_LABEL, CARGO_LABEL, CARGO_CLASS_OPTIONS, money } from "@/lib/hooks/use-loads";
import { useActionGuard } from "@/lib/explore-store";

const VEHICLES = Object.keys(VEHICLE_LABEL);
const CARGOS = Object.keys(CARGO_LABEL);

export default function PostLoadPage() {
  const router = useRouter();
  const guard = useActionGuard();
  const quote = useQuoteLoad();
  const post = usePostLoad();

  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupCity, setPickupCity] = useState("");
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLng, setPickupLng] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffCity, setDropoffCity] = useState("");
  const [dropoffLat, setDropoffLat] = useState("");
  const [dropoffLng, setDropoffLng] = useState("");
  const [vehicleType, setVehicleType] = useState("FiveTon");
  const [cargoType, setCargoType] = useState("Pallet");
  const [cargoClass, setCargoClass] = useState("General");
  const [pallets, setPallets] = useState("1");
  const [deliverySpeed, setDeliverySpeed] = useState<"SameDay" | "NextDay">("NextDay");
  const [notes, setNotes] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setContact = useSetReceiverContact();

  const coords = useMemo(
    () => ({
      pickupLat: Number(pickupLat),
      pickupLng: Number(pickupLng),
      dropoffLat: Number(dropoffLat),
      dropoffLng: Number(dropoffLng),
    }),
    [pickupLat, pickupLng, dropoffLat, dropoffLng],
  );
  const coordsValid =
    Number.isFinite(coords.pickupLat) && Number.isFinite(coords.pickupLng) &&
    Number.isFinite(coords.dropoffLat) && Number.isFinite(coords.dropoffLng) &&
    (coords.pickupLat !== 0 || coords.pickupLng !== 0) &&
    (coords.dropoffLat !== 0 || coords.dropoffLng !== 0);

  const cargoClasses = useCargoClasses();

  /** Live surcharge percent for a class (DB override, else default). */
  const pctFor = (cls: string): number => {
    const row = cargoClasses.data?.find((r) => r.cargo_class === cls);
    if (row) return Number(row.surcharge_pct);
    return CARGO_CLASS_OPTIONS.find((o) => o.cls === cls)?.defaultPct ?? 0;
  };
  const noteFor = (cls: string): string | undefined => {
    const row = cargoClasses.data?.find((r) => r.cargo_class === cls);
    return row?.note ?? CARGO_CLASS_OPTIONS.find((o) => o.cls === cls)?.note;
  };
  const activeClass = CARGO_CLASS_OPTIONS.find((o) => o.cls === cargoClass);

  const quoted = quote.data;

  const runQuote = async () => {
    if (!guard("Get an instant quote")) return;
    setError(null);
    if (!coordsValid) { setError("Enter valid pickup and drop-off coordinates first."); return; }
    try {
      await quote.mutateAsync({
        ...coords,
        vehicleType,
        pallets: Number(pallets) || 1,
        deliverySpeed,
        cargoType,
        cargoClass,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to price this load");
    }
  };

  const submit = async () => {
    if (!guard("Post a delivery")) return;
    setError(null);
    if (!coordsValid) { setError("Enter valid pickup and drop-off coordinates first."); return; }
    try {
      const res = await post.mutateAsync({
        ...coords,
        pickupAddress,
        pickupCity,
        dropoffAddress,
        dropoffCity,
        vehicleType,
        cargoType,
        cargoClass,
        pallets: Number(pallets) || 1,
        deliverySpeed,
        notes,
        recipientName,
        recipientPhone,
      });
      // Email isn't part of post_load's signature; persist it right after posting.
      if (recipientEmail.trim() && res.id) {
        try { await setContact.mutateAsync({ id: res.id, email: recipientEmail.trim() }); } catch {}
      }
      router.push(`/shipper/track/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to post load");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Shipper</p>
        <h1 className="text-2xl font-semibold tracking-tight">Post a delivery</h1>
        <p className="mt-1 text-sm text-muted-foreground">From an envelope to a full truckload. Enter the route and we&apos;ll price it instantly.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pickup</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Address" value={pickupAddress} onChange={setPickupAddress} className="sm:col-span-2" />
          <Field label="City" value={pickupCity} onChange={setPickupCity} />
          <div />
          <Field label="Latitude" value={pickupLat} onChange={setPickupLat} placeholder="43.6532" />
          <Field label="Longitude" value={pickupLng} onChange={setPickupLng} placeholder="-79.3832" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Drop-off</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Address" value={dropoffAddress} onChange={setDropoffAddress} className="sm:col-span-2" />
          <Field label="City" value={dropoffCity} onChange={setDropoffCity} />
          <div />
          <Field label="Latitude" value={dropoffLat} onChange={setDropoffLat} placeholder="45.4215" />
          <Field label="Longitude" value={dropoffLng} onChange={setDropoffLng} placeholder="-75.6972" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Cargo &amp; vehicle</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Cargo type" value={cargoType} onChange={setCargoType} options={CARGOS} labels={CARGO_LABEL} />
            <Select label="Vehicle" value={vehicleType} onChange={setVehicleType} options={VEHICLES} labels={VEHICLE_LABEL} />
            <Field label="How many (pallets/items)" value={pallets} onChange={setPallets} placeholder="1" />
            <Select label="Delivery speed" value={deliverySpeed} onChange={(v) => setDeliverySpeed(v as "SameDay" | "NextDay")} options={["SameDay", "NextDay"]} labels={{ SameDay: "Same day", NextDay: "Next day" }} />
          </div>
          <div className="space-y-2">
            <Label>Cargo class (affects price)</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CARGO_CLASS_OPTIONS.map((o) => {
                const pct = pctFor(o.cls);
                const active = cargoClass === o.cls;
                return (
                  <button
                    type="button"
                    key={o.cls}
                    onClick={() => setCargoClass(o.cls)}
                    className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-input hover:border-primary/40"}`}
                  >
                    <span className="text-sm font-medium">{o.emoji} {o.label}</span>
                    <span className={`text-xs ${pct > 0 ? "text-amber-400" : "text-muted-foreground"}`}>{pct > 0 ? `+${pct}%` : "No surcharge"}</span>
                  </button>
                );
              })}
            </div>
            {activeClass?.sensitive && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {noteFor(cargoClass) ?? "Restricted goods — extra documentation may be required."}
              </p>
            )}
            {!activeClass?.sensitive && noteFor(cargoClass) && (
              <p className="text-xs text-muted-foreground">{noteFor(cargoClass)}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recipient name" value={recipientName} onChange={setRecipientName} />
            <Field label="Recipient phone" value={recipientPhone} onChange={setRecipientPhone} />
            <Field label="Recipient email" value={recipientEmail} onChange={setRecipientEmail} className="sm:col-span-2" />
          </div>
          <p className="text-xs text-muted-foreground">Add a phone or email so you can share a live tracking link with the receiver — no account needed.</p>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the driver should know…" />
          </div>
        </CardContent>
      </Card>

      {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 to-transparent">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div>
            <p className="text-sm text-muted-foreground">Estimated price</p>
            <p className="text-3xl font-bold tracking-tight">{quoted?.total_price != null ? money(Number(quoted.total_price)) : "—"}</p>
            {quoted?.distance_km != null && <p className="text-xs text-muted-foreground">{String(quoted.distance_km)} km</p>}
            {quoted?.cargoClassSurcharge != null && Number(quoted.cargoClassSurcharge) > 0 && (
              <p className="text-xs text-amber-400">Cargo class (+{String(quoted.cargoClassPct ?? pctFor(cargoClass))}%): {money(Number(quoted.cargoClassSurcharge))}</p>
            )}
          </div>
          <Button variant="outline" onClick={() => void runQuote()} disabled={quote.isPending}>
            {quote.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
            Get quote
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button size="lg" onClick={() => void submit()} disabled={post.isPending || !coordsValid}>
          {post.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Post delivery
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, className }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Select({ label, value, onChange, options, labels }: { label: string; value: string; onChange: (v: string) => void; options: string[]; labels: Record<string, string> }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o} value={o}>{labels[o] ?? o}</option>
        ))}
      </select>
    </div>
  );
}
