export type CompanyRole =
  | 'Owner'
  | 'Manager'
  | 'Supervisor'
  | 'Staff'
  | 'Receiver'
  | 'Picker'
  | 'Packer'
  | 'ShippingClerk'
  | 'InventoryClerk'
  | 'DockStaff'
  | 'ReadOnly';

export const COMPANY_ROLES: readonly CompanyRole[] = [
  'Owner',
  'Manager',
  'Supervisor',
  'Receiver',
  'Picker',
  'Packer',
  'ShippingClerk',
  'InventoryClerk',
  'DockStaff',
  'ReadOnly',
  'Staff',
] as const;

export const ROLE_LABEL: Record<CompanyRole, string> = {
  Owner: 'Owner',
  Manager: 'Manager',
  Supervisor: 'Supervisor',
  Staff: 'Staff (general)',
  Receiver: 'Receiver',
  Picker: 'Picker',
  Packer: 'Packer',
  ShippingClerk: 'Shipping Clerk',
  InventoryClerk: 'Inventory Clerk',
  DockStaff: 'Dock / Gate',
  ReadOnly: 'Read-only',
};

export const ROLE_DESCRIPTION: Record<CompanyRole, string> = {
  Owner: 'Full control. Can manage company, staff, billing, payouts.',
  Manager: 'Run day-to-day operations. Reports, exceptions, all ops screens.',
  Supervisor: 'Monitor fulfillment, override pick/pack, see WMS exceptions.',
  Staff: 'General operational access (no billing, no staff management).',
  Receiver: 'Inbound receiving station. Receive POs, putaway.',
  Picker: 'Pick orders against the wave/queue.',
  Packer: 'Pack picked orders, verify, print packing slips.',
  ShippingClerk: 'Buy and print labels, manifest shipments.',
  InventoryClerk: 'Cycle counts, transfers, adjustments.',
  DockStaff: 'Dock schedule, gate check-in/out, yard moves, POD.',
  ReadOnly: 'View-only access.',
};

export type Permission =
  | 'company.manage'
  | 'staff.manage'
  | 'billing.view'
  | 'payouts.manage'
  | 'listings.manage'
  | 'bookings.view'
  | 'bookings.respond'
  | 'wms.view'
  | 'wms.receive'
  | 'wms.putaway'
  | 'wms.transfer'
  | 'wms.cycleCount'
  | 'wms.adjust'
  | 'orders.view'
  | 'orders.pick'
  | 'orders.pack'
  | 'orders.ship'
  | 'dock.view'
  | 'dock.manage'
  | 'pod.upload'
  | 'reports.view';

const ALL: Permission[] = [
  'company.manage','staff.manage','billing.view','payouts.manage',
  'listings.manage','bookings.view','bookings.respond',
  'wms.view','wms.receive','wms.putaway','wms.transfer','wms.cycleCount','wms.adjust',
  'orders.view','orders.pick','orders.pack','orders.ship',
  'dock.view','dock.manage','pod.upload','reports.view',
];

const PERMS: Record<CompanyRole, Permission[]> = {
  Owner: ALL,
  Manager: ALL.filter((p) => p !== 'company.manage' && p !== 'staff.manage' && p !== 'payouts.manage'),
  Supervisor: [
    'listings.manage','bookings.view','bookings.respond',
    'wms.view','wms.receive','wms.putaway','wms.transfer','wms.cycleCount','wms.adjust',
    'orders.view','orders.pick','orders.pack','orders.ship',
    'dock.view','dock.manage','pod.upload','reports.view',
  ],
  Staff: [
    'bookings.view','wms.view','orders.view','dock.view',
    'wms.receive','orders.pick','orders.pack','orders.ship','pod.upload',
  ],
  Receiver: ['bookings.view','wms.view','wms.receive','wms.putaway','dock.view','pod.upload'],
  Picker: ['orders.view','orders.pick','wms.view'],
  Packer: ['orders.view','orders.pack','wms.view'],
  ShippingClerk: ['orders.view','orders.ship','wms.view','dock.view'],
  InventoryClerk: ['wms.view','wms.transfer','wms.cycleCount','wms.adjust'],
  DockStaff: ['dock.view','dock.manage','pod.upload','bookings.view'],
  ReadOnly: ['bookings.view','wms.view','orders.view','dock.view','reports.view'],
};

export function permissionsFor(role: CompanyRole | string | null | undefined): Permission[] {
  if (!role) return [];
  const r = role as CompanyRole;
  return PERMS[r] ?? [];
}

export function can(role: CompanyRole | string | null | undefined, p: Permission): boolean {
  return permissionsFor(role).includes(p);
}

export function isWarehouseOwnerLike(role: CompanyRole | string | null | undefined): boolean {
  return role === 'Owner' || role === 'Manager';
}
