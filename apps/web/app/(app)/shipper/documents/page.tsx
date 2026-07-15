"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, FileText, Printer, QrCode, ScanLine, Tags } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QRCode } from "@/components/qr-code";
import {
  useLoad,
  useLoadPieces,
  CARGO_CLASS_LABEL,
  VEHICLE_LABEL,
  money,
  type LoadPieceRow,
} from "@/lib/hooks/use-loads";
import { buildLabelsHtml, buildBolHtml, printHtml, type PieceInfo, type ShipmentInfo } from "@/lib/bol-print";

function DocumentsInner() {
  const params = useSearchParams();
  const loadId = params.get("loadId") ?? "";
  const loadQ = useLoad(loadId);
  const piecesQ = useLoadPieces(loadId);

  const load = loadQ.data;
  const pieces = useMemo<LoadPieceRow[]>(() => piecesQ.data ?? [], [piecesQ.data]);
  const scannedCount = pieces.filter((p) => p.scanned).length;
  const totalCount = pieces.length;

  const shipment: ShipmentInfo | null = useMemo(() => {
    if (!load) return null;
    const cls = String(load.cargo_class ?? "General");
    return {
      bolNumber: String(load.bol_number ?? load.id.slice(0, 8).toUpperCase()),
      pickupAddress: String(load.pickup_address ?? load.pickup_city ?? ""),
      dropoffAddress: String(load.dropoff_address ?? load.dropoff_city ?? ""),
      senderName: String((load.sender_name as string) ?? "Shipper"),
      recipientName: String(load.recipient_name ?? load.receiver_name ?? ""),
      recipientPhone: String((load.recipient_phone as string) ?? ""),
      cargoClassLabel: CARGO_CLASS_LABEL[cls] ?? cls,
      vehicleLabel: VEHICLE_LABEL[load.vehicle_type] ?? load.vehicle_type,
      pallets: Number(load.pallets ?? 0),
      itemCount: Number((load.item_count as number) ?? pieces.length),
      weightKg: Number((load.weight_kg as number) ?? 0),
      distanceKm: Number(load.distance_km ?? 0),
      totalPrice: Number(load.total_price ?? 0),
      itemDescription: String(load.item_description ?? ""),
      notes: String(load.notes ?? ""),
      createdAt: String(load.created_at ?? ""),
    };
  }, [load, pieces.length]);

  const pieceInfos: PieceInfo[] = useMemo(
    () =>
      pieces.map((p) => ({
        piece_no: p.piece_no,
        total_pieces: p.total_pieces,
        barcode: p.barcode,
        cargo_class: String(p.cargo_class ?? ""),
        weight_kg: Number(p.weight_kg ?? 0),
      })),
    [pieces],
  );

  if (loadQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading documents…</p>;
  }
  if (!load || !shipment) {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">Shipment not found.</CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><Link href="/shipper/loads"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Shipper</p>
          <h1 className="text-2xl font-semibold tracking-tight">Labels &amp; Bill of Lading</h1>
        </div>
      </div>

      {/* Master BOL card */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 to-transparent">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><FileText className="h-4 w-4" /> Bill of Lading</div>
              <p className="mt-1 text-2xl font-bold tracking-tight">{shipment.bolNumber}</p>
              <p className="text-sm text-muted-foreground">{shipment.cargoClassLabel} · {shipment.vehicleLabel}</p>
            </div>
            <div className="rounded-lg bg-white p-2"><QRCode value={shipment.bolNumber} size={96} /></div>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /><span className="truncate text-muted-foreground">{shipment.pickupAddress || "Pickup point"}</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-red-400" /><span className="truncate text-muted-foreground">{shipment.dropoffAddress || "Drop-off point"}</span></div>
          </div>

          {totalCount > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><ScanLine className="h-3.5 w-3.5" /> Pickup scan progress</span>
                <span>{scannedCount} of {totalCount}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${totalCount ? (scannedCount / totalCount) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/5 pt-3 text-sm">
            <span className="text-muted-foreground">{totalCount} pieces · {shipment.distanceKm} km</span>
            <span className="font-semibold">{money(shipment.totalPrice)}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => printHtml(buildBolHtml(shipment, pieceInfos))}>
              <Printer className="mr-2 h-4 w-4" /> Print BOL
            </Button>
            <Button variant="outline" disabled={pieceInfos.length === 0} onClick={() => printHtml(buildLabelsHtml(shipment, pieceInfos))}>
              <Tags className="mr-2 h-4 w-4" /> Print all labels
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Per-piece labels */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Piece labels ({totalCount})</h2>
        </div>

        {piecesQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading labels…</p>
        ) : totalCount === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No piece labels for this shipment yet.</CardContent></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pieces.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="rounded-lg bg-white p-2"><QRCode value={p.barcode} size={72} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-lg font-bold">{p.piece_no} <span className="text-sm font-medium text-muted-foreground">of {p.total_pieces}</span></p>
                      {p.scanned ? <Badge className="bg-emerald-500/15 text-emerald-300">Scanned</Badge> : <Badge variant="outline">Pending</Badge>}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">{p.barcode}</p>
                    <p className="truncate text-xs text-muted-foreground">{CARGO_CLASS_LABEL[String(p.cargo_class ?? "")] ?? p.cargo_class}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function ShipperDocumentsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <DocumentsInner />
    </Suspense>
  );
}
