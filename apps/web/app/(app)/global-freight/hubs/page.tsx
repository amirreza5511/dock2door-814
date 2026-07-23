"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  MapPin, Ship, Plane, Truck, Boxes, Container, Star, ArrowRight, Warehouse, CircleDot, Info,
} from "lucide-react";

type FreightMode = "ocean" | "air" | "lcl" | "fcl" | "truck";

interface CanadaHub {
  id: string;
  city: string;
  province: string;
  seaportCode?: string;
  airportCode?: string;
  modes: FreightMode[];
  isMember: boolean;
  blurb: string;
}

const INLAND: FreightMode[] = ["air", "truck", "fcl", "lcl"];
const COASTAL: FreightMode[] = ["ocean", "air", "truck", "fcl", "lcl"];

const CANADA_HUBS: CanadaHub[] = [
  { id: "yyz-toronto", city: "Toronto", province: "ON", airportCode: "YYZ", modes: INLAND, isMember: true, blurb: "GTA gateway — largest inland deconsolidation & last-mile coverage." },
  { id: "yvr-vancouver", city: "Vancouver", province: "BC", seaportCode: "CAVAN", airportCode: "YVR", modes: COASTAL, isMember: true, blurb: "Pacific port hub — ocean LCL/FCL landing & West-coast distribution." },
  { id: "yul-montreal", city: "Montreal", province: "QC", seaportCode: "CAMTR", airportCode: "YUL", modes: COASTAL, isMember: true, blurb: "St. Lawrence port + air gateway for Quebec & Eastern Canada." },
  { id: "yyc-calgary", city: "Calgary", province: "AB", modes: INLAND, isMember: false, blurb: "Prairie distribution hub for Alberta & the West." },
  { id: "yeg-edmonton", city: "Edmonton", province: "AB", modes: INLAND, isMember: false, blurb: "Northern Alberta gateway & industrial freight coverage." },
  { id: "ywg-winnipeg", city: "Winnipeg", province: "MB", modes: INLAND, isMember: false, blurb: "Central Canada crossroads — rail & road consolidation." },
  { id: "yow-ottawa", city: "Ottawa", province: "ON", modes: INLAND, isMember: false, blurb: "National capital region delivery coverage." },
  { id: "yhz-halifax", city: "Halifax", province: "NS", seaportCode: "CAHAL", modes: COASTAL, isMember: false, blurb: "Atlantic port hub — first inbound call for Europe/Asia via Suez." },
];

const MODES: { key: FreightMode; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { key: "ocean", label: "Ocean", icon: Ship, color: "text-blue-400" },
  { key: "air", label: "Air", icon: Plane, color: "text-primary" },
  { key: "lcl", label: "LCL", icon: Boxes, color: "text-emerald-400" },
  { key: "fcl", label: "FCL", icon: Container, color: "text-purple-400" },
  { key: "truck", label: "Truck", icon: Truck, color: "text-yellow-400" },
];

const sortedHubs = [...CANADA_HUBS].sort((a, b) => {
  if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
  return a.city.localeCompare(b.city);
});

export default function CanadaHubsPage() {
  const [selectedId, setSelectedId] = useState<string>(sortedHubs[0].id);
  const [mode, setMode] = useState<FreightMode>("lcl");

  const selected = useMemo(() => sortedHubs.find((h) => h.id === selectedId) ?? sortedHubs[0], [selectedId]);
  const modeSupported = selected.modes.includes(mode);
  const memberCount = sortedHubs.filter((h) => h.isMember).length;
  const modeLabel = MODES.find((m) => m.key === mode)?.label ?? "";

  const TransitIcon = mode === "air" ? Plane : mode === "truck" ? Truck : Ship;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Global Freight</p>
        <h1 className="text-3xl font-extrabold tracking-tight">Land it anywhere in Canada</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Ocean, air, truck and LCL/FCL freight all route into a destination city hub for deconsolidation and final-mile delivery. {memberCount} partner hub{memberCount === 1 ? "" : "s"} live in our network.
        </p>
      </div>

      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">Mode</p>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => {
            const on = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors ${
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <m.icon className={`h-4 w-4 ${on ? "" : m.color}`} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">Destination hub</p>
        <div className="space-y-2">
          {sortedHubs.map((h) => {
            const on = selected.id === h.id;
            const supports = h.modes.includes(mode);
            return (
              <button
                key={h.id}
                onClick={() => setSelectedId(h.id)}
                className={`flex w-full gap-3 rounded-2xl border p-4 text-left transition-colors ${
                  on ? "border-primary bg-primary/10" : "border-border hover:border-white/20"
                } ${supports ? "" : "opacity-70"}`}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${on ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <MapPin className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-extrabold">{h.city}</span>
                    <span className="text-xs font-bold text-muted-foreground">{h.province}</span>
                    {h.isMember && (
                      <span className="flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-extrabold text-primary">
                        <Star className="h-2.5 w-2.5 fill-current" /> Partner
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{h.blurb}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {MODES.filter((m) => h.modes.includes(m.key)).map((m) => (
                      <span key={m.key} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                        <m.icon className="h-3 w-3" /> {m.label}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">Route preview · {modeLabel}</p>
        {!modeSupported && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-yellow-500/10 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
            <p className="text-xs text-muted-foreground">
              {selected.city} doesn&apos;t receive {modeLabel} directly — it&apos;ll transship from the nearest gateway, then truck in.
            </p>
          </div>
        )}
        <RouteStep icon={CircleDot} tint="text-muted-foreground" bg="bg-muted" title="Origin" sub="Your supplier / port of loading" />
        <Connector />
        <RouteStep
          icon={TransitIcon}
          tint="text-blue-400"
          bg="bg-blue-500/15"
          title={`${modeLabel} to Canada`}
          sub={mode === "air" ? `Arrives ${selected.airportCode ?? "nearest airport"}` : mode === "truck" ? "Overland line-haul" : `Arrives ${selected.seaportCode ?? "nearest seaport"}`}
        />
        <Connector />
        <RouteStep
          icon={Warehouse}
          tint="text-primary"
          bg="bg-primary/15"
          title={`${selected.city} hub`}
          sub={selected.isMember ? "Partner hub · deconsolidation & customs handoff" : "Coverage hub · deconsolidation"}
          highlight
        />
        <Connector />
        <RouteStep icon={Truck} tint="text-emerald-400" bg="bg-emerald-500/15" title="Final-mile delivery" sub={`Door delivery across ${selected.province}`} />
      </div>

      <Link href="/global-freight" className="block">
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-primary-foreground transition-opacity hover:opacity-90">
          <span className="text-base font-extrabold">Get a freight quote to {selected.city}</span>
          <ArrowRight className="h-5 w-5" />
        </div>
      </Link>

      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Partner hubs are prioritised and will show live capacity &amp; pricing as they come online. Other cities remain available as coverage destinations.
        </p>
      </div>
    </div>
  );
}

function RouteStep({
  icon: Icon, tint, bg, title, sub, highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  bg: string;
  title: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${bg}`}>
        <Icon className={`h-4 w-4 ${tint}`} />
      </span>
      <div>
        <p className={`text-sm font-bold ${highlight ? "text-primary" : ""}`}>{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function Connector() {
  return <div className="ml-4 my-1 h-4 w-0.5 bg-border" />;
}
