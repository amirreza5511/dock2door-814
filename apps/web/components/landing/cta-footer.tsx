import { ArrowRight, Mail, MapPin, Phone } from "lucide-react";

const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Platform",
    links: [
      { label: "Warehousing & WMS", href: "#platform" },
      { label: "Fulfillment", href: "#platform" },
      { label: "Trucking & dispatch", href: "#platform" },
      { label: "Drayage", href: "#platform" },
      { label: "On-demand labour", href: "#platform" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Live network", href: "#news" },
      { label: "News & insights", href: "#news" },
      { label: "Careers", href: "#" },
      { label: "Contact", href: "#contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help center", href: "#" },
      { label: "API & integrations", href: "#" },
      { label: "Carrier onboarding", href: "/login" },
      { label: "Pricing", href: "#platform" },
      { label: "Status", href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "#" },
      { label: "Terms of service", href: "#" },
      { label: "Cookie policy", href: "#" },
      { label: "Security", href: "#" },
    ],
  },
];

export function CtaFooter() {
  return (
    <>
      <section id="contact" className="relative scroll-mt-8 overflow-hidden py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0a2230] to-[#04121a] px-8 py-16 text-center">
            <div
              className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(45,226,199,0.3), transparent 70%)" }}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(129,140,248,0.28), transparent 70%)" }}
              aria-hidden
            />
            <h2 className="font-display relative text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
              Ready to move freight the{" "}
              <span className="gradient-text">modern way?</span>
            </h2>
            <p className="relative mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/60">
              Join thousands of shippers, warehouses and carriers already running their
              operations on Dock2Door.
            </p>
            <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/login"
                className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#2de2c7] to-[#4fd6c0] px-8 py-3.5 font-display text-sm font-semibold text-[#04121a] shadow-[0_10px_40px_-8px_rgba(45,226,199,0.7)] transition hover:shadow-[0_14px_50px_-6px_rgba(45,226,199,0.9)]"
              >
                Get started free
                <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
              </a>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-8 py-3.5 text-sm font-medium text-white/90 backdrop-blur-md transition hover:border-white/30 hover:bg-white/10"
              >
                See how it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative border-t border-white/10 pb-10 pt-16">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-10 lg:grid-cols-[1.4fr_2.6fr]">
            {/* brand + contact */}
            <div>
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] font-display text-sm font-bold text-[#04121a]">
                  D2
                </span>
                <span className="font-display text-lg font-semibold tracking-tight text-white">Dock2Door</span>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/50">
                Dock2Door is the logistics platform by{" "}
                <span className="text-white/70">ParsFreight</span> — warehousing, drayage,
                trucking, fulfillment and labour on a single live network.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-white/55">
                <li className="flex items-start gap-2.5">
                  <Phone size={15} className="mt-0.5 shrink-0 text-[#2de2c7]" />
                  <span className="flex flex-col gap-0.5">
                    <a href="tel:+16047274706" className="transition hover:text-white">
                      +1 (604) 727-4706 · Vancouver
                    </a>
                    <a href="tel:+16725144847" className="transition hover:text-white">
                      +1 (672) 514-4847 · Toronto
                    </a>
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Mail size={15} className="mt-0.5 shrink-0 text-[#2de2c7]" />
                  <span className="flex flex-col gap-0.5">
                    <a href="mailto:sales@parsfreight.ca" className="transition hover:text-white">
                      sales@parsfreight.ca
                    </a>
                    <a href="mailto:rose@parsfreight.com" className="transition hover:text-white">
                      rose@parsfreight.com
                    </a>
                    <a href="mailto:amir@parsfreight.com" className="transition hover:text-white">
                      amir@parsfreight.com
                    </a>
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <MapPin size={15} className="mt-0.5 shrink-0 text-[#2de2c7]" />
                  <span>2651 No 5 Rd, Richmond BC V6X 2S8, Canada</span>
                </li>
              </ul>
            </div>

            {/* link columns */}
            <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
              {FOOTER_COLUMNS.map((col) => (
                <div key={col.title}>
                  <p className="font-display text-sm font-semibold text-white">{col.title}</p>
                  <ul className="mt-4 space-y-3 text-sm text-white/50">
                    {col.links.map((l) => (
                      <li key={l.label}>
                        <a href={l.href} className="transition hover:text-white">
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
            <p className="text-xs text-white/40">© {new Date().getFullYear()} Dock2Door. All rights reserved.</p>
            <nav className="flex flex-wrap items-center justify-center gap-6 text-xs text-white/45">
              <a href="#" className="transition hover:text-white">Privacy</a>
              <a href="#" className="transition hover:text-white">Terms</a>
              <a href="#" className="transition hover:text-white">Cookies</a>
              <a href="/login" className="transition hover:text-white">Sign in</a>
            </nav>
          </div>
        </div>
      </footer>
    </>
  );
}
