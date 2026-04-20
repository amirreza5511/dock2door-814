import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import type {
  ApplicationStatus,
  AssignmentStatus,
  AuditLog,
  BookingStatus,
  Company,
  CompanyStatus,
  CompanyUser,
  Dispute,
  DisputeOutcome,
  DisputeStatus,
  JobStatus,
  Message,
  NotificationItem,
  Payment,
  PlatformSettings,
  Review,
  ServiceJob,
  ServiceListing,
  ShiftApplication,
  ShiftAssignment,
  ShiftPost,
  ShiftStatus,
  TimeEntry,
  User,
  WarehouseBooking,
  WarehouseListing,
  WorkerCertification,
  WorkerProfile,
} from '@/constants/types';

type RemoteTable =
  | 'companies'
  | 'company_members'
  | 'warehouse_listings'
  | 'service_listings'
  | 'service_jobs'
  | 'bookings'
  | 'messages'
  | 'notifications'
  | 'payments'
  | 'reviews'
  | 'disputes'
  | 'audit_logs'
  | 'platform_settings'
  | 'worker_profiles'
  | 'worker_certifications'
  | 'shift_posts'
  | 'shift_applications'
  | 'shift_assignments'
  | 'time_entries'
  | 'dock_appointments'
  | 'drivers'
  | 'trucks'
  | 'trailers'
  | 'containers';

