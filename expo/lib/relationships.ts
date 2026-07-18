import type { UserRole } from '@/constants/types';
import { DOMAIN_BY_ROLE, type Domain } from '@/lib/access';

/**
 * Single source of truth for how the platform's roles relate to each other.
 *
 * This drives three things and MUST stay in sync with the web mirror
 * (`apps/web/lib/relationships.ts`) and the backend
 * (`supabase/migrations/0129_role_relationships.sql`):
 *   1. Which extra roles a business may add to itself (ADDABLE_ROLES).
 *   2. Which roles can work together — powers the Partners directory and
 *      keeps unrelated areas out of a role's view (WORKS_WITH).
 *   3. Which accounts are businesses (can add roles / have partners) vs.
 *      individuals that stay single-purpose (BUSINESS_ROLES / INDIVIDUAL_ROLES).
 */

/** Roles that represent a company. They can add compatible roles and use Partners. */
export const BUSINESS_ROLES: UserRole[] = [
  'Customer',
  'WarehouseProvider',
  'ServiceProvider',
  'Employer',
  'EmploymentAgency',
  'TruckingCompany',
  'Shipper',
  'FreightForwarder',
  'DrayageCompany',
  'CustomsBroker',
];

/** Individual accounts — single-purpose. They never add roles or browse unrelated areas. */
export const INDIVIDUAL_ROLES: UserRole[] = ['Worker', 'Driver', 'GateStaff', 'SalesAgent', 'Guest'];

/**
 * Who can work together. Symmetric in intent (if A works with B, B works with A),
 * but declared per-role so the directory can filter precisely.
 */
export const WORKS_WITH: Partial<Record<UserRole, UserRole[]>> = {
  Employer: ['Worker', 'Customer', 'WarehouseProvider', 'ServiceProvider', 'EmploymentAgency'],
  EmploymentAgency: ['Worker', 'Employer', 'WarehouseProvider', 'ServiceProvider'],
  Customer: ['WarehouseProvider', 'ServiceProvider', 'Shipper', 'FreightForwarder', 'Employer', 'TruckingCompany', 'CustomsBroker'],
  WarehouseProvider: ['Customer', 'ServiceProvider', 'TruckingCompany', 'Employer'],
  ServiceProvider: ['Customer', 'WarehouseProvider'],
  Shipper: ['TruckingCompany', 'Customer', 'FreightForwarder', 'CustomsBroker'],
  TruckingCompany: ['Shipper', 'Customer', 'WarehouseProvider', 'DrayageCompany'],
  FreightForwarder: ['DrayageCompany', 'Customer', 'Shipper', 'CustomsBroker'],
  DrayageCompany: ['FreightForwarder', 'TruckingCompany', 'Customer', 'CustomsBroker'],
  CustomsBroker: ['FreightForwarder', 'DrayageCompany', 'Customer', 'Shipper'],
  Worker: ['Employer', 'EmploymentAgency'],
};

/**
 * Which extra roles a business may add to itself. Only sensible combinations —
 * everything else is blocked. Individuals are intentionally absent.
 */
export const ADDABLE_ROLES: Partial<Record<UserRole, UserRole[]>> = {
  Customer: ['Employer', 'Shipper', 'FreightForwarder'],
  WarehouseProvider: ['Customer', 'Employer', 'ServiceProvider'],
  ServiceProvider: ['Customer', 'Employer'],
  Employer: ['Customer', 'WarehouseProvider'],
  TruckingCompany: ['Customer', 'Shipper', 'DrayageCompany'],
  Shipper: ['Customer', 'FreightForwarder'],
  DrayageCompany: ['Customer', 'TruckingCompany', 'FreightForwarder'],
  FreightForwarder: ['Customer', 'DrayageCompany', 'CustomsBroker'],
  CustomsBroker: ['Customer', 'FreightForwarder'],
};

