"use client";

import { Hammer } from "lucide-react";
import MarketplaceProviderDashboard from "@/components/MarketplaceProviderDashboard";

export default function RepairProviderPage() {
  return (
    <MarketplaceProviderDashboard
      config={{
        kicker: "Mobile Repair & Field Service",
        tagline: "Dispatch technicians and crews to customer sites on demand.",
        primaryType: "mobile_repair",
        icon: Hammer,
        accent: "text-purple-500",
        jobNoun: "job",
      }}
    />
  );
}
