import { Search, CalendarCheck, Radar, BadgeDollarSign } from "lucide-react";

const STEPS = [
  {
    icon: Search,
    title: "Find capacity",
    body: "Search live warehouse space, drayage, trucking lanes and on-demand labour near your freight — with real pricing.",
  },
  {
    icon: CalendarCheck,
    title: "Book in seconds",
    body: "Reserve space, dispatch a load or post a shift. Everything is quoted, contracted and confirmed in one flow.",
  },
  {
    icon: Radar,
    title: "Track it live",
    body: "Follow every move end-to-end — dock appointments, shipments, POD and inventory — from a single console.",
  },
  {
    icon: BadgeDollarSign,
    title: "Settle automatically",
    body: "Invoices, payouts and billing reconcile themselves, so money moves as smoothly as your freight.",
  },
];

/** "How it works" — target of the hero's #how anchor. */
export function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-8 bg-[#04121a] py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#2de2c7]">
            How it works
          </span>
          <h2 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            From dock to door in{" "}
            <span className="gradient-text">four moves.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-white/60">
            No spreadsheets, no phone tag. Dock2Door turns the whole logistics workflow into a
            few taps — the same experience on web and mobile.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.title}
                className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6 transition-transform duration-300 hover:-translate-y-1.5"
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: "radial-gradient(circle, rgba(45,226,199,0.4), transparent 70%)" }}
                  aria-hidden
                />
                <span className="font-display text-sm font-bold text-[#2de2c7]/70">
                  0{i + 1}
                </span>
                <span className="mt-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] text-[#04121a]">
                  <Icon size={22} strokeWidth={2.2} />
                </span>
                <h3 className="font-display mt-5 text-lg font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{s.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
