import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  Company,
  Dispute,
  Message,
  Payment,
  ServiceJob,
  ServiceListing,
  ShiftPost,
  User,
  WarehouseBooking,
  WarehouseListing,
  WorkerCertification,
} from '@/constants/types';

interface BootstrapData {
  companies: Company[];
  users: User[];
  warehouseListings: WarehouseListing[];
  warehouseBookings: WarehouseBooking[];
  serviceListings: ServiceListing[];
  serviceJobs: ServiceJob[];
  payments: Payment[];
  messages: Message[];
  disputes: Dispute[];
  shiftPosts: ShiftPost[];
  workerCertifications: WorkerCertification[];
}

const EMPTY_DATA: BootstrapData = {
  companies: [],
  users: [],
  warehouseListings: [],
  warehouseBookings: [],
  serviceListings: [],
  serviceJobs: [],
  payments: [],
  messages: [],
  disputes: [],
  shiftPosts: [],
  workerCertifications: [],
};

type Row = Record<string, any>;

function mapCompany(r: Row): Company {
  return {
    id: r.id,
    name: r.name ?? '',
    type: r.type,
    address: r.address ?? '',
    city: r.city ?? '',
    status: r.status ?? 'PendingApproval',
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapUser(r: Row): User {
  return {
    id: r.id,
    email: r.email ?? '',
    password: '',
    name: r.name ?? '',
    role: r.role,
    companyId: r.company_id ?? null,
    status: r.status === 'Suspended' ? 'Suspended' : 'Active',
    emailVerified: Boolean(r.email_verified),
    twoFactorEnabled: Boolean(r.two_factor_enabled),
    profileImage: r.profile_image ?? null,
    lastLoginAt: r.last_login_at ?? null,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapWarehouseListing(r: Row): WarehouseListing {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name ?? '',
    address: r.address ?? '',
    city: r.city ?? '',
    geoLat: Number(r.geo_lat ?? 0),
    geoLng: Number(r.geo_lng ?? 0),
    warehouseType: r.warehouse_type,
    availablePalletCapacity: Number(r.available_pallet_capacity ?? 0),
    minPallets: Number(r.min_pallets ?? 1),
    maxPallets: Number(r.max_pallets ?? 100),
    storageTerm: r.storage_term ?? 'Monthly',
    storageRatePerPallet: Number(r.storage_rate_per_pallet ?? 0),
    inboundHandlingFeePerPallet: Number(r.inbound_handling_fee_per_pallet ?? 0),
    outboundHandlingFeePerPallet: Number(r.outbound_handling_fee_per_pallet ?? 0),
    receivingHours: r.receiving_hours ?? '',
    accessRestrictions: r.access_restrictions ?? '',
    insuranceRequirements: r.insurance_requirements ?? '',
    notes: r.notes ?? '',
    status: r.status ?? 'Draft',
    photos: Array.isArray(r.photos) ? r.photos : [],
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapWarehouseBooking(r: Row): WarehouseBooking {
  return {
    id: r.id,
    listingId: r.listing_id,
    customerCompanyId: r.customer_company_id,
    palletsRequested: Number(r.pallets_requested ?? 0),
    startDate: r.start_date ?? '',
    endDate: r.end_date ?? '',
    handlingRequired: Boolean(r.handling_required),
    customerNotes: r.customer_notes ?? '',
    providerResponseNotes: r.provider_response_notes ?? '',
    proposedPrice: Number(r.proposed_price ?? 0),
    counterOfferPrice: r.counter_offer_price != null ? Number(r.counter_offer_price) : null,
    finalPrice: r.final_price != null ? Number(r.final_price) : null,
    status: r.status ?? 'Requested',
    paymentStatus: r.payment_status ?? 'Pending',
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapServiceListing(r: Row): ServiceListing {
  return {
    id: r.id,
    companyId: r.company_id,
    category: r.category,
    coverageArea: Array.isArray(r.coverage_area) ? r.coverage_area : [],
    hourlyRate: Number(r.hourly_rate ?? 0),
    perJobRate: r.per_job_rate != null ? Number(r.per_job_rate) : null,
    minimumHours: Number(r.minimum_hours ?? 1),
    certifications: r.certifications ?? '',
    status: r.status ?? 'Draft',
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapServiceJob(r: Row): ServiceJob {
  return {
    id: r.id,
    serviceId: r.service_id,
    customerCompanyId: r.customer_company_id,
    locationAddress: r.location_address ?? '',
    locationCity: r.location_city ?? '',
    dateTimeStart: r.date_time_start ?? '',
    durationHours: Number(r.duration_hours ?? 1),
    notes: r.notes ?? '',
    totalPrice: Number(r.total_price ?? 0),
    status: r.status ?? 'Requested',
    paymentStatus: r.payment_status ?? 'Pending',
    checkInTs: r.check_in_ts ?? null,
    checkOutTs: r.check_out_ts ?? null,
    customerConfirmed: Boolean(r.customer_confirmed),
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapPayment(r: Row): Payment {
  return {
    id: r.id,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    grossAmount: Number(r.gross_amount ?? 0),
    commissionAmount: Number(r.commission_amount ?? 0),
    netAmount: Number(r.net_amount ?? 0),
    status: r.status ?? 'Pending',
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapMessage(r: Row): Message {
  return {
    id: r.id,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    senderUserId: r.sender_user_id,
    text: r.text ?? '',
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapDispute(r: Row): Dispute {
  return {
    id: r.id,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    openedByUserId: r.opened_by_user_id,
    description: r.description ?? '',
    status: r.status ?? 'Open',
    outcome: r.outcome ?? null,
    adminNotes: r.admin_notes ?? '',
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapShiftPost(r: Row): ShiftPost {
  return {
    id: r.id,
    employerCompanyId: r.employer_company_id,
    title: r.title ?? '',
    category: r.category,
    locationAddress: r.location_address ?? '',
    locationCity: r.location_city ?? '',
    date: r.date ?? '',
    startTime: r.start_time ?? '',
    endTime: r.end_time ?? '',
    hourlyRate: r.hourly_rate != null ? Number(r.hourly_rate) : null,
    flatRate: r.flat_rate != null ? Number(r.flat_rate) : null,
    minimumHours: Number(r.minimum_hours ?? 1),
    workersNeeded: Number(r.workers_needed ?? 1),
    requirements: r.requirements ?? '',
    notes: r.notes ?? '',
    status: r.status ?? 'Draft',
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapWorkerCert(r: Row): WorkerCertification {
  return {
    id: r.id,
    workerUserId: r.worker_user_id,
    type: r.type,
    expiryDate: r.expiry_date ?? '',
    certificateFile: r.certificate_file ?? '',
    filePath: r.file_path ?? '',
    status: (r.status as WorkerCertification['status']) ?? 'Pending',
    notes: r.notes ?? '',
    reviewedAt: r.reviewed_at ?? null,
    reviewedBy: r.reviewed_by ?? null,
    adminApproved: Boolean(r.admin_approved),
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

async function fetchBootstrap(): Promise<BootstrapData> {
  console.log('[bootstrap] fetching from Supabase');
  const [
    companiesRes,
    profilesRes,
    whListRes,
    whBookRes,
    svcListRes,
    svcJobRes,
    paymentsRes,
    messagesRes,
    disputesRes,
    shiftsRes,
    certsRes,
  ] = await Promise.all([
    supabase.from('companies').select('*'),
    supabase.from('profiles').select('*'),
    supabase.from('warehouse_listings').select('*'),
    supabase.from('warehouse_bookings').select('*'),
    supabase.from('service_listings').select('*'),
    supabase.from('service_jobs').select('*'),
    supabase.from('payments').select('*'),
    supabase.from('messages').select('*'),
    supabase.from('disputes').select('*'),
    supabase.from('shift_posts').select('*'),
    supabase.from('worker_certifications').select('*'),
  ]);

  const firstError =
    companiesRes.error ||
    profilesRes.error ||
    whListRes.error ||
    whBookRes.error ||
    svcListRes.error ||
    svcJobRes.error ||
    paymentsRes.error ||
    messagesRes.error ||
    disputesRes.error ||
    shiftsRes.error ||
    certsRes.error;

  if (firstError) {
    console.log('[bootstrap] supabase error', firstError.message);
  }

  return {
    companies: (companiesRes.data ?? []).map(mapCompany),
    users: (profilesRes.data ?? []).map(mapUser),
    warehouseListings: (whListRes.data ?? []).map(mapWarehouseListing),
    warehouseBookings: (whBookRes.data ?? []).map(mapWarehouseBooking),
    serviceListings: (svcListRes.data ?? []).map(mapServiceListing),
    serviceJobs: (svcJobRes.data ?? []).map(mapServiceJob),
    payments: (paymentsRes.data ?? []).map(mapPayment),
    messages: (messagesRes.data ?? []).map(mapMessage),
    disputes: (disputesRes.data ?? []).map(mapDispute),
    shiftPosts: (shiftsRes.data ?? []).map(mapShiftPost),
    workerCertifications: (certsRes.data ?? []).map(mapWorkerCert),
  };
}

export function useDockBootstrapData() {
  const query = useQuery({
    queryKey: ['dock', 'bootstrap'],
    queryFn: fetchBootstrap,
    staleTime: 30_000,
  });

  const data = useMemo<BootstrapData>(() => query.data ?? EMPTY_DATA, [query.data]);

  return {
    ...query,
    data,
  };
}
