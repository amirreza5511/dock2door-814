import { Hero } from "@/components/landing/hero";
import { TrustBand } from "@/components/landing/trust-band";
import { About } from "@/components/landing/about";
import { HowItWorks } from "@/components/landing/how-it-works";
import { NetworkGlobe } from "@/components/landing/network-globe";
import { Showcase3D } from "@/components/landing/showcase-3d";
import { Modules } from "@/components/landing/modules";
import { Capabilities } from "@/components/landing/capabilities";
import { Gallery } from "@/components/landing/gallery";
import { News } from "@/components/landing/news";
import { Spotlight } from "@/components/landing/spotlight";
import { IntroReel } from "@/components/landing/intro-reel";
import { CtaFooter } from "@/components/landing/cta-footer";

export default function LandingPage() {
  return (
    <main className="landing-bg relative w-full overflow-hidden">
      {/* continuous ambient glows that flow through the whole page */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute left-[-10%] top-[38%] h-[40rem] w-[40rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(45,226,199,0.10), transparent 68%)" }}
        />
        <div
          className="absolute right-[-12%] top-[62%] h-[44rem] w-[44rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(129,140,248,0.11), transparent 68%)" }}
        />
        <div
          className="absolute left-[30%] bottom-[4%] h-[36rem] w-[36rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(56,189,248,0.08), transparent 68%)" }}
        />
      </div>

      <div className="relative z-10">
        <Hero />
        <TrustBand />
        <About />
        <HowItWorks />
        <NetworkGlobe />
        <Showcase3D />
        <Modules />
        <Capabilities />
        <Gallery />
        <News />
        <Spotlight />
        <IntroReel />
        <CtaFooter />
      </div>
    </main>
  );
}
