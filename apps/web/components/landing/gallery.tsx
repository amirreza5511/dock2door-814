import { Reveal } from "@/components/landing/reveal";
import { LANDING_IMAGES } from "@/components/landing/images";

type Tile = { image: string; label: string; sub: string; className: string };

const TILES: Tile[] = [
  {
    image: LANDING_IMAGES.port,
    label: "Ports & drayage",
    sub: "Container moves, port to door",
    className: "sm:col-span-2 sm:row-span-2",
  },
  {
    image: LANDING_IMAGES.trucks,
    label: "Trucking",
    sub: "Live lanes & dispatch",
    className: "",
  },
  {
    image: LANDING_IMAGES.warehouse,
    label: "Warehousing",
    sub: "On-demand storage & 3PL",
    className: "",
  },
  {
    image: LANDING_IMAGES.network,
    label: "Network",
    sub: "One connected map",
    className: "sm:col-span-2",
  },
];

/** Visual gallery of the physical logistics network. */
export function Gallery() {
  return (
    <section className="relative overflow-hidden py-24">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#2de2c7]">
            Inside the network
          </span>
          <h2 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            The infrastructure behind{" "}
            <span className="gradient-text">every delivery.</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid auto-rows-[200px] grid-cols-1 gap-4 sm:grid-cols-4">
          {TILES.map((t, i) => (
            <Reveal
              key={t.label}
              delay={(i % 4) * 80}
              className={`group relative overflow-hidden rounded-3xl border border-white/10 ${t.className}`}
            >
              {t.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.image}
                  alt={t.label}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#0a2230] to-[#04121a]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#04121a] via-[#04121a]/30 to-transparent" />
              <div className="absolute bottom-0 left-0 p-5">
                <p className="font-display text-lg font-semibold text-white">{t.label}</p>
                <p className="mt-0.5 text-sm text-white/60">{t.sub}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
