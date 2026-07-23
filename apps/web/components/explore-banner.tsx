"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, UserPlus, X } from "lucide-react";
import { useExplore } from "@/lib/explore-store";
import type { UserRole } from "@/lib/types";

/** Human labels for explore roles (mirrors the mobile domain catalog). */
const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  Employer: "Employer",
  Worker: "Worker",
  EmploymentAgency: "Employment Agency",
  Customer: "Customer",
  WarehouseProvider: "Warehouse Provider",
  ServiceProvider: "Service Provider",
  GateStaff: "Gate Staff",
  Shipper: "Shipper",
  Driver: "Owner-Operator",
  TruckingCompany: "Fleet / Carrier",
  FreightForwarder: "Freight Forwarder",
  DrayageCompany: "Drayage Company",
  CustomsBroker: "Customs Broker",
  MarketplaceBuyer: "Marketplace Buyer",
  EquipmentRentalCompany: "Equipment / Crane Rental",
  MobileRepairProvider: "Mobile Repair & Services",
  CargoInsurer: "Cargo Insurer",
  ImporterExporter: "Importer / Exporter",
  GlobalFreightForwarder: "Global Freight Forwarder",
  Carrier: "Carrier / Shipping Line",
};

/**
 * Thin banner shown at the top of the app shell while a no-account visitor is
 * exploring a role dashboard. Offers "Create a free account" and "Exit".
 */
export function ExploreBanner({ role }: { role: UserRole | null }) {
  const router = useRouter();
  const { stopExplore } = useExplore();
  const label = (role && ROLE_LABELS[role]) ?? "guest";

  const exit = () => {
    stopExplore();
    router.push("/");
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-primary/20 bg-gradient-to-r from-primary/15 via-purple-500/10 to-sky-500/10 px-4 py-2 text-sm">
      <span className="flex items-center gap-2 font-medium text-foreground">
        <Compass className="h-4 w-4 text-primary" />
        Exploring as <span className="font-semibold text-primary">{label}</span>
        <span className="hidden text-muted-foreground sm:inline">· sample & public data · no account needed</span>
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/login?next=/dashboard"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
        >
          <UserPlus className="h-3.5 w-3.5" /> Create a free account
        </Link>
        <button
          type="button"
          onClick={exit}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Exit
        </button>
      </div>
    </div>
  );
}
