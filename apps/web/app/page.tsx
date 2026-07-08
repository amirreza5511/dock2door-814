import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Showcase3D } from "@/components/landing/showcase-3d";
import { Modules } from "@/components/landing/modules";
import { CtaFooter } from "@/components/landing/cta-footer";

export default function LandingPage() {
  return (
    <main className="bg-[#04121a]">
      <Hero />
      <HowItWorks />
      <Showcase3D />
      <Modules />
      <CtaFooter />
    </main>
  );
}
