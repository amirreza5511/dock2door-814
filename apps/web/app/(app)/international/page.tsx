"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Globe, Ship, Plane, Boxes, Container, MapPin, Package, Truck, ArrowRight, Home, Layers, ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type Scope = "worldwide" | "local";

interface QuickTile {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  route: string;
  scope: "both" | Scope;
}

const QUICK: QuickTile[] = [
  { key: "ocean", label: "Ocean FCL / LCL", icon: Ship, color: "text-blue-400", route: "/customer/ocean", scope: "worldwide" },
  { key: "air", label: "Air cargo", icon: Plane, color: "text-purple-400", route: "/customer/air", scope: "worldwide" },
  { key: "ltl", label: "LTL / FTL trucking", icon: Truck, color: "text-emerald-400", route: "/customer/post-load", scope: "local" },
  { key: "finalmile", label: "Final-mile delivery", icon: Home, color: "text-primary", route: "/ship", scope: "local" },
  { key: "drayage", label: "Container drayage", icon: Container, color: "text-blue-400", route: "/customer/drayage", scope: "both" },
  { key: "quote", label: "Get quotes", icon: Globe, color: "text-yellow-400", route: "/global-freight", scope: "both" },
];

const FEATURES = [
  { icon: Boxes, title: "One request, many quotes", desc: "Describe your shipment once — air, ocean, truck, LTL, FTL, FCL or LCL — and get competing quotes." },
  { icon: Layers, title: "LTL to full container", desc: "From a single pallet (LTL) to full truckloads and full containers — every size is covered." },
  { icon: MapPin, title: "Worldwide & local", desc: "Ship internationally or move freight domestically, with final-mile delivery to the door." },
];

const MODES = [
  { icon: Plane, label: "Air" },
  { icon: Ship, label: "Ocean" },
  { icon: Truck, label: "LTL / FTL" },
  { icon: Boxes, label: "FCL / LCL" },
  { icon: Home, label: "Final-mile" },
];

export default function InternationalPage() {
  const [scope, setScope] = useState<Scope>("worldwide");
  const tiles = useMemo(() => QUICK.filter((t) => t.scope === "both" || t.scope === scope), [scope]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="rounded-3xl border border-blue-500/20 bg-gradient-to-b from-blue-950/60 to-transparent p-8">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-blue-500/15">
          <Globe className="h-8 w-8 text-blue-400" />
        </span>
        <p className="mt-4 text-xs font-bold uppercase tracking-widest text-blue-400">Freight · Worldwide &amp; Local</p>
        <h1 className="mt-2 text-4xl font-extrabold leading-tight tracking-tight">Ship anything, anywhere.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Ocean, air, LTL, FTL and full containers — post one request and receive competing quotes from forwarders and carriers, then track it all the way to the door.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => setScope("worldwide")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold transition-colors ${
              scope === "worldwide" ? "border-blue-500 bg-blue-500 text-white" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="h-4 w-4" /> Worldwide
          </button>
          <button
            onClick={() => setScope("local")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold transition-colors ${
              scope === "local" ? "border-blue-500 bg-blue-500 text-white" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <MapPin className="h-4 w-4" /> Local / domestic
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {MODES.map((m) => (
            <span key={m.label} className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold">
              <m.icon className="h-4 w-4 text-blue-400" /> {m.label}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-blue-400">Quick access</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <Link key={t.key} href={t.route} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-muted">
                    <t.icon className={`h-6 w-6 ${t.color}`} />
                  </span>
                  <span className="text-sm font-bold">{t.label}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <Link href="/global-freight" className="block">
        <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-5 text-white transition-opacity hover:opacity-90">
          <Boxes className="h-5 w-5" />
          <span className="flex-1 text-base font-extrabold">Get a freight quote</span>
          <ChevronRight className="h-5 w-5" />
        </div>
      </Link>

      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-blue-400">How it works</p>
        <div className="space-y-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-500/15">
                <f.icon className="h-5 w-5 text-blue-400" />
              </span>
              <div>
                <p className="text-sm font-bold">{f.title}</p>
                <p className="text-xs text-muted-foreground">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Link href="/global-freight" className="block">
        <div className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-background">
            <Package className="h-5 w-5 text-primary" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-extrabold">Canada hub network</p>
            <p className="text-xs text-muted-foreground">Ocean, air, truck &amp; LCL/FCL route into a destination city hub for final-mile.</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
      </Link>
    </div>
  );
}
