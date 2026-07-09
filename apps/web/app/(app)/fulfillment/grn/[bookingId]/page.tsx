"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useMyCompanies } from "@/lib/hooks/use-active-company";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ArrowLeft, ArrowRight, Boxes, Building2, CheckCircle2, ClipboardCheck, Package, Printer, XCircle } from "lucide-react";

type InspectionStatus = "good" | "damaged" | "partial" | "rejected";

interface GrnRow {
  id: string;
  grn_number: string;
  booking_id: string | null;
  inspection_status: InspectionStatus;
  pallets_received: number;
  pieces_received: number | null;
  condition_notes: string | null;
  inspector_notes: string | null;
  issued_at: string;
}
interface Booking {
  id: string;
  listing_id: string | null;
  customer_company_id: string | null;
  pallets_requested: number | null;
  reference_number: string | null;
  cargo_description: string | null;
}
interface Party { name: string | null; address: string | null; city: string | null }

const STATUS_OPTS: { key: InspectionStatus; label: string; icon: typeof CheckCircle2 }[] = [
  { key: "good", label: "Good", icon: CheckCircle2 },
  { key: "damaged", label: "Damaged", icon: AlertTriangle },
  { key: "partial", label: "Partial", icon: Package },
  { key: "rejected", label: "Rejected", icon: XCircle },
];
const STATUS_LABEL: Record<InspectionStatus, string> = {
  good: "Received in good condition",
  damaged: "Received with damage",
  partial: "Partial shipment received",
  rejected: "Rejected",
};

