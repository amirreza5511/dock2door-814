import type { CompanyType, User, UserRole } from '@/constants/types';

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  Customer: '/customer',
  WarehouseProvider: '/warehouse-provider',
  ServiceProvider: '/service-provider',
  Employer: '/employer',
  Worker: '/worker',
  TruckingCompany: '/trucking-company',
  Driver: '/driver',
  GateStaff: '/gate-staff',
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
];

export const COMPANY_TYPE_BY_ROLE: Partial<Record<UserRole, CompanyType>> = {
  Customer: 'Customer',
  WarehouseProvider: 'WarehouseProvider',
  ServiceProvider: 'ServiceProvider',
  Employer: 'Employer',
  TruckingCompany: 'TruckingCompany',
  GateStaff: 'WarehouseProvider',
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
  admin: ['Admin', 'SuperAdmin'],
  'super-admin': ['SuperAdmin'],
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
