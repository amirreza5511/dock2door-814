import type { UserRole } from '@/constants/types';

/**
 * Global Freight (Domain 6) shared constants: role classification, freight
 * modes, delivery methods, and document types used across the quote wizard,
 * provider board and admin queue (app + web).
 */

export type FreightRoleKind = 'customer' | 'freight' | 'ground' | 'admin' | 'none';

/** Roles that can create freight quote requests. */
export const FREIGHT_CUSTOMER_ROLES: UserRole[] = ['ImporterExporter', 'Customer', 'Guest'];
/** Roles that can quote the main freight leg. */
export const FREIGHT_PROVIDER_ROLES: UserRole[] = ['GlobalFreightForwarder', 'Carrier', 'FreightForwarder'];
/** Roles that can quote the ground (container pickup / drayage) leg. */
export const FREIGHT_GROUND_ROLES: UserRole[] = ['TruckingCompany', 'DrayageCompany'];

/** Classify a role for the Global Freight hub. */
export function freightRoleKind(role: UserRole | undefined | null): FreightRoleKind {
  if (!role) return 'none';
  if (role === 'Admin' || role === 'SuperAdmin') return 'admin';
  if (FREIGHT_PROVIDER_ROLES.includes(role)) return 'freight';
  if (FREIGHT_GROUND_ROLES.includes(role)) return 'ground';
  if (FREIGHT_CUSTOMER_ROLES.includes(role)) return 'customer';
  return 'none';
}

export type FreightMode = 'air' | 'ocean' | 'truck' | 'fcl' | 'lcl';

export const FREIGHT_MODES: { value: FreightMode; label: string; sublabel: string }[] = [
  { value: 'air', label: 'Air freight', sublabel: 'Fastest — airport to airport' },
  { value: 'ocean', label: 'Ocean freight', sublabel: 'Port to port by sea' },
  { value: 'truck', label: 'Truck / road', sublabel: 'Overland by road' },
  { value: 'fcl', label: 'Full container (FCL/FTL)', sublabel: 'A whole container or truck' },
  { value: 'lcl', label: 'Shared load (LCL)', sublabel: 'Share space, pay per volume' },
];

export const FREIGHT_MODE_LABEL: Record<FreightMode, string> = {
  air: 'Air',
  ocean: 'Ocean',
  truck: 'Truck',
  fcl: 'FCL / FTL',
  lcl: 'LCL',
};

export type DeliveryMethod = 'door_pickup' | 'port_delivery' | 'booking_only';

export const DELIVERY_METHODS: { value: DeliveryMethod; label: string; sublabel: string }[] = [
  { value: 'door_pickup', label: 'Door pickup', sublabel: 'Collect from my warehouse / address' },
  { value: 'port_delivery', label: 'Deliver to port / airport', sublabel: "I'll drop cargo at the terminal" },
  { value: 'booking_only', label: 'Booking only', sublabel: 'Just reserve capacity — no pickup' },
];

export const DELIVERY_METHOD_LABEL: Record<DeliveryMethod, string> = {
  door_pickup: 'Door pickup',
  port_delivery: 'Port / airport delivery',
  booking_only: 'Booking only',
};

export type FreightDocType = 'commercial_invoice' | 'packing_list' | 'bill_of_lading' | 'certificate' | 'other';

export const FREIGHT_DOC_TYPES: { value: FreightDocType; label: string }[] = [
  { value: 'commercial_invoice', label: 'Commercial invoice' },
  { value: 'packing_list', label: 'Packing list' },
  { value: 'bill_of_lading', label: 'Bill of lading' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'other', label: 'Other document' },
];

export type FreightQuoteStatus = 'PendingReview' | 'Open' | 'Quoted' | 'Accepted' | 'Rejected' | 'Cancelled';

export const FREIGHT_STATUS_META: Record<FreightQuoteStatus, { label: string; tone: 'warning' | 'info' | 'success' | 'danger' | 'neutral' }> = {
  PendingReview: { label: 'Pending review', tone: 'warning' },
  Open: { label: 'Open for quotes', tone: 'info' },
  Quoted: { label: 'Quotes received', tone: 'info' },
  Accepted: { label: 'Accepted', tone: 'success' },
  Rejected: { label: 'Rejected', tone: 'danger' },
  Cancelled: { label: 'Cancelled', tone: 'neutral' },
};
