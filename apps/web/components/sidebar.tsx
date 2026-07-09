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
  Calendar,
  MessageSquare,
  Bell,
  Star,
  AlertTriangle,
  Search,
  Package,
  DollarSign,
  UserSearch,
  Plus,
  Image,
  BarChart3,
  Shield,
  Database,
  CreditCard,
  FileText,
  RotateCcw,
  Tag,
  Boxes,
  ClipboardCheck,
  Megaphone,
  Sparkles,
  UserPlus,
  Wallet,
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

  // Global pages available to all logged-in users
  sections.push({
    label: "Platform",
    items: [
      { href: "/messages", label: "Messages", icon: MessageSquare },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/reviews", label: "Reviews", icon: Star },
    ],
  });

  if (isAdmin || role === "Admin" || role === "SuperAdmin") {
    sections.push({
      label: "Administration",
      items: [
        { href: "/admin/compliance", label: "Compliance queue", icon: ClipboardCheck },
        { href: "/admin/companies", label: "Companies", icon: Building2 },
        { href: "/admin/users", label: "Users", icon: Users },
        { href: "/admin/certifications", label: "Certifications", icon: ShieldCheck },
        { href: "/admin/work-photos", label: "Work photos", icon: Image },
        { href: "/admin/labour-calendar", label: "Labour calendar", icon: Calendar },
        { href: "/admin/disputes", label: "Disputes", icon: AlertTriangle },
        { href: "/admin/platform-settings", label: "Platform settings", icon: Settings },
        { href: "/admin/audit", label: "Audit logs", icon: ScrollText },
        { href: "/admin/health", label: "System health", icon: Activity },
      ],
    });
  }

  if (role === "SuperAdmin") {
    sections.push({
      label: "Super Admin",
      items: [
        { href: "/super-admin", label: "Overview", icon: Settings },
        { href: "/super-admin/roles", label: "Platform roles", icon: ShieldCheck },
        { href: "/super-admin/ads", label: "Ad Manager", icon: Megaphone },
        { href: "/super-admin/analytics", label: "Analytics", icon: BarChart3 },
        { href: "/super-admin/controls", label: "Controls", icon: Shield },
        { href: "/super-admin/data-manager", label: "Data manager", icon: Database },
        { href: "/super-admin/billing", label: "Billing oversight", icon: CreditCard },
      ],
    });
  }

  if (role === "WarehouseProvider") {
    sections.push({
      label: "Warehouse",
      items: [
        { href: "/warehouse", label: "Operations", icon: Warehouse },
        { href: "/warehouse/listings", label: "Listings", icon: PackageSearch },
        { href: "/warehouse/bookings", label: "Bookings", icon: ClipboardList },
        { href: "/warehouse/wms", label: "WMS overview", icon: Boxes },
        { href: "/warehouse/staff", label: "Staff", icon: Users },
        { href: "/warehouse/stations", label: "Stations", icon: Wrench },
        { href: "/warehouse/carriers", label: "Carriers", icon: Truck },
        { href: "/warehouse/billing", label: "Billing & payouts", icon: CreditCard },
      ],
    });
    sections.push({
      label: "Fulfillment",
      items: [
        { href: "/fulfillment/orders", label: "Orders", icon: ClipboardList },
        { href: "/fulfillment/shipments", label: "Shipments", icon: Truck },
        { href: "/fulfillment/manifest", label: "Manifest", icon: FileText },
        { href: "/fulfillment/returns", label: "Returns (RMA)", icon: RotateCcw },
        { href: "/fulfillment/rate-shop", label: "Rate shop", icon: Tag },
        { href: "/fulfillment/integrations", label: "Integrations", icon: PackageSearch },
      ],
    });
  }

  if (role === "ServiceProvider") {
    sections.push({
      label: "Services",
      items: [
        { href: "/service-provider", label: "Jobs", icon: Briefcase },
        { href: "/service-provider/listings", label: "My listings", icon: ClipboardList },
        { href: "/service-provider/create-listing", label: "New listing", icon: Plus },
      ],
    });
  }

  if (role === "TruckingCompany" || role === "Driver") {
    sections.push({
      label: "Trucking",
      items: [
        { href: "/trucking", label: "Job board", icon: Truck },
        { href: "/trucking/fleet", label: "Fleet", icon: Truck },
        { href: "/trucking/dispatch", label: "Dispatch", icon: ClipboardList },
        { href: "/trucking/appointments", label: "Dock appointments", icon: Calendar },
        { href: "/trucking/pod", label: "POD review", icon: ScrollText },
        { href: "/trucking/finance", label: "Finance", icon: DollarSign },
      ],
    });
  }

  if (role === "Customer") {
    sections.push({
      label: "Warehousing",
      items: [
        { href: "/customer/warehouses", label: "Find warehouses", icon: Search },
        { href: "/customer/bookings", label: "My bookings", icon: ClipboardList },
        { href: "/customer/inventory", label: "Inventory", icon: Package },
      ],
    });
    sections.push({
      label: "Services & orders",
      items: [
        { href: "/customer/services", label: "Services", icon: Briefcase },
        { href: "/customer/orders", label: "Orders", icon: ClipboardList },
        { href: "/customer/invoices", label: "Invoices", icon: DollarSign },
        { href: "/customer/tracking", label: "Tracking", icon: Truck },
      ],
    });
  }

  if (role === "GateStaff") {
    sections.push({
      label: "Gate",
      items: [
        { href: "/warehouse/stations/dock", label: "Dock station", icon: Warehouse },
      ],
    });
  }

  if (role === "Worker") {
    sections.push({
      label: "Work",
      items: [
        { href: "/worker", label: "Overview", icon: LayoutDashboard },
        { href: "/worker/browse-shifts", label: "Browse shifts", icon: Search },
        { href: "/worker/shifts", label: "My shifts", icon: ClipboardList },
        { href: "/worker/availability", label: "Availability", icon: Calendar },
        { href: "/worker/certifications", label: "Certifications", icon: ShieldCheck },
      ],
    });
  }

  if (role === "SalesAgent") {
    sections.push({
      label: "Sales",
      items: [
        { href: "/sales-agent", label: "Dashboard", icon: Sparkles },
        { href: "/sales-agent/onboard", label: "Onboard a client", icon: UserPlus },
        { href: "/sales-agent/clients", label: "My clients", icon: Building2 },
        { href: "/sales-agent/leads", label: "Leads pipeline", icon: ClipboardList },
        { href: "/sales-agent/earnings", label: "Commission ledger", icon: Wallet },
        { href: "/sales-agent/profile", label: "Agent profile", icon: UserSearch },
      ],
    });
  }

  if (role === "Employer") {
    sections.push({
      label: "Labour",
      items: [
        { href: "/employer", label: "Shifts & applications", icon: ClipboardList },
        { href: "/employer/create-shift", label: "Post shift", icon: Plus },
        { href: "/employer/hours", label: "Hours & attendance", icon: ClipboardCheck },
        { href: "/employer/billing", label: "Billing & invoices", icon: CreditCard },
        { href: "/employer/browse-workers", label: "Browse workers", icon: UserSearch },
        { href: "/employer/calendar", label: "Labour calendar", icon: Calendar },
      ],
    });
  }

  return sections;
}

export function Sidebar({ role, isAdmin }: { role: UserRole | null; isAdmin: boolean }) {
  const pathname = usePathname();
  const sections = buildNav(role, isAdmin);
  return (
    <aside className="glass-panel hidden w-64 shrink-0 border-r border-white/5 md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-white/5 px-5">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground text-xs font-bold shadow-[0_6px_20px_-6px_hsl(168_78%_45%/0.7)]">D2</span>
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
                        active
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
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