/** Human-friendly labels for every role. */
export const ROLE_LABEL: Record<UserRole, string> = {
  Customer: 'Customer',
  WarehouseProvider: 'Warehouse Provider',
  ServiceProvider: 'Service Provider',
  Employer: 'Employer',
  EmploymentAgency: 'Employment Agency',
  Worker: 'Worker',
  TruckingCompany: 'Trucking Company',
  Driver: 'Driver',
  GateStaff: 'Gate Staff',
  Shipper: 'Shipper',
  DrayageCompany: 'Drayage Company',
  FreightForwarder: 'Freight Forwarder',
  CustomsBroker: 'Customs Broker',
  Guest: 'Guest',
  EquipmentRentalCompany: 'Equipment / Crane Rental',
  MobileRepairProvider: 'Mobile Repair & Services',
  CargoInsurer: 'Cargo Insurer',
  MarketplaceBuyer: 'Marketplace Buyer',
  SalesAgent: 'Sales Agent',
  Admin: 'Admin',
  SuperAdmin: 'Super Admin',
};

/** Short blurb describing what a role does — used on the add-role cards. */
export const ROLE_BLURB: Partial<Record<UserRole, string>> = {
  Customer: 'Find warehouse space, book storage, manage inventory and shipping.',
  WarehouseProvider: 'List warehouse space, manage bookings and fulfillment.',
  ServiceProvider: 'Offer labour, forklift, rework and other logistics services.',
  Employer: 'Post shifts, hire workers, manage assignments and payroll.',
  EmploymentAgency: 'Bring your own workers and clients — book shifts, coordinate and invoice through Dock2Door.',
  TruckingCompany: 'Run a fleet, dispatch loads and manage dock appointments.',
  Shipper: 'Post deliveries and hire carriers to move freight.',
  FreightForwarder: 'Post container drayage orders to move import/export freight.',
  DrayageCompany: 'Run container drayage — pull, deliver and return containers.',
  CustomsBroker: 'Receive clearance requests & documents, quote and clear shipments through customs.',
  Guest: 'Use any Dock2Door service pay-as-you-go — prepaid, with a guest surcharge, no business account needed.',
};

/** Maps every business role to its `company_type` value. */
export const COMPANY_TYPE_FOR_ROLE: Partial<Record<UserRole, string>> = {
  Customer: 'Customer',
  WarehouseProvider: 'WarehouseProvider',
  ServiceProvider: 'ServiceProvider',
  Employer: 'Employer',
  EmploymentAgency: 'EmploymentAgency',
  TruckingCompany: 'TruckingCompany',
  Shipper: 'Shipper',
  FreightForwarder: 'FreightForwarder',
  DrayageCompany: 'DrayageCompany',
  CustomsBroker: 'CustomsBroker',
};

export function isBusinessRole(role: UserRole | string | null | undefined): boolean {
  return !!role && BUSINESS_ROLES.includes(role as UserRole);
}

export function isIndividualRole(role: UserRole | string | null | undefined): boolean {
  return !!role && INDIVIDUAL_ROLES.includes(role as UserRole);
}

/** Roles this role can work with (partners). */
export function worksWith(role: UserRole | string | null | undefined): UserRole[] {
  if (!role) return [];
  return WORKS_WITH[role as UserRole] ?? [];
}

/** Extra roles this business may add to itself, excluding ones it already holds. */
export function addableRolesFor(
  role: UserRole | string | null | undefined,
  alreadyHeld: UserRole[] = [],
): UserRole[] {
  if (!role) return [];
  const held = new Set<UserRole>([role as UserRole, ...alreadyHeld]);
  return (ADDABLE_ROLES[role as UserRole] ?? []).filter((r) => !held.has(r));
}

/** True when a business of role `a` is allowed to add role `b`. */
export function canAddRole(a: UserRole | string, b: UserRole): boolean {
  return (ADDABLE_ROLES[a as UserRole] ?? []).includes(b);
}

/** True when two roles are compatible to work together (either direction). */
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

/** The world/domain a role belongs to — reused for partner-card colours. */
export function domainForRole(role: UserRole | string | null | undefined): Domain | null {
  if (!role) return null;
  return DOMAIN_BY_ROLE[role as UserRole] ?? null;
}
