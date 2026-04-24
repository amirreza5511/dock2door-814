export type UserRole = 'Customer' | 'WarehouseProvider' | 'ServiceProvider' | 'Employer' | 'Worker' | 'TruckingCompany' | 'Driver' | 'GateStaff' | 'Admin' | 'SuperAdmin';
export type CompanyType = 'Customer' | 'WarehouseProvider' | 'ServiceProvider' | 'Employer' | 'TruckingCompany';
export type AppRouteRole = Exclude<UserRole, 'SuperAdmin'> | 'SuperAdmin';
export type CompanyStatus = 'PendingApproval' | 'Approved' | 'Suspended';
export type CompanyRole = 'Owner' | 'Staff';

export type WarehouseType = 'Dry' | 'Chill' | 'Frozen';
export type StorageTerm = 'Daily' | 'Weekly' | 'Monthly';
export type ListingStatus = 'Draft' | 'PendingApproval' | 'Available' | 'Active' | 'Hidden' | 'Suspended';
export type BookingStatus = 'Requested' | 'Accepted' | 'CounterOffered' | 'Confirmed' | 'InProgress' | 'Completed' | 'Cancelled';
export type PaymentStatus = 'Pending' | 'Paid' | 'Refunded';

export type ServiceCategory = 'Labour' | 'Forklift' | 'PalletRework' | 'Devanning' | 'LocalTruck' | 'IndustrialCleaning';
export type JobStatus = 'Requested' | 'Accepted' | 'Scheduled' | 'InProgress' | 'Completed' | 'Cancelled';

export type ShiftCategory = 'General' | 'Driver' | 'Forklift' | 'HighReach';
export type ShiftStatus = 'Draft' | 'Posted' | 'Filled' | 'InProgress' | 'Completed' | 'Cancelled';
export type ApplicationStatus = 'Applied' | 'Accepted' | 'Rejected' | 'Withdrawn';
export type AssignmentStatus = 'Scheduled' | 'InProgress' | 'Completed' | 'NoShow' | 'Cancelled' | 'Disputed';

export type DisputeStatus = 'Open' | 'UnderReview' | 'Resolved';
export type DisputeOutcome = 'Refund' | 'PartialRefund' | 'Denied' | 'Other' | null;
export type ReviewType = 'WarehouseListing' | 'ServiceProviderCompany' | 'Worker' | 'EmployerCompany';
export type ReferenceType = 'WarehouseBooking' | 'ServiceJob' | 'ShiftAssignment';

export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  companyId: string | null;
  status: 'Active' | 'Suspended';
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  profileImage?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  isPlatformAdmin?: boolean;
}

export interface Company {
  id: string;
  name: string;
  type: CompanyType;
  address: string;
  city: string;
  status: CompanyStatus;
  createdAt: string;
}

export interface CompanyUser {
  id: string;
  companyId: string;
  userId: string;
  companyRole: CompanyRole;
  status: 'Active' | 'Inactive';
}

export interface PlatformSettings {
  id: string;
  warehouseCommissionPercentage: number;
  serviceCommissionPercentage: number;
  labourCommissionPercentage: number;
  handlingFeePerPalletDefault: number;
  taxMode: string;
  updatedAt: string;
  updatedBy: string;
}

export interface WarehouseListing {
  id: string;
  companyId: string;
  name: string;
  address: string;
  city: string;
  geoLat: number;
  geoLng: number;
  warehouseType: WarehouseType;
  availablePalletCapacity: number;
  minPallets: number;
  maxPallets: number;
  storageTerm: StorageTerm;
  storageRatePerPallet: number;
  inboundHandlingFeePerPallet: number;
  outboundHandlingFeePerPallet: number;
  receivingHours: string;
  accessRestrictions: string;
  insuranceRequirements: string;
  notes: string;
  status: ListingStatus;
  photos: string[];
  createdAt: string;
}

