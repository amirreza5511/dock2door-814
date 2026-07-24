"use client";

import {
  Warehouse, Ship, Truck, Users, Package, ArrowRight, Building2, RotateCcw, Printer,
  HardHat, Boxes, PackageOpen, Anchor, Store, Globe, Clock, UsersRound, Wrench,
  ShieldCheck, ClipboardList, Forklift, Construction, Hammer, Plane, Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
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

/** Domain worlds grid — the SAME six domain cards as the mobile app landing. */
export function Modules() {
  return (
    <section id="platform" className="relative scroll-mt-8 overflow-hidden py-24">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#2de2c7]">
            Six worlds · same as the app
          </span>
          <h2 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            One platform for <span className="gradient-text">every operator.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-white/60">
            Explore any world below exactly like in the mobile app — open a role,
            look around a real dashboard, no account needed.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {DOMAINS.map((d, i) => {
            const Icon = DOMAIN_ICON[d.key];
            const bulletIcons = BULLET_ICONS[d.key];
            return (
              <Reveal key={d.key} delay={(i % 3) * 90}>
                <Link
                  href={`/explore/${d.key}`}
                  className="group relative block h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-[#2de2c7]/30"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${DOMAIN_GRADIENT[d.key]} text-[#04121a] transition-transform duration-300 group-hover:scale-110`}
                    >
                      <Icon size={22} strokeWidth={2.2} />
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">
                      {d.badge}
                    </span>
                  </div>
                  <h3 className="font-display mt-5 text-lg font-semibold text-white">{d.title}</h3>
                  <p className="mt-0.5 text-sm font-medium text-[#2de2c7]/90">{d.tagline}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">{d.desc}</p>

                  <div className="mt-4 space-y-2.5">
                    {d.bullets.map((b, bi) => {
                      const BIcon = bulletIcons[bi] ?? Users;
                      return (
                        <div key={b.label} className="flex items-center gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70">
                            <BIcon size={13} strokeWidth={2.2} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-white/85">{b.label}</p>
                            <p className="truncate text-xs text-white/45">{b.sub}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[#2de2c7]">
                    Explore — no account needed <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>

        {/* AI logistics assistant highlight — same guest assistant as the app */}
        <Reveal className="mt-10">
          <Link
            href="/help/chat"
            className="group relative block overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#818cf8]/15 via-white/[0.04] to-white/[0.02] p-8 transition-all duration-300 hover:-translate-y-1 hover:border-[#818cf8]/40"
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#a78bfa] to-[#818cf8] text-[#04121a]">
                <Sparkles size={26} strokeWidth={2.2} />
              </span>
              <div className="flex-1">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#a78bfa]/30 bg-[#a78bfa]/10 px-3 py-1 text-xs font-semibold text-[#c4b5fd]">
                  AI · Logistics expert
                </span>
                <h3 className="font-display mt-3 text-2xl font-bold text-white">Ask the AI logistics assistant</h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
                  A senior freight &amp; supply-chain expert in your pocket — LTL vs FTL, customs,
                  Incoterms, pricing. It gathers your shipment details and points you to the right
                  world. Free to try, no account needed.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 self-start text-sm font-semibold text-[#a78bfa] md:self-center">
                Chat now — free <ArrowRight size={15} />
              </span>
            </div>
          </Link>
        </Reveal>

        {/* Ship & Return highlight */}
        <Reveal className="mt-6">
          <Link
            href="/ship"
            className="group relative block overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#f97316]/15 via-white/[0.04] to-white/[0.02] p-8 transition-all duration-300 hover:-translate-y-1 hover:border-[#f97316]/40"
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#fb923c] to-[#f97316] text-[#04121a]">
                <Package size={26} strokeWidth={2.2} />
              </span>
              <div className="flex-1">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#fb923c]/30 bg-[#fb923c]/10 px-3 py-1 text-xs font-semibold text-[#fdba74]">
                  New · Ship &amp; Return
                </span>
                <h3 className="font-display mt-3 text-2xl font-bold text-white">A post office in your pocket</h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
                  Send any parcel or start a return, compare every courier, print a label with a scannable barcode, and drop off or book a pickup.
                </p>
                <div className="mt-4 flex flex-wrap gap-4 text-sm text-white/70">
                  <span className="inline-flex items-center gap-1.5"><Printer size={15} className="text-[#fb923c]" /> Get a price &amp; label</span>
                  <span className="inline-flex items-center gap-1.5"><RotateCcw size={15} className="text-[#fb923c]" /> Amazon / Temu returns</span>
                  <span className="inline-flex items-center gap-1.5"><Truck size={15} className="text-[#fb923c]" /> Drop-off or pickup</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 self-start text-sm font-semibold text-[#fb923c] md:self-center">
                Try it — no account needed <ArrowRight size={15} />
              </span>
            </div>
          </Link>
        </Reveal>

        <Reveal className="mt-6 flex justify-center">
          <Link
            href="/directory"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-[#2de2c7]/40 hover:text-[#2de2c7]"
          >
            <Building2 size={16} /> Browse the directory — companies &amp; open work
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
