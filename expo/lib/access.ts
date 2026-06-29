import type { CompanyType, User, UserRole } from '@/constants/types';

/** Feature flag for the two-world (domain) layer. Flip to false to restore pre-domain behavior. */
export const ENABLE_DOMAINS = true;

/** The product worlds plus the shared admin layer. */
export type Domain = 'labour' | 'logistics' | 'freight';

/** Roles belonging to the Labour world. */
export const LABOUR_ROLES: UserRole[] = ['Worker', 'Employer'];

/** Roles belonging to the Logistics & Warehousing world. */
export const LOGISTICS_ROLES: UserRole[] = [
  'Customer',
  'WarehouseProvider',
  'ServiceProvider',
  'GateStaff',
];

/** Roles belonging to the Freight & Delivery world (Onro-style courier marketplace). */
export const FREIGHT_ROLES: UserRole[] = ['Shipper', 'Driver', 'TruckingCompany'];

/** Roles in the shared admin layer that oversees both worlds. */
export const ADMIN_ROLES: UserRole[] = ['Admin', 'SuperAdmin'];

/** Maps each non-admin role to exactly one world. Admin roles are intentionally absent (they see both). */
export const DOMAIN_BY_ROLE: Partial<Record<UserRole, Domain>> = {
  Worker: 'labour',
  Employer: 'labour',
  Customer: 'logistics',
  WarehouseProvider: 'logistics',
  ServiceProvider: 'logistics',
  TruckingCompany: 'freight',
  GateStaff: 'logistics',
  Driver: 'freight',
  Shipper: 'freight',
};

/** Human-friendly labels for each world. */
export const DOMAIN_LABELS: Record<Domain, string> = {
  labour: 'Labour',
  logistics: 'Logistics & Warehousing',
  freight: 'Freight & Delivery',
};

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  Customer: '/customer',
  WarehouseProvider: '/warehouse-provider',
  ServiceProvider: '/service-provider',
  Employer: '/employer',
  Worker: '/worker',
  TruckingCompany: '/trucking-company',
  Driver: '/driver',
  GateStaff: '/gate-staff',
  Shipper: '/shipper',
  Admin: '/admin',
  SuperAdmin: '/super-admin',
};

export const COMPANY_REQUIRED_ROLES: UserRole[] = [
  'Customer',
  'WarehouseProvider',
  'ServiceProvider',
  'Employer',
  'TruckingCompany',
  'GateStaff',
  'Shipper',
];

export const COMPANY_TYPE_BY_ROLE: Partial<Record<UserRole, CompanyType>> = {
  Customer: 'Customer',
  WarehouseProvider: 'WarehouseProvider',
  ServiceProvider: 'ServiceProvider',
  Employer: 'Employer',
  TruckingCompany: 'TruckingCompany',
  GateStaff: 'WarehouseProvider',
  Shipper: 'Shipper',
};

const ROUTE_PREFIXES: Record<string, UserRole[]> = {
  customer: ['Customer'],
  'warehouse-provider': ['WarehouseProvider'],
  'service-provider': ['ServiceProvider'],
  employer: ['Employer'],
  worker: ['Worker'],
  'trucking-company': ['TruckingCompany'],
  driver: ['Driver'],
  'gate-staff': ['GateStaff'],
  shipper: ['Shipper'],
  admin: ['Admin', 'SuperAdmin'],
  'super-admin': ['SuperAdmin'],
  fulfillment: ['WarehouseProvider', 'Customer', 'Admin', 'SuperAdmin'],
};

export function getRoleRoute(role: UserRole): string {
  return ROLE_HOME_ROUTES[role] ?? '/';
}

export function canAccessSegment(role: UserRole, segment: string | undefined, isPlatformAdmin: boolean = false): boolean {
  if (!segment) {
    return true;
  }

  const allowedRoles = ROUTE_PREFIXES[segment];
  if (!allowedRoles) {
    return true;
  }

  if (role === 'SuperAdmin') {
    return true;
  }

  if (isPlatformAdmin && segment === 'admin') {
    return true;
  }

  return allowedRoles.includes(role);
}

export function requiresCompany(role: UserRole): boolean {
  return COMPANY_REQUIRED_ROLES.includes(role);
}

export function canManageAllData(user: User | null): boolean {
  return user?.role === 'Admin' || user?.role === 'SuperAdmin';
}

/** True when the role is part of the shared admin layer (sees both worlds). */
export function isAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

/**
 * Returns the worlds a user can see.
 * Admins always get both worlds; other roles get the single world they belong to.
 */
export function visibleDomains(user: User | null): Domain[] {
  if (!user) {
    return [];
  }
  if (isAdminRole(user.role) || user.isPlatformAdmin) {
    return ['labour', 'logistics', 'freight'];
  }
  const domain = DOMAIN_BY_ROLE[user.role];
  return domain ? [domain] : [];
}

/**
 * Infers the world for a given top-level route segment (e.g. 'worker', 'customer').
 * Used to keep the switcher in sync after deep links / refresh. Returns null for
 * shared or admin segments that belong to neither world.
 */
export function domainForSegment(segment: string | undefined): Domain | null {
  if (!segment) {
    return null;
  }
  const roles = ROUTE_PREFIXES[segment];
  if (!roles) {
    return null;
  }
  for (const role of roles) {
    const domain = DOMAIN_BY_ROLE[role];
    if (domain) {
      return domain;
    }
  }
  return null;
}
