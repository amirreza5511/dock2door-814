import type { UserRole } from "@/lib/types";

/**
 * Single source of truth for how the platform's roles relate to each other.
 * Mirror of `expo/lib/relationships.ts` and the backend
 * (`supabase/migrations/0129_role_relationships.sql`). Keep all three in sync.
 */

export type Domain = "labour" | "logistics" | "freight" | "drayage" | "marketplace";

/**
 * Roles that can enter the shared Marketplace world (rent equipment, book mobile
 * repair, post services). Every company-backed role gets it on top of their own
 * world — mirror of `expo/lib/access.ts` MARKETPLACE_ROLES.
 */
export const MARKETPLACE_ROLES: UserRole[] = [
  "Customer",
  "WarehouseProvider",
  "ServiceProvider",
  "Employer",
  "TruckingCompany",
  "GateStaff",
  "Shipper",
  "DrayageCompany",
  "FreightForwarder",
];

export function canAccessMarketplace(role: UserRole | string | null | undefined): boolean {
  return !!role && MARKETPLACE_ROLES.includes(role as UserRole);
}

export const DOMAIN_BY_ROLE: Partial<Record<UserRole, Domain>> = {
  Worker: "labour",
  Employer: "labour",
  Customer: "logistics",
  WarehouseProvider: "logistics",
  ServiceProvider: "logistics",
  GateStaff: "logistics",
  TruckingCompany: "freight",
  Driver: "freight",
  Shipper: "freight",
  DrayageCompany: "drayage",
  FreightForwarder: "drayage",
};

/** Roles that represent a company. They can add compatible roles and use Partners. */
export const BUSINESS_ROLES: UserRole[] = [
  "Customer",
  "WarehouseProvider",
  "ServiceProvider",
  "Employer",
  "TruckingCompany",
  "Shipper",
  "FreightForwarder",
  "DrayageCompany",
];

/** Individual accounts — single-purpose. They never add roles or browse unrelated areas. */
export const INDIVIDUAL_ROLES: UserRole[] = ["Worker", "Driver", "GateStaff", "SalesAgent"];

/** Who can work together — powers the Partners directory. */
export const WORKS_WITH: Partial<Record<UserRole, UserRole[]>> = {
  Employer: ["Worker", "Customer", "WarehouseProvider", "ServiceProvider"],
  Customer: ["WarehouseProvider", "ServiceProvider", "Shipper", "FreightForwarder", "Employer", "TruckingCompany"],
  WarehouseProvider: ["Customer", "ServiceProvider", "TruckingCompany", "Employer"],
  ServiceProvider: ["Customer", "WarehouseProvider"],
  Shipper: ["TruckingCompany", "Customer", "FreightForwarder"],
  TruckingCompany: ["Shipper", "Customer", "WarehouseProvider", "DrayageCompany"],
  FreightForwarder: ["DrayageCompany", "Customer", "Shipper"],
  DrayageCompany: ["FreightForwarder", "TruckingCompany", "Customer"],
  Worker: ["Employer"],
};

/** Which extra roles a business may add to itself. */
export const ADDABLE_ROLES: Partial<Record<UserRole, UserRole[]>> = {
  Customer: ["Employer", "Shipper", "FreightForwarder"],
  WarehouseProvider: ["Customer", "Employer", "ServiceProvider"],
  ServiceProvider: ["Customer", "Employer"],
  Employer: ["Customer", "WarehouseProvider"],
  TruckingCompany: ["Customer", "Shipper", "DrayageCompany"],
  Shipper: ["Customer", "FreightForwarder"],
  DrayageCompany: ["Customer", "TruckingCompany", "FreightForwarder"],
  FreightForwarder: ["Customer", "DrayageCompany"],
};

