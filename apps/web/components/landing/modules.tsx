"use client";

import {
  Warehouse, Ship, Truck, Users, Package, ArrowRight, Building2, RotateCcw, Printer,
  HardHat, Boxes, PackageOpen, Anchor, Store, Globe, Clock, UsersRound, Wrench,
  ShieldCheck, Forklift, Construction, Hammer, Plane, Sparkles, Compass,
  Layers, Home, MapPin, Star, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "@/components/landing/reveal";
import { DOMAINS, type Domain } from "@/lib/explore-catalog";

/** Icon + accent per domain — mirrors the mobile app landing cards. */
const DOMAIN_ICON: Record<Domain, LucideIcon> = {
  labour: HardHat,
  logistics: Boxes,
  freight: PackageOpen,
  drayage: Anchor,
  marketplace: Store,
  globalfreight: Globe,
};

/** Solid accent color per domain — same palette as the mobile app cards. */
const DOMAIN_COLOR: Record<Domain, string> = {
  labour: "#a78bfa",
  logistics: "#fb923c",
  freight: "#34d399",
  drayage: "#38bdf8",
  marketplace: "#fbbf24",
  globalfreight: "#38bdf8",
};

const DOMAIN_GRADIENT: Record<Domain, string> = {
  labour: "from-[#a78bfa] to-[#818cf8]",
  logistics: "from-[#fb923c] to-[#f97316]",
  freight: "from-[#34d399] to-[#2de2c7]",
  drayage: "from-[#38bdf8] to-[#2de2c7]",
  marketplace: "from-[#fbbf24] to-[#f59e0b]",
  globalfreight: "from-[#38bdf8] to-[#818cf8]",
};

/** Per-bullet icons, aligned by index with each domain's bullets (same as mobile). */
const BULLET_ICONS: Record<Domain, LucideIcon[]> = {
  labour: [Clock, Users, UsersRound],
  logistics: [Warehouse, Wrench, Truck],
  freight: [PackageOpen, Truck, Truck],
  drayage: [Anchor, Truck, Users, ShieldCheck],
  marketplace: [Forklift, Construction, Hammer, ShieldCheck],
  globalfreight: [Boxes, Plane, Ship],
};

/** Platform stats strip — same numbers as the mobile app landing. */
const STATS: { label: string; value: string }[] = [
  { label: "Pallet Spaces", value: "1,150+" },
  { label: "Active Workers", value: "200+" },
  { label: "Service Partners", value: "18" },
  { label: "Avg. Fill Time", value: "< 2h" },
];

/** "Built for every role" grid — identical list to the mobile app landing. */
const ROLES: { role: string; desc: string; icon: LucideIcon; color: string }[] = [
  { role: "Customer", desc: "Book warehouse & services", icon: ShieldCheck, color: "#38bdf8" },
  { role: "Warehouse Provider", desc: "List your storage space", icon: Warehouse, color: "#fb923c" },
  { role: "Service Provider", desc: "Offer industrial services", icon: Wrench, color: "#34d399" },
  { role: "Employer", desc: "Post and fill shifts fast", icon: Clock, color: "#fbbf24" },
  { role: "Worker", desc: "Find shifts that fit you", icon: Users, color: "#a78bfa" },
  { role: "Employment Agency", desc: "Your workers, our booking system", icon: UsersRound, color: "#a78bfa" },
  { role: "Shipper", desc: "Post deliveries, any size", icon: PackageOpen, color: "#34d399" },
  { role: "Owner-Operator", desc: "Own one truck, deliver loads", icon: Truck, color: "#34d399" },
  { role: "Fleet / Carrier", desc: "Run a fleet & dispatch drivers", icon: Truck, color: "#34d399" },
  { role: "Freight Forwarder", desc: "Post import/export containers", icon: Anchor, color: "#38bdf8" },
  { role: "Drayage Company", desc: "Claim orders, dispatch & track", icon: Anchor, color: "#38bdf8" },
  { role: "Customs Broker", desc: "Clear shipments through customs", icon: ShieldCheck, color: "#38bdf8" },
  { role: "Container Driver", desc: "Receive work orders, move containers", icon: Truck, color: "#38bdf8" },
  { role: "Crane / Equipment Co.", desc: "Rent out cranes & heavy gear", icon: Construction, color: "#fbbf24" },
  { role: "Mobile Repair", desc: "Dispatch techs & crews on-site", icon: Hammer, color: "#a78bfa" },
  { role: "Cargo Insurer", desc: "Insure freight & shipments", icon: ShieldCheck, color: "#fbbf24" },
  { role: "Marketplace Buyer", desc: "Rent, repair & insure cargo", icon: Store, color: "#38bdf8" },
  { role: "Admin", desc: "Full platform control", icon: Star, color: "#f87171" },
];

/** Small uppercase section label + big title — same rhythm as the app landing. */
function SectionHeader({ label, title }: { label: string; title: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#fb923c]">{label}</p>
      <h2 className="font-display mt-2 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}

/**
 * A big highlight card (Ship & Return / International Freight / LTL & FTL) —
 * mirrors the mobile app's gradient "shipCard" with icon, title, desc and bullets.
 */
function HighlightCard({
  href, gradient, color, colorDim, icon: Icon, title, desc, bullets, testId,
}: {
  href: string;
  gradient: string;
  color: string;
  colorDim: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  bullets: { icon: LucideIcon; label: string }[];
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group block overflow-hidden rounded-2xl border border-white/10 transition-all duration-300 hover:-translate-y-1"
      style={{ background: gradient }}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <span
            className="grid h-13 w-13 shrink-0 place-items-center rounded-2xl p-3.5"
            style={{ backgroundColor: colorDim }}
          >
            <Icon size={24} style={{ color }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-extrabold tracking-tight text-white">{title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-white/60">{desc}</p>
          </div>
          <ChevronRight size={20} className="shrink-0 text-white/40 transition-transform duration-300 group-hover:translate-x-1" />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {bullets.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
              <b.icon size={14} style={{ color }} /> {b.label}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

/**
 * Landing "worlds" block — the SAME sections as the mobile app landing:
 * stats strip, six domain cards, Ship & Return, International Freight,
 * LTL & FTL quotes, the "every role" grid and the directory card.
 */
export function Modules() {
  return (
    <section id="platform" className="relative scroll-mt-8 overflow-hidden py-24">
      <div className="mx-auto max-w-7xl px-6">
        {/* Stats — same numbers as the app */}
        <Reveal>
          <div className="mx-auto grid max-w-3xl grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="border-white/10 px-4 py-5 text-center sm:[&:not(:last-child)]:border-r">
                <p className="text-xl font-extrabold tracking-tight text-[#fb923c]">{s.value}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-white/45">{s.label}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* SIX WORLDS */}
        <Reveal className="mt-20">
          <SectionHeader
            label="Six worlds, one platform"
            title={<>Explore any world<br />— no account needed.</>}
          />
        </Reveal>

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {DOMAINS.map((d, i) => {
            const Icon = DOMAIN_ICON[d.key];
            const bulletIcons = BULLET_ICONS[d.key];
            const color = DOMAIN_COLOR[d.key];
            return (
              <Reveal key={d.key} delay={(i % 3) * 90}>
                <Link
                  href={`/explore/${d.key}`}
                  data-testid={`domain-card-${d.key}`}
                  className="group relative block h-full overflow-hidden rounded-3xl border bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 transition-all duration-300 hover:-translate-y-1.5"
                  style={{ borderColor: `${color}66` }}
                >
                  <div className="flex items-center gap-3.5">
                    <span
                      className={`grid h-13 w-13 place-items-center rounded-2xl bg-gradient-to-br p-3.5 ${DOMAIN_GRADIENT[d.key]} text-[#04121a] transition-transform duration-300 group-hover:scale-110`}
                    >
                      <Icon size={22} strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{d.badge}</p>
                      <h3 className="font-display truncate text-xl font-extrabold tracking-tight text-white">{d.title}</h3>
                    </div>
                    <ChevronRight size={20} className="shrink-0 text-white/40" />
                  </div>
                  <p className="mt-3.5 text-sm leading-relaxed text-white/55">{d.desc}</p>

                  <div className="mt-4 space-y-2.5">
                    {d.bullets.map((b, bi) => {
                      const BIcon = bulletIcons[bi] ?? Users;
                      return (
                        <div key={b.label} className="flex items-center gap-3">
                          <span
                            className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-[10px] p-2"
                            style={{ backgroundColor: `${color}1f`, color }}
                          >
                            <BIcon size={15} strokeWidth={2.2} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-white">{b.label}</p>
                            <p className="truncate text-xs text-white/50">{b.sub}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <span
                    className="mt-4 flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[13px] font-bold"
                    style={{ backgroundColor: `${color}1f`, color }}
                  >
                    <Compass size={15} /> Explore {d.title} — no account needed
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>

        {/* SHIP & RETURN */}
        <Reveal className="mt-20">
          <SectionHeader label="Ship & Return" title={<>A post office<br />in your pocket.</>} />
          <div className="mt-8">
            <HighlightCard
              href="/ship"
              testId="home-ship"
              gradient="linear-gradient(135deg, #12253D, #0D1E35)"
              color="#fb923c"
              colorDim="rgba(251,146,60,0.14)"
              icon={Package}
              title="Send a parcel or start a return"
              desc="Compare every courier, print a label, drop off or book a pickup."
              bullets={[
                { icon: Printer, label: "Get a price & label" },
                { icon: RotateCcw, label: "Amazon / Temu returns" },
                { icon: Truck, label: "Drop-off or pickup" },
              ]}
            />
          </div>
        </Reveal>

        {/* INTERNATIONAL FREIGHT */}
        <Reveal className="mt-20">
          <SectionHeader label="International Freight" title={<>Ocean, air &amp;<br />freight quotes.</>} />
          <div className="mt-8">
            <HighlightCard
              href="/international"
              testId="home-international"
              gradient="linear-gradient(135deg, #0B2A3D, #0A1F2E)"
              color="#38bdf8"
              colorDim="rgba(56,189,248,0.14)"
              icon={Globe}
              title="Ship a container or air cargo worldwide"
              desc="Post one request — FCL, LCL or air — and get competing quotes from forwarders."
              bullets={[
                { icon: Ship, label: "Ocean FCL / LCL" },
                { icon: Plane, label: "Air cargo" },
                { icon: MapPin, label: "Canada hubs" },
              ]}
            />
          </div>
        </Reveal>

        {/* LTL & FTL QUOTES */}
        <Reveal className="mt-20">
          <SectionHeader label="LTL & FTL Quotes" title={<>Truck loads,<br />competing prices.</>} />
          <div className="mt-8">
            <HighlightCard
              href="/ground-freight"
              testId="home-ground-freight"
              gradient="linear-gradient(135deg, #0E2A1C, #0A1F16)"
              color="#34d399"
              colorDim="rgba(52,211,153,0.14)"
              icon={Truck}
              title="Get a price for any truck load"
              desc="Local, across Canada or worldwide — post once and let carriers compete on price."
              bullets={[
                { icon: Layers, label: "LTL part loads" },
                { icon: Truck, label: "FTL full trucks" },
                { icon: Home, label: "Final-mile" },
              ]}
            />
          </div>
        </Reveal>

        {/* AI logistics assistant — same guest assistant as the app */}
        <Reveal className="mt-20">
          <SectionHeader label="AI Assistant" title={<>A logistics expert,<br />on call 24/7.</>} />
          <Link
            href="/help/chat"
            className="group relative mt-8 block overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#818cf8]/15 via-white/[0.04] to-white/[0.02] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#818cf8]/40"
          >
            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#a78bfa] to-[#818cf8] text-[#04121a]">
                <Sparkles size={26} strokeWidth={2.2} />
              </span>
              <div className="flex-1">
                <h3 className="font-display text-xl font-extrabold text-white">Ask the AI logistics assistant</h3>
                <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-white/60">
                  A senior freight &amp; supply-chain expert — LTL vs FTL, customs, Incoterms,
                  pricing. It gathers your shipment details and points you to the right world.
                  Free to try, no account needed.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 self-start text-sm font-semibold text-[#a78bfa] md:self-center">
                Chat now — free <ArrowRight size={15} />
              </span>
            </div>
          </Link>
        </Reveal>

        {/* BUILT FOR — every role grid, same list as the app */}
        <Reveal className="mt-20">
          <SectionHeader label="Built for" title={<>Every role in the<br />supply chain.</>} />
        </Reveal>
        <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {ROLES.map((r, i) => (
            <Reveal key={r.role} delay={(i % 4) * 60}>
              <div className="h-full rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <r.icon size={20} style={{ color: r.color }} />
                <p className="mt-2 text-sm font-bold text-white">{r.role}</p>
                <p className="mt-0.5 text-xs text-white/55">{r.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Directory */}
        <Reveal className="mt-12">
          <Link
            href="/directory"
            data-testid="home-directory"
            className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-[#fb923c]/40"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#fb923c]/15">
              <Building2 size={22} className="text-[#fb923c]" />
            </span>
            <span className="flex-1">
              <span className="block text-base font-extrabold text-white">Browse the directory</span>
              <span className="mt-0.5 block text-xs text-white/55">Companies &amp; open work — no account needed</span>
            </span>
            <ArrowRight size={18} className="text-white/40" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
