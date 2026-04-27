"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  ShieldCheck,
  Warehouse,
  ClipboardList,
  Truck,
  Briefcase,
  PackageSearch,
  Wrench,
  ScrollText,
  Settings,
  Activity,
} from "lucide-react";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

function buildNav(role: UserRole | null, isAdmin: boolean): NavSection[] {
  const sections: NavSection[] = [
    { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  ];

  if (isAdmin || role === "Admin" || role === "SuperAdmin") {
    sections.push({
      label: "Administration",
      items: [
        { href: "/admin/companies", label: "Companies", icon: Building2 },
        { href: "/admin/users", label: "Users", icon: Users },
        { href: "/admin/certifications", label: "Certifications", icon: ShieldCheck },
        { href: "/admin/audit", label: "Audit Logs", icon: ScrollText },
        { href: "/admin/health", label: "System Health", icon: Activity },
      ],
    });
  }
  if (role === "SuperAdmin") {
    sections.push({
      label: "Super Admin",
      items: [
        { href: "/super-admin", label: "Overview", icon: Settings },
        { href: "/super-admin/roles", label: "Platform Roles", icon: ShieldCheck },
      ],
    });
  }
  if (role === "WarehouseProvider" || role === "Worker" || role === "Customer" || role === "Driver" || role === "GateStaff") {
    // expose warehouse + fulfillment to provider only
  }
  if (role === "WarehouseProvider") {
    sections.push({
      label: "Warehouse",
      items: [
        { href: "/warehouse", label: "Operations", icon: Warehouse },
        { href: "/warehouse/listings", label: "Listings", icon: PackageSearch },
        { href: "/warehouse/bookings", label: "Bookings", icon: ClipboardList },
        { href: "/warehouse/staff", label: "Staff", icon: Users },
        { href: "/warehouse/stations", label: "Stations", icon: Wrench },
      ],
    });
    sections.push({
      label: "Fulfillment",
      items: [
        { href: "/fulfillment/orders", label: "Orders", icon: ClipboardList },
        { href: "/fulfillment/shipments", label: "Shipments", icon: Truck },
        { href: "/fulfillment/integrations", label: "Integrations", icon: PackageSearch },
      ],
    });
  }
  if (role === "ServiceProvider") {
    sections.push({
      label: "Services",
      items: [
        { href: "/service-provider", label: "Jobs", icon: Briefcase },
      ],
    });
  }
  if (role === "TruckingCompany" || role === "Driver") {
    sections.push({
      label: "Trucking",
      items: [
        { href: "/trucking", label: "Job board", icon: Truck },
        { href: "/trucking/dispatch", label: "Dispatch", icon: ClipboardList },
        { href: "/trucking/pod", label: "POD review", icon: ScrollText },
      ],
    });
  }
  if (role === "Customer") {
    sections.push({
      label: "My account",
      items: [
        { href: "/customer", label: "Overview", icon: LayoutDashboard },
        { href: "/customer/orders", label: "Orders", icon: ClipboardList },
        { href: "/customer/tracking", label: "Tracking", icon: Truck },
        { href: "/customer/invoices", label: "Invoices", icon: ScrollText },
      ],
    });
  }
  if (role === "Worker") {
    sections.push({
      label: "Work",
      items: [
        { href: "/worker", label: "Overview", icon: LayoutDashboard },
        { href: "/worker/shifts", label: "Shifts", icon: ClipboardList },
        { href: "/worker/certifications", label: "Certifications", icon: ShieldCheck },
      ],
    });
  }
  if (role === "Employer") {
    sections.push({
      label: "Labour",
      items: [
        { href: "/employer", label: "Shifts", icon: ClipboardList },
      ],
    });
  }
  return sections;
}

export function Sidebar({ role, isAdmin }: { role: UserRole | null; isAdmin: boolean }) {
  const pathname = usePathname();
  const sections = buildNav(role, isAdmin);
  return (
    <aside className="hidden w-64 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-5">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">D2</span>
          Dock2Door
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.label} className="mb-6">
            <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.label}
            </div>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