export const ROLE_LABEL: Record<UserRole, string> = {
  Customer: "Customer",
  WarehouseProvider: "Warehouse Provider",
  ServiceProvider: "Service Provider",
  Employer: "Employer",
  Worker: "Worker",
  TruckingCompany: "Trucking Company",
  Driver: "Driver",
  GateStaff: "Gate Staff",
  Shipper: "Shipper",
  DrayageCompany: "Drayage Company",
  FreightForwarder: "Freight Forwarder",
  SalesAgent: "Sales Agent",
  Admin: "Admin",
  SuperAdmin: "Super Admin",
};

export const ROLE_BLURB: Partial<Record<UserRole, string>> = {
  Customer: "Find warehouse space, book storage, manage inventory and shipping.",
  WarehouseProvider: "List warehouse space, manage bookings and fulfillment.",
  ServiceProvider: "Offer labour, forklift, rework and other logistics services.",
  Employer: "Post shifts, hire workers, manage assignments and payroll.",
  TruckingCompany: "Run a fleet, dispatch loads and manage dock appointments.",
  Shipper: "Post deliveries and hire carriers to move freight.",
  FreightForwarder: "Post container drayage orders to move import/export freight.",
  DrayageCompany: "Run container drayage — pull, deliver and return containers.",
};

export const COMPANY_TYPE_FOR_ROLE: Partial<Record<UserRole, string>> = {
  Customer: "Customer",
  WarehouseProvider: "WarehouseProvider",
  ServiceProvider: "ServiceProvider",
  Employer: "Employer",
  TruckingCompany: "TruckingCompany",
  Shipper: "Shipper",
  FreightForwarder: "FreightForwarder",
  DrayageCompany: "DrayageCompany",
};

/** Tailwind-ish colour tokens per world, for partner-card accents. */
export const DOMAIN_COLORS: Record<Domain, { text: string; bg: string; border: string }> = {
  labour: { text: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200" },
  logistics: { text: "text-teal-700", bg: "bg-teal-50", border: "border-teal-200" },
  freight: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  drayage: { text: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
  marketplace: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
};

export function isBusinessRole(role: UserRole | string | null | undefined): boolean {
  return !!role && BUSINESS_ROLES.includes(role as UserRole);
}

export function isIndividualRole(role: UserRole | string | null | undefined): boolean {
  return !!role && INDIVIDUAL_ROLES.includes(role as UserRole);
}

export function worksWith(role: UserRole | string | null | undefined): UserRole[] {
  if (!role) return [];
  return WORKS_WITH[role as UserRole] ?? [];
}

export function addableRolesFor(
  role: UserRole | string | null | undefined,
  alreadyHeld: UserRole[] = [],
): UserRole[] {
  if (!role) return [];
  const held = new Set<UserRole>([role as UserRole, ...alreadyHeld]);
  return (ADDABLE_ROLES[role as UserRole] ?? []).filter((r) => !held.has(r));
}

export function canAddRole(a: UserRole | string, b: UserRole): boolean {
  return (ADDABLE_ROLES[a as UserRole] ?? []).includes(b);
}

export function canWorkTogether(a: UserRole | string, b: UserRole | string): boolean {
  return (
    (WORKS_WITH[a as UserRole] ?? []).includes(b as UserRole) ||
    (WORKS_WITH[b as UserRole] ?? []).includes(a as UserRole)
  );
}

/** Business partner roles (excludes individuals like Worker) that a role can transact with. */
export function partnerRolesFor(role: UserRole | string | null | undefined): UserRole[] {
  return worksWith(role).filter((r) => isBusinessRole(r));
}

export function domainForRole(role: UserRole | string | null | undefined): Domain | null {
  if (!role) return null;
  return DOMAIN_BY_ROLE[role as UserRole] ?? null;
}

/** Map a company_type string to its equivalent UserRole (they share names for businesses). */
export function roleForCompanyType(type: string | null | undefined): UserRole | null {
  if (!type) return null;
  return (BUSINESS_ROLES.find((r) => COMPANY_TYPE_FOR_ROLE[r] === type) as UserRole) ?? null;
}
