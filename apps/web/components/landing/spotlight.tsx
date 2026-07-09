import { ArrowRight, Sparkles, Zap } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { LANDING_IMAGES } from "@/components/landing/images";

/** Advertisement / promotional spotlight banner. */
export function Spotlight() {
  return (
    <section className="relative overflow-hidden py-12">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="relative overflow-hidden rounded-[2rem] border border-[#2de2c7]/20">
          {/* background image */}
          <div className="absolute inset-0">
            {LANDING_IMAGES.warehouse ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={LANDING_IMAGES.warehouse} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-[#0a2230] to-[#04121a]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-[#04121a] via-[#04121a]/85 to-[#04121a]/40" />
          </div>

          <div className="relative grid gap-6 p-8 sm:p-12 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#2de2c7] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#04121a]">
                <Sparkles size={13} />
                Limited launch offer
              </span>
              <h2 className="font-display mt-5 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                List your warehouse space free for 90 days
              </h2>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-white/70">
                New partners pay zero platform fees for their first three months. Turn empty
                dock space and idle capacity into revenue on the fastest-growing logistics
                network.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <a
                  href="/login"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#2de2c7] to-[#4fd6c0] px-7 py-3.5 font-display text-sm font-semibold text-[#04121a] shadow-[0_10px_40px_-8px_rgba(45,226,199,0.7)] transition hover:shadow-[0_14px_50px_-6px_rgba(45,226,199,0.9)]"
                >
                  Claim the offer
                  <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
                </a>
                <a
                  href="#platform"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-medium text-white/90 backdrop-blur-md transition hover:border-white/40 hover:bg-white/10"
                >
                  Explore the platform
                </a>
              </div>
            </div>

            <div className="hidden lg:block">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 backdrop-blur-md">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] text-[#04121a]">
                  <Zap size={20} strokeWidth={2.2} />
                </span>
                <p className="font-display mt-4 text-2xl font-bold text-white">$0 fees</p>
                <p className="mt-1 text-sm text-white/60">for the first 90 days, no card required.</p>
                <div className="mt-5 space-y-2 border-t border-white/10 pt-5 text-sm text-white/70">
                  <p>✓ Instant listing approval</p>
                  <p>✓ Verified demand from day one</p>
                  <p>✓ Automatic payouts</p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
