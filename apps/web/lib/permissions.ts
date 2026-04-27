import type { UserRole } from "./types";

export const ROLE_HOME: Record<UserRole, string> = {
  Customer: "/customer",
  WarehouseProvider: "/warehouse",
  ServiceProvider: "/service-provider",
  Employer: "/employer",
  Worker: "/worker",
  TruckingCompany: "/trucking",
  Driver: "/trucking",
  GateStaff: "/warehouse/stations/dock",
  Admin: "/admin",
  SuperAdmin: "/super-admin",
};

const SEGMENT_ROLES: Record<string, UserRole[]> = {
  customer: ["Customer"],
  warehouse: ["WarehouseProvider"],
  "service-provider": ["ServiceProvider"],
  employer: ["Employer"],
  worker: ["Worker"],
  trucking: ["TruckingCompany"],
  driver: ["Driver"],
  gate: ["GateStaff"],
  admin: ["Admin", "SuperAdmin"],
  "super-admin": ["SuperAdmin"],
};

export function canAccessSegment(role: UserRole, segment: string, isPlatformAdmin = false): boolean {
  if (role === "SuperAdmin") return true;
  if (isPlatformAdmin && segment === "admin") return true;
  const allowed = SEGMENT_ROLES[segment];
  if (!allowed) return true;
  return allowed.includes(role);
}

export function homeForRole(role: UserRole | null | undefined): string {
  if (!role) return "/login";
  return ROLE_HOME[role] ?? "/dashboard";
}
