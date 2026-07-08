import { ArrowRight } from "lucide-react";

export function CtaFooter() {
  return (
    <>
      <section className="relative overflow-hidden bg-[#04121a] py-24">
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

      <footer className="border-t border-white/10 bg-[#04121a] py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#2de2c7] to-[#818cf8] font-display text-sm font-bold text-[#04121a]">
              D2
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-white">Dock2Door</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-white/55">
            <a href="#how" className="transition hover:text-white">How it works</a>
            <a href="#platform" className="transition hover:text-white">Platform</a>
            <a href="/login" className="transition hover:text-white">Sign in</a>
          </nav>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} Dock2Door. All rights reserved.</p>
        </div>
      </footer>
    </>
  );
}
