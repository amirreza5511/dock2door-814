import { Warehouse, Ship, Truck, Users, Package, Briefcase, ArrowRight, Building2, RotateCcw, Printer } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/landing/reveal";
import type { Domain } from "@/lib/explore-catalog";

const MODULES: { icon: typeof Warehouse; title: string; body: string; accent: string; domain: Domain }[] = [
  {
    icon: Warehouse,
    title: "Warehousing & WMS",
    body: "Book on-demand storage, manage listings, staff, stations and payouts with a full warehouse management overview.",
    accent: "from-[#2de2c7] to-[#4fd6c0]",
    domain: "logistics",
  },
  {
    icon: Package,
    title: "Fulfillment",
    body: "Orders, shipments, manifests, returns and rate-shopping — a complete 3PL fulfillment engine.",
    accent: "from-[#818cf8] to-[#a78bfa]",
    domain: "logistics",
  },
  {
    icon: Truck,
    title: "Trucking & dispatch",
    body: "A live job board, fleet, dispatch, dock appointments, POD review and finance for carriers and drivers.",
    accent: "from-[#2de2c7] to-[#818cf8]",
    domain: "freight",
  },
  {
    icon: Ship,
    title: "Drayage",
    body: "Move containers from port to door with on-time drayage matched to your lanes and appointments.",
    accent: "from-[#38bdf8] to-[#2de2c7]",
    domain: "drayage",
  },
  {
    icon: Users,
    title: "On-demand labour",
    body: "Post shifts, browse certified workers, track hours & attendance, and settle billing automatically.",
    accent: "from-[#a78bfa] to-[#818cf8]",
    domain: "labour",
  },
  {
    icon: Briefcase,
    title: "Services marketplace",
    body: "Find and book specialist logistics services, or list your own and win new jobs across the network.",
    accent: "from-[#4fd6c0] to-[#38bdf8]",
    domain: "marketplace",
  },
];

/** Modules grid — mirrors the modules available in the mobile app. */
export function Modules() {
  return (
    <section id="platform" className="relative scroll-mt-8 overflow-hidden py-24">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#2de2c7]">
            Everything the app does
          </span>
          <h2 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            One console for{" "}
            <span className="gradient-text">every operator.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-white/60">
            Whatever your role in the supply chain, you get the exact same tools on the web
            that you have in the mobile app — nothing left behind.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m, i) => {
            const Icon = m.icon;
            return (
              <Reveal key={m.title} delay={(i % 3) * 90}>
                <Link
                  href={`/explore/${m.domain}`}
                  className="group relative block h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-[#2de2c7]/30"
                >
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${m.accent} text-[#04121a] transition-transform duration-300 group-hover:scale-110`}
                  >
                    <Icon size={22} strokeWidth={2.2} />
                  </span>
                  <h3 className="font-display mt-5 text-lg font-semibold text-white">{m.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">{m.body}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#2de2c7] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    Explore — no account needed <ArrowRight size={14} />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>

        {/* Ship & Return highlight */}
        <Reveal className="mt-10">
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
