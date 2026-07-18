import type { CompanyType, User, UserRole } from '@/constants/types';

/** Feature flag for the two-world (domain) layer. Flip to false to restore pre-domain behavior. */
export const ENABLE_DOMAINS = true;

/** The product worlds plus the shared admin layer. */
export type Domain = 'labour' | 'logistics' | 'freight' | 'drayage' | 'marketplace';

/** Roles belonging to the Labour world. */
export const LABOUR_ROLES: UserRole[] = ['Worker', 'Employer', 'EmploymentAgency'];

/** Roles belonging to the Logistics & Warehousing world. */
export const LOGISTICS_ROLES: UserRole[] = [
  'Customer',
  'WarehouseProvider',
  'ServiceProvider',
  'GateStaff',
];

/** Roles belonging to the Freight & Delivery world (Onro-style courier marketplace). */
export const FREIGHT_ROLES: UserRole[] = ['Shipper', 'Driver', 'TruckingCompany'];

/** Roles belonging to the Container Drayage world. */
export const DRAYAGE_ROLES: UserRole[] = ['FreightForwarder', 'DrayageCompany', 'CustomsBroker'];

/**
 * Roles that live natively in the Rentals & Services world (Domain 5). These are
 * the dedicated signup roles: equipment/crane rental companies, mobile repair
 * providers, cargo insurers (all providers) plus a standalone marketplace buyer.
 */
export const MARKETPLACE_PROVIDER_ROLES: UserRole[] = [
  'EquipmentRentalCompany',
  'MobileRepairProvider',
  'CargoInsurer',
];
export const MARKETPLACE_DOMAIN_ROLES: UserRole[] = [
  ...MARKETPLACE_PROVIDER_ROLES,
  'MarketplaceBuyer',
];

/** Roles in the shared admin layer that oversees both worlds. */
export const ADMIN_ROLES: UserRole[] = ['Admin', 'SuperAdmin'];

/** Maps each non-admin role to exactly one world. Admin roles are intentionally absent (they see both). */
export const DOMAIN_BY_ROLE: Partial<Record<UserRole, Domain>> = {
  Worker: 'labour',
  Employer: 'labour',
  EmploymentAgency: 'labour',
  Customer: 'logistics',
  WarehouseProvider: 'logistics',
  ServiceProvider: 'logistics',
  TruckingCompany: 'freight',
  GateStaff: 'logistics',
  Driver: 'freight',
  Shipper: 'freight',
  DrayageCompany: 'drayage',
  FreightForwarder: 'drayage',
  CustomsBroker: 'drayage',
  EquipmentRentalCompany: 'marketplace',
  MobileRepairProvider: 'marketplace',
  CargoInsurer: 'marketplace',
  MarketplaceBuyer: 'marketplace',
};

/** Human-friendly labels for each world. */
export const DOMAIN_LABELS: Record<Domain, string> = {
  labour: 'Labour',
  logistics: 'Logistics & Warehousing',
  freight: 'Freight & Delivery',
  drayage: 'Container Drayage',
  marketplace: 'Rentals & Services',
};

/**
 * Roles that can enter the shared Marketplace world (rent equipment, book mobile
 * repair, post services). Every company-backed role gets it, on top of their own
 * world — the marketplace is a cross-cutting fifth world open to all businesses.
 */
export const MARKETPLACE_ROLES: UserRole[] = [
  'Customer',
  'WarehouseProvider',
  'ServiceProvider',
  'Employer',
  'EmploymentAgency',
  'TruckingCompany',
  'GateStaff',
  'Shipper',
  'DrayageCompany',
  'FreightForwarder',
  'CustomsBroker',
  'Guest',
  ...MARKETPLACE_DOMAIN_ROLES,
];

/** Home route for each world. Used by the world switcher to navigate on select. */
export const DOMAIN_HOME_ROUTES: Partial<Record<Domain, string>> = {
  marketplace: '/marketplace',
};

