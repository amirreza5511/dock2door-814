/**
 * Carrier (owner-operator / driver) compliance document types.
 *
 * These reuse the existing `worker_certifications` table + `certifications`
 * storage bucket + admin compliance review queue. To keep them distinct from
 * labour-world worker certs, every carrier document type is stored with the
 * `Carrier_` prefix (e.g. `Carrier_Insurance`). The admin Compliance queue
 * reads ALL pending rows regardless of type, so carrier documents flow into
 * the same approve/reject pipeline automatically.
 */

/** Stored `type` value in worker_certifications, without the prefix. */
export type CarrierDocKey =
  | 'DriversLicence'
  | 'Insurance'
  | 'NSC'
  | 'DriverAbstract'
  | 'CriminalRecordCheck'
  | 'VehicleInspection'
  | 'MVI'
  | 'BusinessRegistration';

export const CARRIER_DOC_PREFIX = 'Carrier_' as const;

export interface CarrierDocSpec {
  key: CarrierDocKey;
  label: string;
  short: string;
  /** One-line explanation shown under the document title. */
  desc: string;
  /** Whether this document must be on file to be road-legal on the platform. */
  required: boolean;
  /** Whether an expiry date is expected (drives renewal reminders). */
  hasExpiry: boolean;
  icon: string;
}

/** Full type string stored in the DB (e.g. `Carrier_Insurance`). */
export function carrierDocType(key: CarrierDocKey): string {
  return `${CARRIER_DOC_PREFIX}${key}`;
}

/** True if a worker_certifications row belongs to the carrier compliance set. */
export function isCarrierDocType(type: string): boolean {
  return type.startsWith(CARRIER_DOC_PREFIX);
}

/** Strip the prefix back to a bare key (returns null if not a carrier type). */
export function carrierDocKeyFromType(type: string): CarrierDocKey | null {
  if (!isCarrierDocType(type)) return null;
  return type.slice(CARRIER_DOC_PREFIX.length) as CarrierDocKey;
}

/**
 * Ordered list of every owner-operator document. Mirrors what real carrier
 * onboarding (e.g. onro / standard North-American trucking) collects.
 */
export const CARRIER_DOCS: CarrierDocSpec[] = [
  {
    key: 'DriversLicence',
    label: "Driver's Licence",
    short: 'Licence',
    desc: 'Valid commercial/class licence (front & back).',
    required: true,
    hasExpiry: true,
    icon: '🪪',
  },
  {
    key: 'Insurance',
    label: 'Insurance',
    short: 'Insurance',
    desc: 'Commercial auto & cargo liability certificate.',
    required: true,
    hasExpiry: true,
    icon: '🛡️',
  },
  {
    key: 'NSC',
    label: 'NSC Certificate',
    short: 'NSC',
    desc: 'National Safety Code carrier / safety fitness certificate.',
    required: true,
    hasExpiry: true,
    icon: '📋',
  },
  {
    key: 'DriverAbstract',
    label: 'Driver Abstract',
    short: 'Abstract',
    desc: 'Official driving record / abstract from the licensing authority.',
    required: true,
    hasExpiry: true,
    icon: '📄',
  },
  {
    key: 'CriminalRecordCheck',
    label: 'Criminal Record Check',
    short: 'CRC',
    desc: 'Police-issued criminal record / background check.',
    required: true,
    hasExpiry: true,
    icon: '🔍',
  },
  {
    key: 'VehicleInspection',
    label: 'Truck Inspection (CVIP)',
    short: 'Inspection',
    desc: 'Annual commercial vehicle inspection / safety certificate.',
    required: true,
    hasExpiry: true,
    icon: '🔧',
  },
  {
    key: 'MVI',
    label: 'Motor Vehicle Inspection (MVI)',
    short: 'MVI',
    desc: 'Provincial motor vehicle inspection report.',
    required: true,
    hasExpiry: true,
    icon: '🚛',
  },
  {
    key: 'BusinessRegistration',
    label: 'Business Registration / WCB',
    short: 'Business',
    desc: 'Business registration, GST/HST, or WCB clearance (if applicable).',
    required: false,
    hasExpiry: false,
    icon: '🏢',
  },
];

export const REQUIRED_CARRIER_DOC_COUNT = CARRIER_DOCS.filter((d) => d.required).length;
