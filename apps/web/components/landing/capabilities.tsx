import Link from "next/link";
import {
  Globe, Ship, Plane, Truck, Layers, Home, MapPin,
  Sparkles, ArrowRight, Package, ShieldCheck, Zap,
} from "lucide-react";
import { Reveal } from "@/components/landing/reveal";

interface Bullet {
  icon: typeof Ship;
  label: string;
}

interface Capability {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  icon: typeof Globe;
  glow: string;
  iconGrad: string;
  accentText: string;
  border: string;
  bullets: Bullet[];
  cta: string;
}

const CAPABILITIES: Capability[] = [
  {
    href: "/ground-freight",
    eyebrow: "LTL & FTL quotes",
    title: "Get a price for any truck load",
    body: "Local, across Canada or worldwide with final-mile to the door. Post your load once and carriers compete on price to win it.",
    icon: Truck,
    glow: "rgba(16,185,129,0.4)",
    iconGrad: "from-[#34d399] to-[#059669]",
    accentText: "text-emerald-400",
    border: "hover:border-emerald-400/40",
    bullets: [
      { icon: Layers, label: "LTL part loads" },
      { icon: Truck, label: "FTL full trucks" },
      { icon: Home, label: "Final-mile" },
    ],
    cta: "Get an instant estimate",
  },
  {
    href: "/international",
    eyebrow: "International freight",
    title: "Ship a container or air cargo worldwide",
    body: "Post one request — FCL, LCL or air — and get competing quotes from forwarders, routed into a Canada hub for final-mile.",
    icon: Globe,
    glow: "rgba(56,189,248,0.4)",
    iconGrad: "from-[#38bdf8] to-[#2563eb]",
    accentText: "text-sky-400",
    border: "hover:border-sky-400/40",
    bullets: [
      { icon: Ship, label: "Ocean FCL / LCL" },
      { icon: Plane, label: "Air cargo" },
      { icon: MapPin, label: "Canada hubs" },
    ],
    cta: "Explore freight lanes",
  },
];

/**
 * Landing capabilities — surfaces the mobile app's public entry points
 * (truck-load quotes, international freight, AI copilot) on the web home page.
 */
export function Capabilities() {
  return (
    <section id="capabilities" className="relative scroll-mt-8 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#2de2c7]">
            Do it now — no account needed
          </span>
          <h2 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            Quote, ship &amp;{" "}
            <span className="gradient-text">move freight.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-white/60">
            Every tool from the app is right here on the web. Price a truck load, book
            ocean or air freight, and let a smart operator work your live data.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          {CAPABILITIES.map((c, i) => {
            const Icon = c.icon;
            return (
              <Reveal key={c.href} delay={i * 90}>
                <Link
                  href={c.href}
                  className={`group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-8 transition-all duration-300 hover:-translate-y-1.5 ${c.border}`}
                >
                  <div
                    className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: `radial-gradient(circle, ${c.glow}, transparent 70%)` }}
                    aria-hidden
                  />
                  <span className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${c.iconGrad} text-[#04121a] transition-transform duration-300 group-hover:scale-110`}>
                    <Icon size={26} strokeWidth={2.2} />
                  </span>
                  <span className={`mt-5 text-xs font-bold uppercase tracking-widest ${c.accentText}`}>{c.eyebrow}</span>
                  <h3 className="font-display mt-2 text-2xl font-bold leading-tight text-white">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">{c.body}</p>
                  <div className="mt-5 flex flex-wrap gap-4 text-sm text-white/70">
                    {c.bullets.map((b) => {
                      const BIcon = b.icon;
                      return (
                        <span key={b.label} className="inline-flex items-center gap-1.5">
                          <BIcon size={15} className={c.accentText} /> {b.label}
                        </span>
                      );
                    })}
                  </div>
                  <span className={`mt-6 inline-flex items-center gap-1 text-sm font-semibold ${c.accentText}`}>
                    {c.cta} <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>

        {/* AI Copilot highlight */}
        <Reveal className="mt-6">
          <Link
            href="/copilot"
            className="group relative block overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#818cf8]/15 via-white/[0.04] to-white/[0.02] p-8 transition-all duration-300 hover:-translate-y-1 hover:border-[#818cf8]/40"
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#a78bfa] to-[#818cf8] text-[#04121a]">
                <Sparkles size={26} strokeWidth={2.2} />
              </span>
              <div className="flex-1">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#a78bfa]/30 bg-[#a78bfa]/10 px-3 py-1 text-xs font-semibold text-[#c4b5fd]">
                  AI Copilot
                </span>
                <h3 className="font-display mt-3 text-2xl font-bold text-white">Your own AI operator</h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
                  It reads your live operation and actually gets things done — book workers, dispatch
                  drivers, coordinate containers, quote freight — and you approve every action with one click.
                </p>
                <div className="mt-4 flex flex-wrap gap-4 text-sm text-white/70">
                  <span className="inline-flex items-center gap-1.5"><Zap size={15} className="text-[#a78bfa]" /> Sees your live data</span>
                  <span className="inline-flex items-center gap-1.5"><ShieldCheck size={15} className="text-[#a78bfa]" /> You approve every action</span>
                  <span className="inline-flex items-center gap-1.5"><Package size={15} className="text-[#a78bfa]" /> Talk, type or attach files</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 self-start text-sm font-semibold text-[#a78bfa] md:self-center">
                Open the copilot <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