/** True when a role can access the shared Marketplace world. */
export function canAccessMarketplace(role: UserRole): boolean {
  return MARKETPLACE_ROLES.includes(role);
}

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  SalesAgent: '/sales-agent',
  Customer: '/customer',
  WarehouseProvider: '/warehouse-provider',
  ServiceProvider: '/service-provider',
  Employer: '/employer',
  EmploymentAgency: '/agency',
  Worker: '/worker',
  TruckingCompany: '/trucking-company',
  Driver: '/driver',
  GateStaff: '/gate-staff',
  Shipper: '/shipper',
  DrayageCompany: '/drayage-company',
  FreightForwarder: '/freight-forwarder',
  CustomsBroker: '/customs-broker',
  Guest: '/guest',
  EquipmentRentalCompany: '/rental-company',
  MobileRepairProvider: '/repair-provider',
  CargoInsurer: '/cargo-insurer',
  MarketplaceBuyer: '/marketplace-buyer',
  Admin: '/admin',
  SuperAdmin: '/super-admin',
};

export const COMPANY_REQUIRED_ROLES: UserRole[] = [
  'Customer',
  'WarehouseProvider',
  'ServiceProvider',
  'Employer',
  'EmploymentAgency',
  'TruckingCompany',
  'GateStaff',
  'Shipper',
  'DrayageCompany',
  'FreightForwarder',
  'CustomsBroker',
  ...MARKETPLACE_DOMAIN_ROLES,
];

export const COMPANY_TYPE_BY_ROLE: Partial<Record<UserRole, CompanyType>> = {
  Customer: 'Customer',
  WarehouseProvider: 'WarehouseProvider',
  ServiceProvider: 'ServiceProvider',
  Employer: 'Employer',
  EmploymentAgency: 'EmploymentAgency',
  TruckingCompany: 'TruckingCompany',
  GateStaff: 'WarehouseProvider',
  Shipper: 'Shipper',
  DrayageCompany: 'DrayageCompany',
  FreightForwarder: 'FreightForwarder',
  CustomsBroker: 'CustomsBroker',
  EquipmentRentalCompany: 'EquipmentRentalCompany',
  MobileRepairProvider: 'MobileRepairProvider',
  CargoInsurer: 'CargoInsurer',
  MarketplaceBuyer: 'MarketplaceBuyer',
};

const ROUTE_PREFIXES: Record<string, UserRole[]> = {
  customer: ['Customer'],
  'warehouse-provider': ['WarehouseProvider'],
  'service-provider': ['ServiceProvider'],
  employer: ['Employer'],
  agency: ['EmploymentAgency'],
  worker: ['Worker'],
  'trucking-company': ['TruckingCompany'],
  driver: ['Driver'],
  'gate-staff': ['GateStaff'],
  shipper: ['Shipper'],
  'drayage-company': ['DrayageCompany'],
  'freight-forwarder': ['FreightForwarder'],
  'customs-broker': ['CustomsBroker'],
  guest: ['Guest'],
  'rental-company': ['EquipmentRentalCompany'],
  'repair-provider': ['MobileRepairProvider'],
  'cargo-insurer': ['CargoInsurer'],
  'marketplace-buyer': ['MarketplaceBuyer'],
  'sales-agent': ['SalesAgent'],
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
    return ['labour', 'logistics', 'freight', 'drayage', 'marketplace'];
  }
  const domain = DOMAIN_BY_ROLE[user.role];
  const worlds: Domain[] = domain ? [domain] : [];
  // Marketplace is a shared fifth world layered on top of a business's own world.
  if (canAccessMarketplace(user.role) && !worlds.includes('marketplace')) {
    worlds.push('marketplace');
  }
  return worlds;
}

/**
 * Resolves the home route for a world the user just switched into. The marketplace
 * world has its own hub; every other world maps back to the user's role home.
 */
export function getDomainRoute(world: Domain, role: UserRole): string {
  return DOMAIN_HOME_ROUTES[world] ?? getRoleRoute(role);
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
  if (segment === 'marketplace') {
    return 'marketplace';
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
