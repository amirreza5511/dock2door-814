"use client";

import { ShieldCheck } from "lucide-react";
import MarketplaceProviderDashboard from "@/components/MarketplaceProviderDashboard";

export default function CargoInsurerPage() {
  return (
    <MarketplaceProviderDashboard
      config={{
        kicker: "Cargo Insurance",
        tagline: "Quote and underwrite freight coverage based on cargo value.",
        primaryType: "cargo_insurance",
        icon: ShieldCheck,
        accent: "text-yellow-500",
        jobNoun: "policy",
      }}
    />
  );
}