function qrUrl(data: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`;
}

export default function GoodsReceivedNotePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const router = useRouter();
  const bookingId = useParams<{ bookingId: string }>().bookingId;
  const { data: companies } = useMyCompanies();
  const myCompanyIds = useMemo(() => new Set((companies ?? []).map((c) => c.company_id)), [companies]);

  const query = useQuery({
    queryKey: ["grn", bookingId],
    enabled: Boolean(bookingId),
    queryFn: async () => {
      const { data: booking, error } = await supabase
        .from("warehouse_bookings")
        .select("id,listing_id,customer_company_id,pallets_requested,reference_number,cargo_description")
        .eq("id", bookingId).maybeSingle();
      if (error || !booking) throw new Error("Booking not found");

      let listing: { company_id: string | null; name: string | null; address: string | null; city: string | null } | null = null;
      if (booking.listing_id) {
        const { data } = await supabase
          .from("warehouse_listings").select("company_id,name,address,city").eq("id", booking.listing_id).maybeSingle();
        listing = data;
      }
      const [warehouseCo, customerCo, grnRes] = await Promise.all([
        listing?.company_id
          ? supabase.from("companies").select("name,address,city").eq("id", listing.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        booking.customer_company_id
          ? supabase.from("companies").select("name,address,city").eq("id", booking.customer_company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("goods_received_notes").select("*").eq("booking_id", bookingId)
          .order("issued_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        booking: booking as Booking,
        listing,
        warehouseCo: (warehouseCo.data as Party | null) ?? null,
        customerCo: (customerCo.data as Party | null) ?? null,
        grn: (grnRes.data as GrnRow | null) ?? null,
        isWarehouse: listing?.company_id ? myCompanyIds.has(listing.company_id) : false,
      };
    },
  });

  const [status, setStatus] = useState<InspectionStatus>("good");
  const [pallets, setPallets] = useState("");
  const [pieces, setPieces] = useState("");
  const [condition, setCondition] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: async () => {
      const bookingPallets = query.data?.booking.pallets_requested ?? 0;
      const { error } = await supabase.rpc("warehouse_issue_grn", {
        p_booking_id: bookingId,
        p_inspection_status: status,
        p_pallets_received: pallets.trim() ? Number(pallets) : bookingPallets,
        p_pieces_received: pieces.trim() ? Number(pieces) : null,
        p_condition_notes: condition.trim(),
        p_inspector_notes: note.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { setMsg("GRN issued."); qc.invalidateQueries({ queryKey: ["grn", bookingId] }); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (query.isLoading) return <Centered>Loading document…</Centered>;
  if (query.isError || !query.data) return <Centered>Booking not found.</Centered>;

  const { booking, listing, warehouseCo, customerCo, grn, isWarehouse } = query.data;
  const ref = booking.reference_number || `WB-${booking.id.slice(0, 8).toUpperCase()}`;
  const grnNo = grn?.grn_number ?? "Pending";
  const effStatus: InspectionStatus = grn?.inspection_status ?? status;
  const statusMeta = STATUS_OPTS.find((s) => s.key === effStatus) ?? STATUS_OPTS[0];
  const StatusIcon = statusMeta.icon;

  const doPrint = () => {
    const row = (l: string, v: string) => `<tr><td class="l">${l}</td><td class="v">${v || "—"}</td></tr>`;
    const palletsRx = grn ? String(grn.pallets_received) : String(booking.pallets_requested ?? 0);
    const piecesRx = grn?.pieces_received != null ? String(grn.pieces_received) : (pieces || "—");
    const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *{font-family:-apple-system,Helvetica,Arial,sans-serif}body{padding:28px;color:#111}
      .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:12px}
      .brand{font-size:22px;font-weight:800}.doc{text-align:right}.doc h1{font-size:16px;margin:0;text-transform:uppercase;letter-spacing:1px}
      .ref{font-size:24px;font-weight:800;margin-top:4px}.grid{display:flex;gap:16px;margin-top:20px}
      .box{flex:1;border:1px solid #ccc;border-radius:8px;padding:12px}.box h3{margin:0 0 6px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666}
      .box p{margin:2px 0;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:20px}
      td{padding:9px 10px;border-bottom:1px solid #eee;font-size:13px}td.l{color:#666;width:42%;text-transform:uppercase;font-size:10px}
      td.v{font-weight:600}.cond{margin-top:16px;padding:10px 12px;border-radius:8px;border:1px solid #ccc;font-size:13px}
      .qr{text-align:center;margin-top:24px}.qr img{width:140px;height:140px}
      .sign{display:flex;gap:16px;margin-top:40px}.sign div{flex:1;border-top:1px solid #111;padding-top:6px;font-size:11px;color:#666}
      .foot{margin-top:30px;font-size:10px;color:#999;text-align:center}
    </style></head><body>
      <div class="top"><div><div class="brand">Dock2Door</div><div style="font-size:11px;color:#666">Goods Received Note</div></div>
      <div class="doc"><h1>Goods Received Note</h1><div class="ref">${grnNo}</div><div style="font-size:11px;color:#666">${new Date(grn?.issued_at ?? Date.now()).toLocaleString()}</div></div></div>
      <div class="grid">
        <div class="box"><h3>Received from (Customer)</h3><p><b>${customerCo?.name ?? "—"}</b></p><p>${customerCo?.address ?? ""} ${customerCo?.city ?? ""}</p></div>
        <div class="box"><h3>Received by (Warehouse)</h3><p><b>${warehouseCo?.name ?? listing?.name ?? "—"}</b></p><p>${listing?.address ?? ""} ${listing?.city ?? ""}</p></div>
      </div>
      <table>
        ${row("Booking reference", ref)}${row("Inspection result", STATUS_LABEL[effStatus])}${row("Pallets received", palletsRx)}
        ${row("Pallets booked", String(booking.pallets_requested ?? 0))}${row("Pieces received", piecesRx)}${row("Cargo", booking.cargo_description || "—")}
      </table>
      <div class="cond"><b>Condition notes:</b> ${(grn?.condition_notes ?? condition) || "—"}</div>
      <div class="cond"><b>Inspector notes:</b> ${(grn?.inspector_notes ?? note) || "—"}</div>
      <div class="qr"><img src="${qrUrl(grnNo, 300)}" /></div>
      <div class="sign"><div>Inspected by (warehouse)</div><div>Customer acknowledgement</div></div>
      <div class="foot">Generated by Dock2Door · Permanent proof of acceptance for cargo ${ref}.</div>
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
          <h1 className="text-2xl font-semibold tracking-tight">Goods Received Note</h1>
          <p className="text-sm text-muted-foreground">{grnNo}</p>
        </div>
        {grn ? (
          <Badge variant="success"><StatusIcon className="mr-1 h-3 w-3" /> {statusMeta.label}</Badge>
        ) : (
          <Badge variant="secondary">Not issued</Badge>
        )}
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex items-center gap-3 rounded-lg bg-muted p-4">
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">GRN #</p>
              <p className="text-2xl font-bold tracking-wide">{grnNo}</p>
              <p className="text-xs text-muted-foreground">for {ref}</p>
            </div>
            {grn ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrUrl(grnNo)} alt="QR" className="h-20 w-20 rounded bg-white" />
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Received from</p>
              <p className="font-semibold">{customerCo?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Received by</p>
              <p className="flex items-center gap-1 font-semibold"><Building2 className="h-3.5 w-3.5" /> {warehouseCo?.name ?? listing?.name ?? "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
            <Package className="h-4 w-4" />
            {grn ? grn.pallets_received : booking.pallets_requested ?? 0} pallets received
            {grn?.pieces_received != null ? ` · ${grn.pieces_received} pieces` : ""}
          </div>
          {grn ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              {grn.condition_notes ? <p>Condition: {grn.condition_notes}</p> : null}
              {grn.inspector_notes ? <p>Notes: {grn.inspector_notes}</p> : null}
              <p className="text-xs">Issued {new Date(grn.issued_at).toLocaleString()}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isWarehouse && !grn ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Inspection</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Condition on arrival</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {STATUS_OPTS.map((s) => {
                  const active = status === s.key;
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setStatus(s.key)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${active ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
                    >
                      <Icon className="h-4 w-4" /> {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Pallets received</Label>
                <Input value={pallets} onChange={(e) => setPallets(e.target.value)} inputMode="numeric" placeholder={String(booking.pallets_requested ?? 0)} />
              </div>
              <div className="space-y-1">
                <Label>Pieces (optional)</Label>
                <Input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" placeholder="0" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Condition notes</Label>
              <Textarea value={condition} onChange={(e) => setCondition(e.target.value)} rows={2} placeholder="e.g. 1 pallet shrink-wrap torn" />
            </div>
            <div className="space-y-1">
              <Label>Inspector notes</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Any remarks for the record" />
            </div>
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              <ClipboardCheck className="mr-2 h-4 w-4" /> Issue Goods Received Note
            </Button>
            <p className="text-xs text-muted-foreground">
              Issuing the GRN closes the inbound receipt and creates a permanent acceptance record the customer can see.
            </p>
            {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {!isWarehouse && !grn ? (
        <Card><CardContent className="py-4 text-sm text-muted-foreground">
          The warehouse will issue this Goods Received Note after they inspect and accept your cargo.
        </CardContent></Card>
      ) : null}

      {grn ? (
        <>
          {effStatus !== "rejected" ? (
            <Card className="border-emerald-500/40">
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center gap-2">
                  <Boxes className="h-5 w-5 text-emerald-600" />
                  <p className="font-semibold">On hand & ready to ship</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {`${grn.pieces_received ?? grn.pallets_received} ${grn.pieces_received != null ? "pieces" : "pallets"} were added to this booking's inventory. Create an outbound order to pick, pack and ship them.`}
                </p>
                <Button variant="outline" onClick={() => router.push(`/fulfillment/${booking.id}`)}>
                  Go to fulfillment <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="py-4 text-sm text-muted-foreground">
              This shipment was rejected — nothing was added to inventory. Coordinate the return with the customer.
            </CardContent></Card>
          )}
          <Button className="w-full" size="lg" onClick={doPrint}><Printer className="mr-2 h-4 w-4" /> Print / Save PDF</Button>
        </>
      ) : null}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-muted-foreground">{children}</div>;
}