export interface WarehouseAvailability {
  id: string;
  listingId: string;
  dateFrom: string;
  dateTo: string;
  availablePallets: number;
}

export interface WarehouseBooking {
  id: string;
  listingId: string;
  customerCompanyId: string;
  palletsRequested: number;
  startDate: string;
  endDate: string;
  handlingRequired: boolean;
  customerNotes: string;
  providerResponseNotes: string;
  proposedPrice: number;
  counterOfferPrice: number | null;
  finalPrice: number | null;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
}

export interface ServiceListing {
  id: string;
  companyId: string;
  category: ServiceCategory;
  coverageArea: string[];
  hourlyRate: number;
  perJobRate: number | null;
  minimumHours: number;
  certifications: string;
  status: ListingStatus;
  createdAt: string;
}

export interface ServiceAvailability {
  id: string;
  serviceId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface ServiceJob {
  id: string;
  serviceId: string;
  customerCompanyId: string;
  locationAddress: string;
  locationCity: string;
  dateTimeStart: string;
  durationHours: number;
  notes: string;
  totalPrice: number;
  status: JobStatus;
  paymentStatus: PaymentStatus;
  checkInTs: string | null;
  checkOutTs: string | null;
  customerConfirmed: boolean;
  createdAt: string;
}

export interface WorkerProfile {
  id: string;
  userId: string;
  displayName: string;
  skills: ShiftCategory[];
  coverageCities: string[];
  hourlyExpectation: number;
  verified: boolean;
  status: 'Active' | 'Suspended';
  bio: string;
  createdAt: string;
}

export type CertificationStatus = 'Pending' | 'Approved' | 'Rejected' | 'Expired';

export interface WorkerCertification {
  id: string;
  workerUserId: string;
  type: 'Forklift' | 'HighReach';
  expiryDate: string;
  certificateFile: string;
  filePath: string;
  status: CertificationStatus;
  notes: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  adminApproved: boolean;
  createdAt: string;
}

export interface ShiftPost {
  id: string;
  employerCompanyId: string;
  title: string;
  category: ShiftCategory;
  locationAddress: string;
  locationCity: string;
  date: string;
  startTime: string;
  endTime: string;
  hourlyRate: number | null;
  flatRate: number | null;
  minimumHours: number;
  workersNeeded: number;
  requirements: string;
  notes: string;
  status: ShiftStatus;
  createdAt: string;
}

export interface ShiftApplication {
  id: string;
  shiftId: string;
  workerUserId: string;
  status: ApplicationStatus;
  appliedAt: string;
}

export interface ShiftAssignment {
  id: string;
  shiftId: string;
  workerUserId: string;
  confirmedRate: number;
  status: AssignmentStatus;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  assignmentId: string;
  startTimestamp: string | null;
  endTimestamp: string | null;
  employerConfirmedHours: number | null;
  employerNotes: string;
}

export interface Payment {
  id: string;
  referenceType: ReferenceType;
  referenceId: string;
  grossAmount: number;
  commissionAmount: number;
  netAmount: number;
  status: PaymentStatus;
  createdAt: string;
}

export interface Invoice {
  id: string;
  paymentId: string;
  invoiceNumber: string;
  createdAt: string;
}

export interface Review {
  id: string;
  type: ReviewType;
  reviewerUserId: string;
  targetId: string;
  rating: number;
  comment: string;
  relatedReferenceType: ReferenceType;
  relatedReferenceId: string;
  createdAt: string;
}

export interface Dispute {
  id: string;
  referenceType: ReferenceType;
  referenceId: string;
  openedByUserId: string;
  description: string;
  status: DisputeStatus;
  outcome: DisputeOutcome;
  adminNotes: string;
  createdAt: string;
}

export interface Message {
  id: string;
  referenceType: ReferenceType;
  referenceId: string;
  senderUserId: string;
  text: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  kind: 'booking' | 'service' | 'shift' | 'system' | 'dispute';
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  action: string;
  entity: string;
  entityId: string;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
}
