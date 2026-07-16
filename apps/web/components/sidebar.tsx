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
  User,
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
  Send,
  Container,
  Ship,
  DoorOpen,
  LifeBuoy,
  Layers,
  Handshake,
  Store,
  SlidersHorizontal,
} from "lucide-react";
import type { UserRole } from "@/lib/types";
import { isBusinessRole, canAccessMarketplace } from "@/lib/relationships";
import { useCustomization } from "@/lib/hooks/use-customization";
import { cn } from "@/lib/utils";

/** Maps a nav href to the customization module key it belongs to (for hide/rename/reorder). */
const HREF_MODULE: Record<string, string> = {
  "/drayage-company/board": "orders-board",
  "/drayage-company/dispatch": "dispatch",
  "/drayage-company/fleet": "fleet",
  "/drayage-company/rates": "rates",
  "/drayage-company/invoicing": "invoicing",
  "/drayage-company/reports": "reports",
  "/drayage-company/settlement": "settlement",
  "/drayage-company/fuel-surcharge": "fuel-surcharge",
  "/drayage-company/shipping-lines": "shipping-lines",
  "/drayage-company/equipment-report": "equipment-report",
  "/drayage-company/dead-runs": "dead-runs",
  "/drayage-company/terminals": "terminals",
  "/trucking/reports": "reports",
  "/trucking/settlement": "settlement",
  "/trucking/fuel-surcharge": "fuel-surcharge",
};

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
      { href: "/copilot", label: "AI Copilot", icon: Sparkles },
      { href: "/messages", label: "Messages", icon: MessageSquare },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/reviews", label: "Reviews", icon: Star },
    ],
  });

  // Business accounts can grow into extra roles and connect with partners.
  if (isBusinessRole(role)) {
    sections.push({
      label: "My business",
      items: [
        { href: "/partners", label: "Partners", icon: Handshake },
        { href: "/company/add-role", label: "Add a role", icon: Layers },
        { href: "/customize", label: "Customize workspace", icon: SlidersHorizontal },
      ],
    });
  }

  // Marketplace is a shared fifth world (rentals & services) open to every business.
  if (canAccessMarketplace(role) || isAdmin || role === "Admin" || role === "SuperAdmin") {
    sections.push({
      label: "Rentals & Services",
      items: [
        { href: "/marketplace", label: "Marketplace", icon: Store },
        { href: "/marketplace/browse", label: "Browse listings", icon: Search },
        { href: "/marketplace/create", label: "Post a listing", icon: Plus },
        { href: "/marketplace/my-listings", label: "My listings", icon: Tag },
        { href: "/marketplace/requests", label: "Requests", icon: ClipboardList },
      ],
    });
  }

  if (isAdmin || role === "Admin" || role === "SuperAdmin") {
    sections.push({
      label: "Administration",
      items: [
        { href: "/admin/compliance", label: "Compliance queue", icon: ClipboardCheck },
        { href: "/admin/role-requests", label: "Role requests", icon: Layers },
        { href: "/admin/companies", label: "Companies", icon: Building2 },
        { href: "/admin/bookings", label: "Booking routing", icon: ClipboardList },
        { href: "/admin/entities", label: "Entity manager", icon: Database },
        { href: "/admin/freight-pricing", label: "Freight pricing", icon: DollarSign },
        { href: "/admin/billing", label: "Platform finance", icon: CreditCard },
        { href: "/admin/sales-agents", label: "Sales & commissions", icon: DollarSign },
        { href: "/admin/shipping-carriers", label: "Platform carriers", icon: Truck },
        { href: "/admin/users", label: "Users", icon: Users },
        { href: "/admin/certifications", label: "Certifications", icon: ShieldCheck },
        { href: "/admin/work-photos", label: "Work photos", icon: Image },
        { href: "/admin/labour-calendar", label: "Labour calendar", icon: Calendar },
        { href: "/admin/disputes", label: "Disputes", icon: AlertTriangle },
        { href: "/admin/platform-settings", label: "Platform settings", icon: Settings },
        { href: "/admin/audit", label: "Audit logs", icon: ScrollText },
        { href: "/admin/health", label: "System health", icon: Activity },
        { href: "/admin/system-health", label: "Diagnostics", icon: Activity },
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
        { href: "/super-admin/operations", label: "Operations log", icon: Activity },
        { href: "/super-admin/companies", label: "Companies", icon: Building2 },
        { href: "/super-admin/users", label: "Users", icon: Users },
        { href: "/super-admin/certifications", label: "Certifications", icon: ShieldCheck },
        { href: "/super-admin/compliance", label: "Compliance", icon: Shield },
        { href: "/super-admin/billing", label: "Billing oversight", icon: CreditCard },
        { href: "/super-admin/finance", label: "Payments & finance", icon: Wallet },
        { href: "/super-admin/support", label: "Support inbox", icon: LifeBuoy },
        { href: "/super-admin/customizations", label: "Customization requests", icon: SlidersHorizontal },
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
        { href: "/warehouse/rates", label: "Rates & zones", icon: DollarSign },
        { href: "/warehouse/invoicing", label: "Invoicing", icon: FileText },
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
        { href: "/service-provider/rates", label: "Rates", icon: DollarSign },
        { href: "/service-provider/invoicing", label: "Invoicing", icon: FileText },
        { href: "/service-provider/billing", label: "Billing & payouts", icon: CreditCard },
        { href: "/service-provider/team", label: "Team", icon: Users },
      ],
    });
  }

  if (role === "TruckingCompany") {
    sections.push({
      label: "Trucking",
      items: [
        { href: "/trucking", label: "Job board", icon: Truck },
        { href: "/trucking/loads", label: "Dispatch board", icon: Package },
        { href: "/trucking/my-loads", label: "My loads", icon: ClipboardList },
        { href: "/trucking/post-load", label: "Post a load", icon: Plus },
        { href: "/trucking/fleet", label: "Fleet", icon: Truck },
        { href: "/trucking/dispatch", label: "Dispatch", icon: ClipboardList },
        { href: "/trucking/appointments", label: "Dock appointments", icon: Calendar },
        { href: "/trucking/pod", label: "POD review", icon: ScrollText },
        { href: "/trucking/rates", label: "Rates & lanes", icon: DollarSign },
        { href: "/trucking/fuel-surcharge", label: "Fuel surcharge", icon: DollarSign },
        { href: "/trucking/settlement", label: "Driver settlement", icon: DollarSign },
        { href: "/trucking/reports", label: "Reports & KPIs", icon: BarChart3 },
        { href: "/trucking/invoicing", label: "Invoicing", icon: FileText },
        { href: "/trucking/finance", label: "Finance", icon: DollarSign },
        { href: "/trucking/team", label: "Team", icon: Users },
      ],
    });
  }

  if (role === "Driver") {
    sections.push({
      label: "Driving",
      items: [
        { href: "/driver", label: "My trips", icon: Truck },
        { href: "/driver/loads", label: "Load marketplace", icon: Package },
        { href: "/driver/my-loads", label: "All trips", icon: ClipboardList },
        { href: "/driver/drayage", label: "Drayage work orders", icon: Container },
        { href: "/driver/pod", label: "Proof of delivery", icon: FileText },
        { href: "/driver/dropoff", label: "Warehouse drop-off", icon: Package },
        { href: "/driver/documents", label: "Documents", icon: FileText },
      ],
    });
  }

  if (role === "Shipper") {
    sections.push({
      label: "Freight & Delivery",
      items: [
        { href: "/shipper", label: "Dashboard", icon: Send },
        { href: "/shipper/post-load", label: "Post a delivery", icon: Plus },
        { href: "/shipper/loads", label: "My deliveries", icon: ClipboardList },
      ],
    });
  }

  if (role === "DrayageCompany") {
    sections.push({
      label: "Drayage",
      items: [
        { href: "/drayage-company", label: "Container work", icon: Container },
        { href: "/drayage-company/board", label: "Orders board", icon: ClipboardList },
        { href: "/drayage-company/dispatch", label: "Dispatch", icon: Truck },
        { href: "/drayage-company/fleet", label: "Fleet", icon: Truck },
        { href: "/drayage-company/terminals", label: "Terminals", icon: Container },
        { href: "/drayage-company/shipping-lines", label: "Shipping lines", icon: Ship },
        { href: "/drayage-company/rates", label: "Rates & lanes", icon: DollarSign },
        { href: "/drayage-company/fuel-surcharge", label: "Fuel surcharge", icon: DollarSign },
        { href: "/drayage-company/settlement", label: "Driver settlement", icon: DollarSign },
        { href: "/drayage-company/equipment-report", label: "Equipment & charges", icon: Layers },
        { href: "/drayage-company/dead-runs", label: "Dead runs", icon: Activity },
        { href: "/drayage-company/reports", label: "Reports & KPIs", icon: BarChart3 },
        { href: "/drayage-company/invoicing", label: "Invoicing", icon: DollarSign },
      ],
    });
  }

  if (role === "FreightForwarder") {
    sections.push({
      label: "Forwarding",
      items: [
        { href: "/freight-forwarder", label: "Container orders", icon: Ship },
        { href: "/freight-forwarder/rates", label: "Forwarding rates", icon: DollarSign },
        { href: "/freight-forwarder/invoicing", label: "Invoicing", icon: DollarSign },
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
      label: "Freight & containers",
      items: [
        { href: "/customer/post-load", label: "Post a load", icon: Plus },
        { href: "/customer/loads", label: "My loads", icon: ClipboardList },
        { href: "/customer/drayage", label: "Container orders", icon: Container },
      ],
    });
    sections.push({
      label: "Services & orders",
      items: [
        { href: "/customer/services", label: "Services", icon: Briefcase },
        { href: "/customer/orders", label: "Orders", icon: ClipboardList },
        { href: "/customer/invoices", label: "Invoices", icon: DollarSign },
        { href: "/customer/billing", label: "Billing", icon: CreditCard },
        { href: "/customer/tracking", label: "Tracking", icon: Truck },
        { href: "/customer/team", label: "Team", icon: Users },
      ],
    });
  }

  if (role === "GateStaff") {
    sections.push({
      label: "Gate",
      items: [
        { href: "/gate-staff", label: "Yard & gate", icon: DoorOpen },
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
        { href: "/worker/earnings", label: "Earnings", icon: Wallet },
        { href: "/worker/profile", label: "Profile", icon: User },
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
        { href: "/employer/shifts", label: "Shift console", icon: ClipboardCheck },
        { href: "/employer/create-shift", label: "Post shift", icon: Plus },
        { href: "/employer/hours", label: "Hours & attendance", icon: ClipboardCheck },
        { href: "/employer/rates", label: "Rates", icon: DollarSign },
        { href: "/employer/invoicing", label: "Invoicing", icon: FileText },
        { href: "/employer/billing", label: "Billing & invoices", icon: CreditCard },
        { href: "/employer/browse-workers", label: "Browse workers", icon: UserSearch },
        { href: "/employer/calendar", label: "Labour calendar", icon: Calendar },
        { href: "/employer/team", label: "Team", icon: Users },
        { href: "/employer/company-profile", label: "Company profile", icon: Building2 },
        { href: "/employer/account", label: "My account", icon: User },
      ],
    });
  }

  return sections;
}

export function Sidebar({ role, isAdmin }: { role: UserRole | null; isAdmin: boolean }) {
  const pathname = usePathname();
  const { isHidden, term, orderSections } = useCustomization();
  const sections = buildNav(role, isAdmin)
    .map((section) => ({
      ...section,
      items: orderSections(
        section.items.filter((item) => {
          const moduleKey = HREF_MODULE[item.href];
          return !moduleKey || !isHidden(moduleKey);
        }),
        (item) => HREF_MODULE[item.href] ?? item.href,
      ).map((item) => ({ ...item, label: term(item.label, item.label) })),
    }))
    .filter((section) => section.items.length > 0);
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
