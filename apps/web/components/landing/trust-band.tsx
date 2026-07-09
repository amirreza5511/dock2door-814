import { Reveal } from "@/components/landing/reveal";

const PARTNERS = [
  "Maersk",
  "DHL Supply Chain",
  "XPO Logistics",
  "C.H. Robinson",
  "Ryder",
  "FedEx Freight",
  "Kuehne+Nagel",
  "DB Schenker",
  "Old Dominion",
  "J.B. Hunt",
];

const LIVE_STATS = [
  { k: "48", v: "Countries served" },
  { k: "3.2M", v: "Shipments / year" },
  { k: "18 min", v: "Avg. booking time" },
  { k: "24/7", v: "Live operations" },
];

/** Trust marquee + live network stats, sits directly under the hero. */
export function TrustBand() {
  return (
    <section className="relative border-y border-white/10 py-16">
      <Reveal className="mx-auto max-w-7xl px-6 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-white/40">
          Trusted across the global supply chain
        </p>
      </Reveal>

      {/* infinite partner marquee */}
      <div className="relative mt-8 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
        <div className="flex w-max gap-12 pr-12" style={{ animation: "marquee 32s linear infinite" }}>
          {[...PARTNERS, ...PARTNERS].map((p, i) => (
            <span
              key={`${p}-${i}`}
              className="font-display whitespace-nowrap text-lg font-semibold text-white/45 transition hover:text-white/80"
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-6 px-6 sm:grid-cols-4">
        {LIVE_STATS.map((s, i) => (
          <Reveal
            key={s.v}
            delay={i * 80}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-6 text-center"
          >
            <p className="font-display text-3xl font-bold text-white">{s.k}</p>
            <p className="mt-1.5 text-xs text-white/50">{s.v}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
