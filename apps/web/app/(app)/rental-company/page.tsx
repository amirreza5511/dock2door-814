"use client";

import { Forklift } from "lucide-react";
import MarketplaceProviderDashboard from "@/components/MarketplaceProviderDashboard";

export default function RentalCompanyPage() {
  return (
    <MarketplaceProviderDashboard
      config={{
        kicker: "Equipment & Crane Rental",
        tagline: "Rent out forklifts, cranes, hoists and heavy machinery.",
        primaryType: "equipment_rental",
        icon: Forklift,
        accent: "text-amber-500",
        jobNoun: "rental",
      }}
    />
  );
}
