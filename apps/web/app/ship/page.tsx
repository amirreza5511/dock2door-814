"use client";

import Link from "next/link";
import { ChevronLeft, Package, RotateCcw, MapPin, Printer, Truck, Store, ArrowRight } from "lucide-react";
import { COURIERS } from "@/lib/couriers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Package, title: "Send a parcel", desc: "Enter size & weight, compare every courier, print a label with a scannable barcode." },
  { icon: RotateCcw, title: "Start a return", desc: "Amazon, Temu or any store — get a prepaid return label or a QR code for the counter." },
  { icon: MapPin, title: "Drop off or pickup", desc: "Drop at a post office / courier point, or book a pickup from your door." },
];

export default function ShipHubPage() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <Link href="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <div className="mb-8 rounded-2xl border border-orange-200 bg-orange-50 p-6 text-orange-900">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Ship &amp; Return · a post office in your pocket</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Send anything. Return anything.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-orange-800">
          Compare every courier, print a label with a scannable barcode, and drop it off or book a pickup — all in one place.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link href="/ship/quote" className="flex-1">
            <Button className="w-full gap-2"><Printer className="h-4 w-4" /> Get a price &amp; label <ArrowRight className="h-4 w-4" /></Button>
          </Link>
          <Link href="/ship/return" className="flex-1">
            <Button variant="secondary" className="w-full gap-2"><RotateCcw className="h-4 w-4" /> Start a return</Button>
          </Link>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">How it works</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title}>
                <CardContent className="space-y-2 py-4">
                  <Icon className="h-5 w-5 text-primary" />
                  <p className="font-semibold">{f.title}</p>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Couriers you can compare</h2>
        <div className="flex flex-wrap gap-2">
          {COURIERS.map((c) => (
            <span key={c.code} className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
              {c.name}
            </span>
          ))}
        </div>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          <p className="flex items-start gap-2"><Truck className="mt-0.5 h-4 w-4 shrink-0" /> Live prices switch on for each courier once its account is connected. Others show clearly-marked estimates.</p>
          <p className="flex items-start gap-2"><Store className="mt-0.5 h-4 w-4 shrink-0" /> Drop off at a post office / courier point, or book a pickup from our network.</p>
        </div>
      </section>
    </div>
  );
}