export interface DockDataState {
  users: User[];
  companies: Company[];
  companyUsers: CompanyUser[];
  platformSettings: PlatformSettings;
  warehouseListings: WarehouseListing[];
  warehouseBookings: WarehouseBooking[];
  serviceListings: ServiceListing[];
  serviceJobs: ServiceJob[];
  workerProfiles: WorkerProfile[];
  workerCertifications: WorkerCertification[];
  shiftPosts: ShiftPost[];
  shiftApplications: ShiftApplication[];
  shiftAssignments: ShiftAssignment[];
  timeEntries: TimeEntry[];
  payments: Payment[];
  reviews: Review[];
  disputes: Dispute[];
  messages: Message[];
  notifications: NotificationItem[];
  auditLogs: AuditLog[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  updateUser: (id: string, user: Partial<User>) => Promise<void>;
  suspendUser: (id: string) => Promise<void>;
  updateCompany: (id: string, company: Partial<Company>) => Promise<void>;
  setCompanyStatus: (id: string, status: CompanyStatus) => Promise<void>;
  updatePlatformSettings: (settings: Partial<PlatformSettings>) => Promise<void>;
  addWarehouseListing: (listing: WarehouseListing) => Promise<void>;
  updateWarehouseListing: (id: string, listing: Partial<WarehouseListing>) => Promise<void>;
  setWarehouseListingStatus: (id: string, status: string) => Promise<void>;
  addWarehouseBooking: (booking: WarehouseBooking) => Promise<void>;
  updateWarehouseBooking: (id: string, booking: Partial<WarehouseBooking>) => Promise<void>;
  setWarehouseBookingStatus: (id: string, status: BookingStatus) => Promise<void>;
  addServiceListing: (listing: ServiceListing) => Promise<void>;
  updateServiceListing: (id: string, listing: Partial<ServiceListing>) => Promise<void>;
  addServiceJob: (job: ServiceJob) => Promise<void>;
  updateServiceJob: (id: string, job: Partial<ServiceJob>) => Promise<void>;
  setServiceJobStatus: (id: string, status: JobStatus) => Promise<void>;
  updateWorkerProfile: (id: string, profile: Partial<WorkerProfile>) => Promise<void>;
  addWorkerCertification: (certification: WorkerCertification) => Promise<void>;
  approveWorkerCert: (id: string) => Promise<void>;
  addShiftPost: (shift: ShiftPost) => Promise<void>;
  updateShiftPost: (id: string, shift: Partial<ShiftPost>) => Promise<void>;
  setShiftStatus: (id: string, status: ShiftStatus) => Promise<void>;
  addShiftApplication: (application: ShiftApplication) => Promise<void>;
  setApplicationStatus: (id: string, status: ApplicationStatus) => Promise<void>;
  addShiftAssignment: (assignment: ShiftAssignment) => Promise<void>;
  setAssignmentStatus: (id: string, status: AssignmentStatus) => Promise<void>;
  addTimeEntry: (timeEntry: TimeEntry) => Promise<void>;
  updateTimeEntry: (id: string, timeEntry: Partial<TimeEntry>) => Promise<void>;
  addPayment: (payment: Payment) => Promise<void>;
  addReview: (review: Review) => Promise<void>;
  addDispute: (dispute: Dispute) => Promise<void>;
  updateDispute: (id: string, dispute: Partial<Dispute>) => Promise<void>;
  resolveDispute: (id: string, outcome: DisputeOutcome, adminNotes: string) => Promise<void>;
  setDisputeStatus: (id: string, status: DisputeStatus) => Promise<void>;
  addMessage: (message: Message) => Promise<void>;
  addNotification: (notification: NotificationItem) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  addAuditLog: (log: Omit<AuditLog, 'id' | 'createdAt'> & Partial<Pick<AuditLog, 'id' | 'createdAt'>>) => Promise<void>;
}

const EMPTY_PLATFORM_SETTINGS: PlatformSettings = {
  id: 'platform-default',
  warehouseCommissionPercentage: 8,
  serviceCommissionPercentage: 20,
  labourCommissionPercentage: 15,
  handlingFeePerPalletDefault: 0,
  taxMode: 'exclusive',
  updatedAt: new Date(0).toISOString(),
  updatedBy: 'system',
};

const EMPTY_DATA: Omit<DockDataState, keyof DockDataState & ('isLoading' | 'isFetching' | 'isError' | 'refetch' | 'updateUser' | 'suspendUser' | 'updateCompany' | 'setCompanyStatus' | 'updatePlatformSettings' | 'addWarehouseListing' | 'updateWarehouseListing' | 'setWarehouseListingStatus' | 'addWarehouseBooking' | 'updateWarehouseBooking' | 'setWarehouseBookingStatus' | 'addServiceListing' | 'updateServiceListing' | 'addServiceJob' | 'updateServiceJob' | 'setServiceJobStatus' | 'updateWorkerProfile' | 'addWorkerCertification' | 'approveWorkerCert' | 'addShiftPost' | 'updateShiftPost' | 'setShiftStatus' | 'addShiftApplication' | 'setApplicationStatus' | 'addShiftAssignment' | 'setAssignmentStatus' | 'addTimeEntry' | 'updateTimeEntry' | 'addPayment' | 'addReview' | 'addDispute' | 'updateDispute' | 'resolveDispute' | 'setDisputeStatus' | 'addMessage' | 'addNotification' | 'markNotificationRead' | 'addAuditLog')> = {
  users: [],
  companies: [],
  companyUsers: [],
  platformSettings: EMPTY_PLATFORM_SETTINGS,
  warehouseListings: [],
  warehouseBookings: [],
  serviceListings: [],
  serviceJobs: [],
  workerProfiles: [],
  workerCertifications: [],
  shiftPosts: [],
  shiftApplications: [],
  shiftAssignments: [],
  timeEntries: [],
  payments: [],
  reviews: [],
  disputes: [],
  messages: [],
  notifications: [],
  auditLogs: [],
};

function useBootstrapState() {
  const query = trpc.dock.bootstrap.useQuery();

  return useMemo(() => {
    const payload = (query.data ?? {}) as Partial<typeof EMPTY_DATA>;

    return {
      users: payload.users ?? [],
      companies: payload.companies ?? [],
      companyUsers: payload.companyUsers ?? [],
      platformSettings: payload.platformSettings ?? EMPTY_PLATFORM_SETTINGS,
      warehouseListings: payload.warehouseListings ?? [],
      warehouseBookings: payload.warehouseBookings ?? [],
      serviceListings: payload.serviceListings ?? [],
      serviceJobs: payload.serviceJobs ?? [],
      workerProfiles: payload.workerProfiles ?? [],
      workerCertifications: payload.workerCertifications ?? [],
      shiftPosts: payload.shiftPosts ?? [],
      shiftApplications: payload.shiftApplications ?? [],
      shiftAssignments: payload.shiftAssignments ?? [],
      timeEntries: payload.timeEntries ?? [],
      payments: payload.payments ?? [],
      reviews: payload.reviews ?? [],
      disputes: payload.disputes ?? [],
      messages: payload.messages ?? [],
      notifications: payload.notifications ?? [],
      auditLogs: payload.auditLogs ?? [],
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      isError: query.isError,
      refetch: query.refetch,
    };
  }, [query.data, query.isError, query.isFetching, query.isLoading, query.refetch]);
}

export function useDockData(): DockDataState {
  const queryClient = useQueryClient();
  const state = useBootstrapState();

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [['dock', 'bootstrap'], { type: 'query' }] });
  }, [queryClient]);

  const createRecordMutation = trpc.dock.createRecord.useMutation({ onSuccess: () => void invalidate() });
  const updateRecordMutation = trpc.dock.updateRecord.useMutation({ onSuccess: () => void invalidate() });
  const updateCompanyMutation = trpc.dock.updateCompany.useMutation({ onSuccess: () => void invalidate() });
  const updateUserMutation = trpc.dock.updateUser.useMutation({ onSuccess: () => void invalidate() });

  const createRecord = useCallback(async (table: RemoteTable, payload: Record<string, unknown>) => {
    await createRecordMutation.mutateAsync({ table, payload });
  }, [createRecordMutation]);

  const updateRecord = useCallback(async (table: RemoteTable, id: string, payload: Record<string, unknown>) => {
    await updateRecordMutation.mutateAsync({ table, id, payload });
  }, [updateRecordMutation]);

  return {
    ...state,
    updateUser: async (id, user) => {
      await updateUserMutation.mutateAsync({
        id,
        payload: {
          name: user.name,
          role: user.role,
          status: user.status,
          profileImage: user.profileImage ?? null,
        },
      });
    },
    suspendUser: async (id) => {
      await updateUserMutation.mutateAsync({ id, payload: { status: 'Suspended' } });
    },
    updateCompany: async (id, company) => {
      await updateCompanyMutation.mutateAsync({
        id,
        payload: {
          name: company.name,
          address: company.address,
          city: company.city,
          status: company.status,
        },
      });
    },
    setCompanyStatus: async (id, status) => {
      await updateCompanyMutation.mutateAsync({ id, payload: { status } });
    },
    updatePlatformSettings: async (settings) => {
      const id = state.platformSettings.id || `platform-${Date.now()}`;
      const payload = {
        ...state.platformSettings,
        ...settings,
        id,
        updatedAt: new Date().toISOString(),
      };

      if (state.platformSettings.id) {
        await updateRecord('platform_settings', id, payload as Record<string, unknown>);
        return;
      }

      await createRecord('platform_settings', payload as Record<string, unknown>);
    },
    addWarehouseListing: async (listing) => {
      await createRecord('warehouse_listings', listing as unknown as Record<string, unknown>);
    },
    updateWarehouseListing: async (id, listing) => {
      await updateRecord('warehouse_listings', id, listing as unknown as Record<string, unknown>);
    },
    setWarehouseListingStatus: async (id, status) => {
      await updateRecord('warehouse_listings', id, { status });
    },
    addWarehouseBooking: async (booking) => {
      await createRecord('bookings', { ...booking, bookingType: 'Warehouse' } as Record<string, unknown>);
    },
    updateWarehouseBooking: async (id, booking) => {
      await updateRecord('bookings', id, booking as unknown as Record<string, unknown>);
    },
    setWarehouseBookingStatus: async (id, status) => {
      await updateRecord('bookings', id, { status });
    },
    addServiceListing: async (listing) => {
      await createRecord('service_listings', listing as unknown as Record<string, unknown>);
    },
    updateServiceListing: async (id, listing) => {
      await updateRecord('service_listings', id, listing as unknown as Record<string, unknown>);
    },
    addServiceJob: async (job) => {
      await createRecord('service_jobs', job as unknown as Record<string, unknown>);
    },
    updateServiceJob: async (id, job) => {
      await updateRecord('service_jobs', id, job as unknown as Record<string, unknown>);
    },
    setServiceJobStatus: async (id, status) => {
      await updateRecord('service_jobs', id, { status });
    },
    updateWorkerProfile: async (id, profile) => {
      await updateRecord('worker_profiles', id, profile as unknown as Record<string, unknown>);
    },
    addWorkerCertification: async (certification) => {
      await createRecord('worker_certifications', certification as unknown as Record<string, unknown>);
    },
    approveWorkerCert: async (id) => {
      await updateRecord('worker_certifications', id, { adminApproved: true });
    },
    addShiftPost: async (shift) => {
      await createRecord('shift_posts', shift as unknown as Record<string, unknown>);
    },
    updateShiftPost: async (id, shift) => {
      await updateRecord('shift_posts', id, shift as unknown as Record<string, unknown>);
    },
    setShiftStatus: async (id, status) => {
      await updateRecord('shift_posts', id, { status });
    },
    addShiftApplication: async (application) => {
      await createRecord('shift_applications', application as unknown as Record<string, unknown>);
    },
    setApplicationStatus: async (id, status) => {
      await updateRecord('shift_applications', id, { status });
    },
    addShiftAssignment: async (assignment) => {
      await createRecord('shift_assignments', assignment as unknown as Record<string, unknown>);
    },
    setAssignmentStatus: async (id, status) => {
      await updateRecord('shift_assignments', id, { status });
    },
    addTimeEntry: async (timeEntry) => {
      await createRecord('time_entries', timeEntry as unknown as Record<string, unknown>);
    },
    updateTimeEntry: async (id, timeEntry) => {
      await updateRecord('time_entries', id, timeEntry as unknown as Record<string, unknown>);
    },
    addPayment: async (payment) => {
      await createRecord('payments', payment as unknown as Record<string, unknown>);
    },
    addReview: async (review) => {
      await createRecord('reviews', review as unknown as Record<string, unknown>);
    },
    addDispute: async (dispute) => {
      await createRecord('disputes', dispute as unknown as Record<string, unknown>);
    },
    updateDispute: async (id, dispute) => {
      await updateRecord('disputes', id, dispute as unknown as Record<string, unknown>);
    },
    resolveDispute: async (id, outcome, adminNotes) => {
      await updateRecord('disputes', id, { status: 'Resolved', outcome, adminNotes });
    },
    setDisputeStatus: async (id, status) => {
      await updateRecord('disputes', id, { status });
    },
    addMessage: async (message) => {
      await createRecord('messages', message as unknown as Record<string, unknown>);
    },
    addNotification: async (notification) => {
      await createRecord('notifications', notification as unknown as Record<string, unknown>);
    },
    markNotificationRead: async (id) => {
      await updateRecord('notifications', id, { read: true });
    },
    addAuditLog: async (log) => {
      const nextLog: AuditLog = {
        id: log.id ?? `audit-${Date.now()}`,
        actorUserId: log.actorUserId,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        previousValue: log.previousValue ?? null,
        newValue: log.newValue ?? null,
        createdAt: log.createdAt ?? new Date().toISOString(),
      };
      await createRecord('audit_logs', nextLog as unknown as Record<string, unknown>);
    },
  };
}
