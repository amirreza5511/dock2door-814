"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useMyCompanies } from "@/lib/hooks/use-active-company";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Building2, CheckCircle2, FileText, Package, Printer, Truck, User } from "lucide-react";

type TransportMode = "unspecified" | "own_driver" | "self_delivery" | "third_party";

const MODES: { key: Exclude<TransportMode, "unspecified">; label: string; hint: string; icon: typeof Truck }[] = [
  { key: "own_driver", label: "Dock2Door driver", hint: "One of our carriers hauls it", icon: Truck },
  { key: "self_delivery", label: "I bring it myself", hint: "Own car / van, no carrier", icon: User },
  { key: "third_party", label: "Third-party carrier", hint: "An outside trucking company", icon: Building2 },
];

const MODE_LABEL: Record<TransportMode, string> = {
  unspecified: "Not specified",
  own_driver: "Dock2Door driver",
  self_delivery: "Self delivery",
  third_party: "Third-party carrier",
};

function qrUrl(data: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`;
}

interface Booking {
  id: string;
  listing_id: string | null;
  customer_company_id: string | null;
  pallets_requested: number | null;
  start_date: string | null;
  end_date: string | null;
  handling_required: boolean | null;
  reference_number: string | null;
  transport_mode: TransportMode | null;
  carrier_name: string | null;
  driver_name: string | null;
  vehicle_plate: string | null;
  cargo_description: string | null;
  declared_pieces: number | null;
  declared_weight_kg: number | null;
  bol_issued_at: string | null;
}
interface Party { name: string | null; address: string | null; city: string | null }

export default function BillOfLadingPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const router = useRouter();
  const bookingId = useParams<{ bookingId: string }>().bookingId;
  const { data: companies } = useMyCompanies();
  const myCompanyIds = useMemo(() => new Set((companies ?? []).map((c) => c.company_id)), [companies]);

  const query = useQuery({
    queryKey: ["bol", bookingId],
    enabled: Boolean(bookingId),
    queryFn: async () => {
      const { data: booking, error } = await supabase
        .from("warehouse_bookings").select("*").eq("id", bookingId).maybeSingle();
      if (error || !booking) throw new Error("Booking not found");
      let listing: { company_id: string | null; name: string | null; address: string | null; city: string | null } | null = null;
      if (booking.listing_id) {
        const { data } = await supabase
          .from("warehouse_listings").select("company_id,name,address,city").eq("id", booking.listing_id).maybeSingle();
        listing = data;
      }
      const [warehouseCo, customerCo] = await Promise.all([
        listing?.company_id
          ? supabase.from("companies").select("name,address,city").eq("id", listing.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        booking.customer_company_id
          ? supabase.from("companies").select("name,address,city").eq("id", booking.customer_company_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        booking: booking as Booking,
        listing,
        warehouseCo: (warehouseCo.data as Party | null) ?? null,
        customerCo: (customerCo.data as Party | null) ?? null,
        isCustomer: booking.customer_company_id ? myCompanyIds.has(booking.customer_company_id) : false,
      };
    },
  });

  const b = query.data?.booking;
  const [mode, setMode] = useState<TransportMode>("unspecified");
  const [carrier, setCarrier] = useState("");
  const [driver, setDriver] = useState("");
  const [plate, setPlate] = useState("");
  const [cargo, setCargo] = useState("");
  const [pieces, setPieces] = useState("");
  const [weight, setWeight] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!b) return;
    setMode(b.transport_mode ?? "unspecified");
    setCarrier(b.carrier_name ?? "");
    setDriver(b.driver_name ?? "");
    setPlate(b.vehicle_plate ?? "");
    setCargo(b.cargo_description ?? "");
    setPieces(b.declared_pieces != null ? String(b.declared_pieces) : "");
    setWeight(b.declared_weight_kg != null ? String(b.declared_weight_kg) : "");
  }, [b]);

  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      const { error } = await supabase.rpc("warehouse_booking_set_transport", {
        p_booking_id: bookingId,
        p_transport_mode: mode === "unspecified" ? null : mode,
        p_carrier_name: carrier.trim() || null,
        p_driver_name: driver.trim() || null,
        p_vehicle_plate: plate.trim().toUpperCase() || null,
        p_cargo_description: cargo.trim() || null,
        p_declared_pieces: pieces.trim() ? Number(pieces) : null,
        p_declared_weight_kg: weight.trim() ? Number(weight) : null,
        p_issue_bol: issue,
      });
      if (error) throw error;
      return issue;
    },
    onSuccess: (issue) => {
      setMsg(issue ? "Bill of Lading issued." : "Transport details saved.");
      qc.invalidateQueries({ queryKey: ["bol", bookingId] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (query.isLoading) return <Centered>Loading document…</Centered>;
  if (query.isError || !query.data || !b) return <Centered>Booking not found.</Centered>;

  const { listing, warehouseCo, customerCo, isCustomer } = query.data;
  const ref = b.reference_number || `WB-${b.id.slice(0, 8).toUpperCase()}`;

  const doPrint = () => {
    const row = (l: string, v: string) => `<tr><td class="l">${l}</td><td class="v">${v || "—"}</td></tr>`;
    const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *{font-family:-apple-system,Helvetica,Arial,sans-serif}body{padding:28px;color:#111}
      .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:12px}
      .brand{font-size:22px;font-weight:800}.doc{text-align:right}.doc h1{font-size:16px;margin:0;text-transform:uppercase;letter-spacing:1px}
      .ref{font-size:24px;font-weight:800;margin-top:4px}.grid{display:flex;gap:16px;margin-top:20px}
      .box{flex:1;border:1px solid #ccc;border-radius:8px;padding:12px}.box h3{margin:0 0 6px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666}
      .box p{margin:2px 0;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:20px}
      td{padding:9px 10px;border-bottom:1px solid #eee;font-size:13px}td.l{color:#666;width:42%;text-transform:uppercase;font-size:10px}
      td.v{font-weight:600}.qr{text-align:center;margin-top:24px}.qr img{width:150px;height:150px}.qr p{font-size:11px;color:#666;margin-top:6px}
      .sign{display:flex;gap:16px;margin-top:40px}.sign div{flex:1;border-top:1px solid #111;padding-top:6px;font-size:11px;color:#666}
      .foot{margin-top:30px;font-size:10px;color:#999;text-align:center}
    </style></head><body>
      <div class="top"><div><div class="brand">Dock2Door</div><div style="font-size:11px;color:#666">Warehouse Bill of Lading</div></div>
      <div class="doc"><h1>Bill of Lading</h1><div class="ref">${ref}</div><div style="font-size:11px;color:#666">${new Date().toLocaleDateString()}</div></div></div>
      <div class="grid">
        <div class="box"><h3>Shipper (Customer)</h3><p><b>${customerCo?.name ?? "—"}</b></p><p>${customerCo?.address ?? ""} ${customerCo?.city ?? ""}</p></div>
        <div class="box"><h3>Consignee (Warehouse)</h3><p><b>${warehouseCo?.name ?? listing?.name ?? "—"}</b></p><p>${listing?.address ?? ""} ${listing?.city ?? ""}</p></div>
      </div>
      <table>
        ${row("Transport mode", MODE_LABEL[mode])}${row("Carrier", carrier)}${row("Driver", driver)}${row("Vehicle plate", plate)}
        ${row("Cargo description", cargo)}${row("Pallets booked", String(b.pallets_requested ?? 0))}${row("Pieces declared", pieces)}
        ${row("Weight (kg)", weight)}${row("Handling required", b.handling_required ? "Yes" : "No")}${row("Storage window", `${b.start_date ?? ""} → ${b.end_date ?? ""}`)}
      </table>
      <div class="qr"><img src="${qrUrl(ref, 300)}" /><p>Receiving: scan or enter <b>${ref}</b> to check in this cargo.</p></div>
      <div class="sign"><div>Driver signature</div><div>Received by (warehouse)</div></div>
      <div class="foot">Generated by Dock2Door · This document travels with the cargo.</div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Bill of Lading</h1>
          <p className="text-sm text-muted-foreground">{ref}</p>
        </div>
        {b.bol_issued_at ? (
          <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Issued</Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        )}
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex items-center gap-3 rounded-lg bg-muted p-4">
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">BOL / Reference #</p>
              <p className="text-2xl font-bold tracking-wide">{ref}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl(ref)} alt="QR" className="h-20 w-20 rounded bg-white" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Shipper</p>
              <p className="font-semibold">{customerCo?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{[customerCo?.address, customerCo?.city].filter(Boolean).join(", ") || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Consignee</p>
              <p className="font-semibold">{warehouseCo?.name ?? listing?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{[listing?.address, listing?.city].filter(Boolean).join(", ") || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
            <Package className="h-4 w-4" />
            {b.pallets_requested ?? 0} pallets · {b.start_date} → {b.end_date}{b.handling_required ? " · handling" : ""}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">How the cargo arrives</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {isCustomer ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {MODES.map((m) => {
                  const active = mode === m.key;
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.key}
                      onClick={() => setMode(m.key)}
                      className={`rounded-lg border p-3 text-left ${active ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <Icon className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      <p className={`mt-1 text-sm font-semibold ${active ? "text-primary" : ""}`}>{m.label}</p>
                      <p className="text-xs text-muted-foreground">{m.hint}</p>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {mode === "third_party" ? (
                  <Field label="Carrier / trucking company"><Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="ACME Freight" /></Field>
                ) : null}
                {mode !== "self_delivery" ? (
                  <Field label="Driver name"><Input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Driver full name" /></Field>
                ) : null}
                <Field label="Vehicle plate"><Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="ABC-1234" /></Field>
                <Field label="Cargo description"><Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="12 pallets dry goods" /></Field>
                <Field label="Pieces"><Input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" placeholder="0" /></Field>
                <Field label="Weight (kg)"><Input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" placeholder="0" /></Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => save.mutate(true)} disabled={save.isPending}>
                  <FileText className="mr-2 h-4 w-4" /> {b.bol_issued_at ? "Update & re-issue BOL" : "Issue Bill of Lading"}
                </Button>
                <Button variant="ghost" onClick={() => save.mutate(false)} disabled={save.isPending}>Save draft</Button>
              </div>
            </>
          ) : (
            <div className="space-y-1 text-sm">
              <ReadRow label="Transport" value={MODE_LABEL[mode]} />
              {carrier ? <ReadRow label="Carrier" value={carrier} /> : null}
              {driver ? <ReadRow label="Driver" value={driver} /> : null}
              {plate ? <ReadRow label="Vehicle" value={plate} /> : null}
              {cargo ? <ReadRow label="Cargo" value={cargo} /> : null}
              {pieces ? <ReadRow label="Pieces" value={pieces} /> : null}
              {weight ? <ReadRow label="Weight" value={`${weight} kg`} /> : null}
            </div>
          )}
          {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
        </CardContent>
      </Card>

      <Button className="w-full" size="lg" onClick={doPrint}><Printer className="mr-2 h-4 w-4" /> Print / Save PDF</Button>
      <p className="text-center text-xs text-muted-foreground">
        The driver shows reference {ref} (or its QR) at the warehouse gate. Receiving scans or types it to check the cargo in.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}
function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-muted-foreground">{children}</div>;
}
