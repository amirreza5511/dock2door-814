"use client";

import { useState } from "react";
import Image from "next/image";
import { QrCode, Warehouse, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function normalizeRef(raw: string): string {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!v) return "";
  return v.startsWith("WB-") ? v : `WB-${v}`;
}

function qrUrl(data: string, size = 260): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`;
}

export default function DriverDropoffPage() {
  const [input, setInput] = useState("");
  const [ref, setRef] = useState("");

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-primary/10 p-3">
          <Warehouse className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse drop-off</h1>
        <p className="text-sm text-muted-foreground">
          Delivering to a warehouse? Enter the booking reference the customer gave you and show the code to the receiving team.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 py-5">
          <div className="space-y-1.5">
            <Label>Booking reference #</Label>
            <Input value={input} placeholder="WB-XXXXXXXX" onChange={(e) => setInput(e.target.value.toUpperCase())} />
          </div>
          <Button className="w-full" disabled={!input.trim()} onClick={() => setRef(normalizeRef(input))}>
            <QrCode className="mr-1.5 h-4 w-4" /> Show gate code
          </Button>
        </CardContent>
      </Card>

      {ref ? (
        <Card className="border-primary/40">
          <CardContent className="flex flex-col items-center gap-3 py-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show this to receiving</p>
            <Image src={qrUrl(ref)} alt={ref} width={220} height={220} unoptimized className="rounded-xl bg-white" />
            <p className="text-2xl font-bold tracking-wide">{ref}</p>
            <p className="text-center text-xs text-muted-foreground">Receiving scans this QR (or types the number) to check your cargo in.</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2 rounded-xl border bg-muted/40 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Don&apos;t have a reference? Ask the customer to open their booking → Bill of Lading and share the WB- number with you.
        </p>
      </div>
    </div>
  );
}
