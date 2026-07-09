import { Building2, Globe2, MapPin, ShieldCheck } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { LANDING_IMAGES } from "@/components/landing/images";

const HIGHLIGHTS: { icon: typeof Building2; title: string; text: string }[] = [
  {
    icon: Building2,
    title: "Full-service freight",
    text: "Warehousing, drayage, trucking, customs and fulfillment coordinated by one team.",
  },
  {
    icon: Globe2,
    title: "Cross-border reach",
    text: "Vancouver and Toronto hubs moving freight across Canada, the US and overseas.",
  },
  {
    icon: ShieldCheck,
    title: "Licensed & bonded",
    text: "A trusted freight forwarding partner with the compliance shippers rely on.",
  },
];

/** About ParsFreight — the company behind Dock2Door. */
export function About() {
  return (
    <section id="about" className="relative scroll-mt-8 overflow-hidden py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#2de2c7]/30 bg-[#2de2c7]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#2de2c7]">
              About ParsFreight
            </span>
            <h2 className="font-display mt-5 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
              The freight company behind the platform
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/65">
              Dock2Door is built and operated by{" "}
              <span className="font-semibold text-white">ParsFreight</span>, a Richmond,
              BC–based freight forwarder moving goods across Canada and around the world.
              We combined decades of hands-on logistics with modern software so shippers,
              warehouses and carriers can run everything — bookings, dispatch, labour and
              fulfillment — on one live network.
            </p>

            <div className="mt-8 space-y-5">
              {HIGHLIGHTS.map((h) => {
                const Icon = h.icon;
                return (
                  <div key={h.title} className="flex gap-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7]/20 to-[#818cf8]/20 text-[#2de2c7]">
                      <Icon size={20} strokeWidth={2} />
                    </span>
                    <div>
                      <p className="font-display font-semibold text-white">{h.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-white/55">{h.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 flex items-center gap-2.5 text-sm text-white/55">
              <MapPin size={16} className="text-[#2de2c7]" />
              <span>2651 No 5 Rd, Richmond BC V6X 2S8, Canada</span>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="relative">
              <div className="relative overflow-hidden rounded-[2rem] border border-white/10">
                {LANDING_IMAGES.warehouse ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={LANDING_IMAGES.warehouse} alt="ParsFreight logistics operations" className="aspect-[4/5] w-full object-cover" />
                ) : (
                  <div className="aspect-[4/5] w-full bg-gradient-to-br from-[#0a2230] to-[#04121a]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#04121a] via-transparent to-transparent" />
              </div>
              {/* floating stat card */}
              <div className="absolute -bottom-5 -left-5 rounded-2xl border border-white/10 bg-[#08202c]/90 p-5 backdrop-blur-md">
                <p className="font-display text-3xl font-bold text-white">2 hubs</p>
                <p className="mt-1 text-sm text-white/60">Vancouver &amp; Toronto</p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
