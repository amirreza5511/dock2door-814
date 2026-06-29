/**
 * Supabase-backed "tRPC" shim.
 *
 * The screens in this app were originally written against a tRPC client
 * (`trpc.X.Y.useQuery(...)`, `trpc.X.Y.useMutation(...)`, `trpc.useUtils().X.Y.invalidate()`).
 * We dropped the Hono/tRPC backend and moved to Supabase only, but rather than
 * rewriting 32 screens this shim preserves that exact surface by dispatching
 * every call to Supabase through React Query.
 *
 * Each procedure is keyed as "router.procedure" inside PROCEDURES below.
 * useQuery  -> React Query useQuery keyed on ["trpc", router, proc, input]
 * useMutation -> React Query useMutation calling the same function
 * useUtils().X.Y.invalidate(input?) -> queryClient.invalidateQueries({ queryKey: ... })
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type AnyRecord = Record<string, unknown>;

type Ctx = {
  user: {
    id: string;
    role: string;
    companyId: string | null;
    name: string;
    email: string;
  };
};

// ---------------------------------------------------------------------------
// Utility: current session user + profile role
// ---------------------------------------------------------------------------
async function requireCtx(): Promise<Ctx> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, company_id, name, email')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error || !profile) {
    throw new Error(error?.message ?? 'Profile not found');
  }
  return {
    user: {
      id: profile.id as string,
      role: profile.role as string,
      companyId: (profile.company_id as string | null) ?? null,
      name: (profile.name as string) ?? '',
      email: (profile.email as string) ?? '',
    },
  };
}

function isAdmin(role: string): boolean {
  return role === 'Admin' || role === 'SuperAdmin';
}

function throwErr(error: unknown, fallback: string): never {
  const msg = (error as { message?: string })?.message ?? fallback;
  throw new Error(msg);
}

/**
 * Detects a "relation/table does not exist" error from Postgres / PostgREST.
 * Used so brand-new features whose migration hasn't been applied to the live
 * database yet degrade to an empty state instead of crashing the app.
 */
function isMissingRelation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  // Only treat genuine "missing table / not in schema cache" as not-ready.
  // 42P01 = undefined_table. NOTE: do NOT include 42703 (undefined_column) or
  // 42883 (undefined_function) here — those are real bugs inside an applied
  // migration and must surface, not be masked by the "apply migrations" message.
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  const msg = (e.message ?? '').toLowerCase();
  return (
    msg.includes('could not find the table') ||
    (msg.includes('schema cache') && !msg.includes('column') && !msg.includes('function')) ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

/**
 * Narrowly detects that the `loads` TABLE itself is absent (migrations 0082/0083
 * never applied). Unlike isMissingRelation, this does NOT match a missing
 * dependency (invoices/payments columns, payouts), an RLS denial, or a business
 * rule raised inside accept_load — those are real errors that must surface so
 * they can be fixed, not masked by the misleading "apply migrations" message.
 */
function isLoadsTableMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  const msg = (e.message ?? '').toLowerCase();
  // PostgREST schema-cache miss for the loads endpoint, or Postgres undefined_table
  // (42P01) naming the loads relation specifically.
  if (e.code === 'PGRST205' && msg.includes('loads')) return true;
  if (e.code === '42P01' && msg.includes('"loads"')) return true;
  return (
    msg.includes("could not find the table 'public.loads'") ||
    (msg.includes('relation "public.loads" does not exist'))
  );
}

/** Friendly error thrown when a load action is attempted before migrations are applied. */
const LOADS_NOT_READY =
  'The Loads marketplace isn\u2019t set up on the server yet. Apply the latest database migrations (0082 & 0083) and try again.';

// ---------------------------------------------------------------------------
// Mappers: row -> shape expected by the UI (camelCase, booking types, etc.)
// ---------------------------------------------------------------------------
type Row = Record<string, any>;

function mapWarehouseBooking(r: Row): Row {
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
    pendingCounterOfferId: r.pending_counter_offer_id ?? null,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function mapServiceJob(r: Row): Row {
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

// Reverse map (camelCase input -> snake_case db columns). Only whitelisted columns.
function bookingInputToDb(payload: AnyRecord): AnyRecord {
  const m: AnyRecord = {};
  const kv: Record<string, string> = {
    listingId: 'listing_id',
    customerCompanyId: 'customer_company_id',
    palletsRequested: 'pallets_requested',
    startDate: 'start_date',
    endDate: 'end_date',
    handlingRequired: 'handling_required',
    customerNotes: 'customer_notes',
    providerResponseNotes: 'provider_response_notes',
    proposedPrice: 'proposed_price',
    counterOfferPrice: 'counter_offer_price',
    finalPrice: 'final_price',
    status: 'status',
    paymentStatus: 'payment_status',
  };
  for (const k of Object.keys(payload)) {
    if (k in kv) m[kv[k]] = payload[k];
  }
  return m;
}

function serviceJobInputToDb(payload: AnyRecord): AnyRecord {
  const m: AnyRecord = {};
  const kv: Record<string, string> = {
    serviceId: 'service_id',
    customerCompanyId: 'customer_company_id',
    locationAddress: 'location_address',
    locationCity: 'location_city',
    dateTimeStart: 'date_time_start',
    durationHours: 'duration_hours',
    notes: 'notes',
    totalPrice: 'total_price',
    status: 'status',
    paymentStatus: 'payment_status',
    checkInTs: 'check_in_ts',
    checkOutTs: 'check_out_ts',
    customerConfirmed: 'customer_confirmed',
  };
  for (const k of Object.keys(payload)) {
    if (k in kv) m[kv[k]] = payload[k];
  }
  return m;
}

// ---------------------------------------------------------------------------
// PROCEDURES map
// key = "namespace.procedure"
// value = async (input, ctx) => result
// ---------------------------------------------------------------------------

type ProcedureFn = (input: any, ctx: Ctx) => Promise<any>;

const PROCEDURES: Record<string, ProcedureFn> = {
  // =========================================================================
  // dock.bootstrap — already backed elsewhere; but keep dummy so invalidate works
  // =========================================================================
  'dock.bootstrap': async () => ({}),

  // dock.createRecord — generic create with shape {table, payload}
  'dock.createRecord': async (input: { table: string; payload: AnyRecord }, ctx) => {
    const { table, payload } = input;
    if (table === 'messages') {
      const { data, error } = await supabase.from('messages').insert({
        reference_type: payload.referenceType,
        reference_id: payload.referenceId,
        sender_user_id: ctx.user.id,
        text: String(payload.text ?? ''),
      }).select().single();
      if (error) throwErr(error, 'Unable to send message');
      return { id: data!.id };
    }
    if (table === 'service_jobs') {
      const db = serviceJobInputToDb(payload);
      const { data, error } = await supabase.from('service_jobs').insert(db).select().single();
      if (error) throwErr(error, 'Unable to create service job');
      return { id: data!.id };
    }
    if (table === 'warehouse_bookings') {
      const db = bookingInputToDb(payload);
      const { data, error } = await supabase.from('warehouse_bookings').insert(db).select().single();
      if (error) throwErr(error, 'Unable to create booking');
      return { id: data!.id };
    }
    if (table === 'disputes') {
      const { data, error } = await supabase.from('disputes').insert({
        reference_type: payload.referenceType,
        reference_id: payload.referenceId,
        opened_by_user_id: ctx.user.id,
        description: payload.description ?? '',
        status: payload.status ?? 'Open',
        admin_notes: payload.adminNotes ?? '',
      }).select().single();
      if (error) throwErr(error, 'Unable to create dispute');
      return { id: data!.id };
    }
    throw new Error(`createRecord: table "${table}" is not supported`);
  },

  // dock.updateRecord — generic update
  'dock.updateRecord': async (input: { table: string; id: string; payload: AnyRecord }, ctx) => {
    const { table, id, payload } = input;
    let db: AnyRecord = {};
    if (table === 'service_jobs') db = serviceJobInputToDb(payload);
    else if (table === 'warehouse_bookings') db = bookingInputToDb(payload);
    else if (table === 'disputes') {
      const kv: Record<string, string> = {
        status: 'status', outcome: 'outcome', adminNotes: 'admin_notes', description: 'description',
      };
      for (const k of Object.keys(payload)) if (k in kv) db[kv[k]] = payload[k];
    } else if (table === 'products') {
      if ('name' in payload) db.name = payload.name;
      if ('description' in payload) db.description = payload.description;
    } else {
      // No fallback — require explicit per-table mapping to prevent arbitrary column writes.
      throw new Error(`updateRecord: table "${table}" is not supported. Add explicit handling in dock.updateRecord.`);
    }
    const { error } = await supabase.from(table).update(db).eq('id', id);
    if (error) throwErr(error, 'Unable to update record');
    return { success: true };
  },

  // dock.updateCompany
  'dock.updateCompany': async (input: { id: string; payload: AnyRecord }) => {
    const { error } = await supabase.from('companies').update(input.payload).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update company');
    // Best-effort: notify all admins when a company is submitted for approval.
    if (input.payload.status === 'PendingApproval') {
      void (async () => {
        const [coRes, adminsRes] = await Promise.all([
          supabase.from('companies').select('name, type').eq('id', input.id).maybeSingle(),
          supabase.from('user_roles').select('user_id').eq('role', 'admin'),
        ]);
        const co = coRes.data;
        const admins = adminsRes.data ?? [];
        if (!co || admins.length === 0) return;
        await Promise.all(admins.map((a) => supabase.from('notifications').insert({
          user_id: a.user_id,
          kind: 'company_pending',
          title: 'Company pending approval',
          body: `${co.name} (${(co.type as string | null) ?? 'unknown type'}) requires your review in Compliance.`,
          entity_type: 'companies',
          entity_id: input.id,
        })));
      })();
    }
    return { success: true };
  },

  // dock.updateUser — INTENTIONALLY restricted to safe display fields only.
  // role and status MUST NOT be updated here; use admin_set_user_status / admin_grant_role RPCs.
  'dock.updateUser': async (input: { id: string; payload: AnyRecord }) => {
    const db: AnyRecord = {};
    if ('name' in input.payload) db.name = input.payload.name;
    if ('profileImage' in input.payload) db.profile_image = input.payload.profileImage;
    // role and status are intentionally excluded — they can only be changed via audited admin RPCs.
    const { error } = await supabase.from('profiles').update(db).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update user');
    return { success: true };
  },

  // =========================================================================
  // BOOKINGS
  // =========================================================================
  'bookings.listMine': async (input: { companyId?: string } | undefined, ctx) => {
    const companyId = input?.companyId ?? ctx.user.companyId;
    const q = supabase.from('warehouse_bookings').select('*');
    const { data, error } = isAdmin(ctx.user.role)
      ? await q.order('created_at', { ascending: false })
      : companyId
        ? await q.or(`customer_company_id.eq.${companyId},warehouse_company_id.eq.${companyId}`).order('created_at', { ascending: false })
        : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load bookings');
    return (data ?? []).map(mapWarehouseBooking);
  },

  'bookings.create': async (input: {
    listingId: string; palletsRequested: number; startDate: string;
    endDate: string; handlingRequired: boolean; customerNotes: string; proposedPrice: number;
    customerCompanyId?: string;
  }, ctx) => {
    const customerCompanyId = input.customerCompanyId ?? ctx.user.companyId;
    if (!customerCompanyId) throw new Error('Company context required');
    const { data, error } = await supabase.from('warehouse_bookings').insert({
      listing_id: input.listingId,
      customer_company_id: customerCompanyId,
      pallets_requested: input.palletsRequested,
      start_date: input.startDate,
      end_date: input.endDate,
      handling_required: input.handlingRequired,
      customer_notes: input.customerNotes ?? '',
      proposed_price: input.proposedPrice,
      status: 'Requested',
      payment_status: 'Pending',
    }).select().single();
    if (error) throwErr(error, 'Unable to create booking');
    return { id: data!.id };
  },

  'bookings.accept': async (input: { id: string; note?: string }) => {
    const { error } = await supabase.rpc('transition_booking', {
      p_booking_id: input.id,
      p_next_status: 'Accepted',
      p_reason: input.note ?? null,
      p_counter_offer_price: null,
      p_response_notes: input.note ?? null,
    });
    if (error) throwErr(error, 'Unable to accept booking');
    return { success: true, status: 'Accepted' as const };
  },

  'bookings.decline': async (input: { id: string; note?: string }) => {
    const { error } = await supabase.rpc('transition_booking', {
      p_booking_id: input.id,
      p_next_status: 'Cancelled',
      p_reason: input.note ?? 'Declined by provider',
      p_counter_offer_price: null,
      p_response_notes: input.note ?? null,
    });
    if (error) throwErr(error, 'Unable to decline booking');
    return { success: true, status: 'Cancelled' as const };
  },

  'bookings.submitCounterOffer': async (input: { id: string; amount: number; message?: string }) => {
    const { error } = await supabase.rpc('transition_booking', {
      p_booking_id: input.id,
      p_next_status: 'CounterOffered',
      p_reason: input.message ?? null,
      p_counter_offer_price: input.amount,
      p_response_notes: input.message ?? null,
    });
    if (error) throwErr(error, 'Unable to submit counter offer');
    // Best-effort: notify customer company members about the counter offer.
    void (async () => {
      const { data: booking } = await supabase
        .from('warehouse_bookings')
        .select('customer_company_id, listing_id')
        .eq('id', input.id).maybeSingle();
      if (!booking?.customer_company_id) return;
      const { data: listing } = await supabase
        .from('warehouse_listings').select('name').eq('id', booking.listing_id ?? '').maybeSingle();
      const { data: members } = await supabase
        .from('company_users').select('user_id')
        .eq('company_id', booking.customer_company_id)
        .in('company_role', ['Owner', 'Admin', 'owner', 'admin']);
      await Promise.all((members ?? []).map((m) => supabase.from('notifications').insert({
        user_id: m.user_id,
        kind: 'booking_counter_offer',
        title: 'Counter offer received 💬',
        body: `${listing?.name ?? 'A warehouse'} has made a counter offer of ${Number(input.amount).toLocaleString()} for your booking. Open Bookings to review and respond.`,
        entity_type: 'warehouse_bookings',
        entity_id: input.id,
      })));
    })();
    return { id: input.id };
  },

  'bookings.respondToCounterOffer': async (input: { counterOfferId: string; action: 'accept' | 'reject'; note?: string }) => {
    // Customer accepting counter → Accepted.
    // Customer declining counter → Declined (terminal, per booking state machine in PLAN.md 0.6).
    const next = input.action === 'accept' ? 'Accepted' : 'Declined';
    const { error } = await supabase.rpc('transition_booking', {
      p_booking_id: input.counterOfferId,
      p_next_status: next,
      p_reason: input.note ?? (input.action === 'accept' ? 'Customer accepted counter' : 'Customer rejected counter'),
      p_counter_offer_price: null,
      p_response_notes: input.note ?? null,
    });
    if (error) throwErr(error, 'Unable to respond to counter offer');
    return { success: true, bookingStatus: next, counterOfferStatus: input.action === 'accept' ? 'Accepted' : 'Rejected' };
  },

  'bookings.complete': async (input: { id: string; reason?: string }) => {
    const { error } = await supabase.rpc('transition_booking', {
      p_booking_id: input.id,
      p_next_status: 'Completed',
      p_reason: input.reason ?? 'Completed by provider',
      p_counter_offer_price: null,
      p_response_notes: null,
    });
    if (error) throwErr(error, 'Unable to complete booking');
    return { success: true };
  },

  // =========================================================================
  // WAREHOUSES
  // =========================================================================
  'warehouses.createListing': async (input: AnyRecord, ctx) => {
    const companyId = (input.companyId as string | undefined) ?? ctx.user.companyId;
    if (!companyId) throw new Error('Company context required');
    const { data, error } = await supabase.from('warehouse_listings').insert({
      company_id: companyId,
      name: input.name,
      address: input.address,
      city: input.city,
      warehouse_type: input.warehouseType,
      available_pallet_capacity: input.availablePalletCapacity,
      min_pallets: input.minPallets ?? 1,
      max_pallets: input.maxPallets ?? input.availablePalletCapacity,
      storage_term: input.storageTerm ?? 'Monthly',
      storage_rate_per_pallet: input.storageRatePerPallet,
      inbound_handling_fee_per_pallet: input.inboundHandlingFeePerPallet ?? 0,
      outbound_handling_fee_per_pallet: input.outboundHandlingFeePerPallet ?? 0,
      receiving_hours: input.receivingHours ?? '',
      access_restrictions: input.accessRestrictions ?? '',
      insurance_requirements: input.insuranceRequirements ?? '',
      notes: input.notes ?? '',
      status: input.status ?? 'Draft',
    }).select().single();
    if (error) throwErr(error, 'Unable to create listing');
    return { id: data!.id };
  },

  'warehouses.updateListing': async (input: AnyRecord) => {
    const db: AnyRecord = {};
    const kv: Record<string, string> = {
      name: 'name', address: 'address', city: 'city',
      warehouseType: 'warehouse_type',
      availablePalletCapacity: 'available_pallet_capacity',
      storageRatePerPallet: 'storage_rate_per_pallet',
      minPallets: 'min_pallets', maxPallets: 'max_pallets',
      inboundHandlingFeePerPallet: 'inbound_handling_fee_per_pallet',
      outboundHandlingFeePerPallet: 'outbound_handling_fee_per_pallet',
      receivingHours: 'receiving_hours',
      accessRestrictions: 'access_restrictions',
      insuranceRequirements: 'insurance_requirements',
      notes: 'notes',
    };
    for (const k of Object.keys(input)) if (k !== 'id' && k in kv) db[kv[k]] = input[k];
    const { error } = await supabase.from('warehouse_listings').update(db).eq('id', input.id as string);
    if (error) throwErr(error, 'Unable to update listing');
    return { success: true };
  },

  // warehouses.setListingStatus — all transitions are routed through audited RPCs.
  // Provider:  Draft → PendingApproval   via provider_submit_listing (0050)
  // Provider:  PendingApproval → Draft   via provider_withdraw_listing (0050)
  // Admin:     any status                via admin_set_listing_status (0007)
  // No direct warehouse_listings UPDATE is allowed.
  'warehouses.setListingStatus': async (input: { id: string; status: string }, ctx) => {
    if (isAdmin(ctx.user.role)) {
      const { error } = await supabase.rpc('admin_set_listing_status', {
        p_listing_id: input.id,
        p_status: input.status,
        p_reason: `Status set to ${input.status} by admin`,
      });
      if (error) throwErr(error, 'Unable to update listing status — check admin privileges');
    } else if (input.status === 'PendingApproval') {
      const { error } = await supabase.rpc('provider_submit_listing', { p_listing_id: input.id });
      if (error) throwErr(error, 'Unable to submit listing for review');
    } else if (input.status === 'Draft') {
      const { error } = await supabase.rpc('provider_withdraw_listing', { p_listing_id: input.id });
      if (error) throwErr(error, 'Unable to withdraw listing from review');
    } else {
      throw new Error(`setListingStatus: status "${input.status}" requires admin privileges`);
    }
    return { success: true };
  },

  // =========================================================================
  // SERVICES (listings)
  // =========================================================================
  'services.listMine': async (_input, ctx) => {
    if (!ctx.user.companyId && !isAdmin(ctx.user.role)) return [];
    const q = supabase.from('service_listings').select('*');
    const { data, error } = isAdmin(ctx.user.role)
      ? await q.order('created_at', { ascending: false })
      : await q.eq('company_id', ctx.user.companyId!).order('created_at', { ascending: false });
    if (error) throwErr(error, 'Unable to load services');
    return data ?? [];
  },

  'services.createListing': async (input: AnyRecord, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { data, error } = await supabase.from('service_listings').insert({
      company_id: ctx.user.companyId,
      category: input.category,
      coverage_area: input.coverageArea ?? [],
      hourly_rate: input.hourlyRate,
      per_job_rate: input.perJobRate ?? null,
      minimum_hours: input.minimumHours ?? 1,
      certifications: input.certifications ?? '',
      status: input.status ?? 'Draft',
    }).select().single();
    if (error) throwErr(error, 'Unable to create service');
    return { id: data!.id };
  },

  'services.updateListing': async (input: AnyRecord) => {
    const db: AnyRecord = {};
    const kv: Record<string, string> = {
      category: 'category', hourlyRate: 'hourly_rate',
      perJobRate: 'per_job_rate', minimumHours: 'minimum_hours',
      certifications: 'certifications', coverageArea: 'coverage_area',
    };
    for (const k of Object.keys(input)) if (k !== 'id' && k in kv) db[kv[k]] = input[k];
    const { error } = await supabase.from('service_listings').update(db).eq('id', input.id as string);
    if (error) throwErr(error, 'Unable to update service');
    return { success: true };
  },

  // services.setListingStatus — all transitions are routed through audited RPCs.
  // Provider:  Draft/Rejected → PendingApproval  via provider_submit_service_listing (0051)
  // Provider:  PendingApproval → Draft            via provider_withdraw_service_listing (0051)
  // Admin:     any status                         via admin_set_service_listing_status (0052)
  //            NOTE: admin_set_listing_status (0007) only targets warehouse_listings.
  //            Service listings require the separate admin_set_service_listing_status RPC.
  // No direct service_listings UPDATE is allowed.
  'services.setListingStatus': async (input: { id: string; status: string }, ctx) => {
    if (isAdmin(ctx.user.role)) {
      const { error } = await supabase.rpc('admin_set_service_listing_status', {
        p_listing_id: input.id,
        p_status: input.status,
        p_reason: `Status set to ${input.status} by admin`,
      });
      if (error) throwErr(error, 'Unable to update service listing status — check admin privileges');
    } else if (input.status === 'PendingApproval') {
      const { error } = await supabase.rpc('provider_submit_service_listing', { p_listing_id: input.id });
      if (error) throwErr(error, 'Unable to submit service listing for review');
    } else if (input.status === 'Draft') {
      const { error } = await supabase.rpc('provider_withdraw_service_listing', { p_listing_id: input.id });
      if (error) throwErr(error, 'Unable to withdraw service listing from review');
    } else {
      throw new Error(`setListingStatus: status "${input.status}" requires admin privileges`);
    }
    return { success: true };
  },

  // =========================================================================
  // INVENTORY (products + variants)
  // =========================================================================
  'inventory.listProducts': async (_input, ctx) => {
    const q = supabase.from('products').select('*').is('archived_at', null);
    const { data, error } = isAdmin(ctx.user.role)
      ? await q.order('created_at', { ascending: false })
      : ctx.user.companyId
        ? await q.eq('company_id', ctx.user.companyId).order('created_at', { ascending: false })
        : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load products');
    return data ?? [];
  },

  'inventory.createProduct': async (input: { name: string; description?: string }, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { data, error } = await supabase.from('products').insert({
      company_id: ctx.user.companyId,
      name: input.name,
      description: input.description ?? '',
    }).select().single();
    if (error) throwErr(error, 'Unable to create product');
    return { id: data!.id };
  },

  'inventory.archiveProduct': async (input: { id: string }) => {
    const { error } = await supabase.from('products').update({ archived_at: new Date().toISOString() }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to archive product');
    return { success: true };
  },

  'inventory.listVariants': async (input: { productId: string }) => {
    if (!input.productId) return [];
    const { data, error } = await supabase
      .from('product_variants')
      .select('*')
      .eq('product_id', input.productId)
      .order('sku', { ascending: true });
    if (error) throwErr(error, 'Unable to load variants');
    return data ?? [];
  },

  // Lists every variant for the company (joined through products), so WMS can
  // receive brand-new SKUs that aren't in stock yet — not just already-stocked ones.
  'inventory.listAllVariants': async (_input, ctx) => {
    if (!ctx.user.companyId && !isAdmin(ctx.user.role)) return [];
    let q = supabase
      .from('product_variants')
      .select('id, sku, name, barcode, product_id, products!inner(company_id, name)')
      .order('sku', { ascending: true });
    if (!isAdmin(ctx.user.role) && ctx.user.companyId) q = q.eq('products.company_id', ctx.user.companyId);
    const { data, error } = await q;
    if (error) throwErr(error, 'Unable to load variants');
    return data ?? [];
  },

  'inventory.upsertVariant': async (input: { id?: string; productId: string; sku: string; barcode?: string | null; name?: string }) => {
    if (input.id) {
      const { error } = await supabase.from('product_variants').update({
        sku: input.sku, barcode: input.barcode ?? null, name: input.name ?? '',
      }).eq('id', input.id);
      if (error) throwErr(error, 'Unable to update variant');
      return { id: input.id };
    }
    const { data, error } = await supabase.from('product_variants').insert({
      product_id: input.productId, sku: input.sku,
      barcode: input.barcode ?? null, name: input.name ?? '',
    }).select().single();
    if (error) throwErr(error, 'Unable to add variant');
    return { id: data!.id };
  },

  // =========================================================================
  // FULFILLMENT
  // =========================================================================
  'fulfillment.listMyOrders': async (_input, ctx) => {
    if (!ctx.user.companyId) return { orders: [], items: [], shipments: [] };
    const { data: orders, error } = await supabase
      .from('fulfillment_orders')
      .select('*')
      .or(`customer_company_id.eq.${ctx.user.companyId},provider_company_id.eq.${ctx.user.companyId}`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throwErr(error, 'Unable to load orders');
    const orderIds = (orders ?? []).map((o) => o.id);
    if (orderIds.length === 0) return { orders: [], items: [], shipments: [] };
    const { data: items } = await supabase.from('order_items').select('*').in('order_id', orderIds);
    return { orders: orders ?? [], items: items ?? [], shipments: [] };
  },

  'fulfillment.getBooking': async (input: { bookingId: string }, ctx) => {
    const { data: booking, error } = await supabase
      .from('warehouse_bookings').select('*').eq('id', input.bookingId).maybeSingle();
    if (error || !booking) throw new Error('Booking not found');
    // Determine if the viewer is the warehouse provider (listing owner) or the customer.
    let providerCompanyId: string | null = null;
    if (booking.listing_id) {
      const { data: listing } = await supabase
        .from('warehouse_listings').select('company_id').eq('id', booking.listing_id).maybeSingle();
      providerCompanyId = listing?.company_id ?? null;
    }
    const role: 'customer' | 'provider' =
      ctx.user.companyId && providerCompanyId && ctx.user.companyId === providerCompanyId
        ? 'provider'
        : 'customer';
    const { data: inventory } = await supabase
      .from('booking_inventory').select('*').eq('booking_id', input.bookingId);
    const { data: orders } = await supabase
      .from('fulfillment_orders').select('*').eq('booking_id', input.bookingId)
      .order('created_at', { ascending: false });
    const orderIds = (orders ?? []).map((o) => o.id);
    const { data: items } = orderIds.length
      ? await supabase.from('order_items').select('*').in('order_id', orderIds)
      : { data: [] };
    return {
      booking: { ...mapWarehouseBooking(booking), company_id: booking.customer_company_id },
      role,
      inventory: inventory ?? [],
      orders: orders ?? [],
      orderItems: items ?? [],
      shipments: [],
    };
  },

  'fulfillment.addInventory': async (input: { bookingId: string; sku: string; description: string; quantity: number }) => {
    const { data, error } = await supabase.from('booking_inventory').insert({
      booking_id: input.bookingId,
      sku: input.sku, name: input.description, quantity: input.quantity,
    }).select().single();
    if (error) throwErr(error, 'Unable to add inventory');
    return { id: data!.id };
  },

  'fulfillment.createOrder': async (input: { bookingId: string; reference: string; shipTo: string; notes: string; items: { inventoryItemId: string; quantity: number }[] }, ctx) => {
    const { data: booking } = await supabase
      .from('warehouse_bookings')
      .select('customer_company_id,listing_id,status')
      .eq('id', input.bookingId).single();
    // Gate: only allow fulfillment orders when the booking is active.
    if (!booking) throw new Error('Booking not found');
    const ACTIVE_BOOKING_STATUSES = ['Accepted', 'Confirmed', 'Scheduled', 'InProgress', 'Active'];
    if (!ACTIVE_BOOKING_STATUSES.includes((booking.status as string | null) ?? '')) {
      throw new Error(`Cannot create fulfillment orders for a booking with status "${booking.status as string}". The booking must be Accepted or Active first.`);
    }
    let providerCompanyId: string | null = null;
    if (booking?.listing_id) {
      const { data: listing } = await supabase
        .from('warehouse_listings')
        .select('company_id').eq('id', booking.listing_id).single();
      providerCompanyId = listing?.company_id ?? null;
    }
    const { data: order, error } = await supabase.from('fulfillment_orders').insert({
      booking_id: input.bookingId,
      customer_company_id: booking?.customer_company_id ?? ctx.user.companyId,
      provider_company_id: providerCompanyId,
      reference_code: input.reference,
      status: 'Received',
      ship_to_address: input.shipTo,
      notes: input.notes,
    }).select().single();
    if (error) throwErr(error, 'Unable to create order');
    for (const it of input.items) {
      const { data: inv } = await supabase
        .from('booking_inventory').select('sku,name').eq('id', it.inventoryItemId).maybeSingle();
      await supabase.from('order_items').insert({
        order_id: order!.id,
        sku: inv?.sku ?? '', name: inv?.name ?? '',
        quantity: it.quantity,
      });
    }
    return { id: order!.id };
  },

  // fulfillment order transitions go through advance_fulfillment_order RPC (0042) which
  // validates allowed transitions, prevents status jumps, and enforces membership checks.
  'fulfillment.pickOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.rpc('advance_fulfillment_order', { p_order_id: input.orderId, p_next_status: 'Picking' });
    if (error) throwErr(error, 'Unable to pick order — invalid transition or access denied');
    return { success: true, status: 'Picking' };
  },
  'fulfillment.packOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.rpc('advance_fulfillment_order', { p_order_id: input.orderId, p_next_status: 'Packed' });
    if (error) throwErr(error, 'Unable to pack order — invalid transition or access denied');
    return { success: true, status: 'Packed' };
  },
  'fulfillment.shipOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.rpc('advance_fulfillment_order', { p_order_id: input.orderId, p_next_status: 'Shipped' });
    if (error) throwErr(error, 'Unable to ship order — invalid transition or access denied');
    return { success: true, status: 'Shipped' };
  },
  'fulfillment.completeOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.rpc('advance_fulfillment_order', { p_order_id: input.orderId, p_next_status: 'Completed' });
    if (error) throwErr(error, 'Unable to complete order — invalid transition or access denied');
    return { success: true, status: 'Completed' };
  },

  // =========================================================================
  // OPERATIONS — fleet + dock appointments + gate + driver
  // =========================================================================
  'operations.truckingDashboard': async (_input, ctx) => {
    if (!ctx.user.companyId) return { appointments: [], drivers: [], trucks: [], trailers: [], containers: [] };
    const [apps, drivers, trucks, trailers, containers] = await Promise.all([
      supabase.from('dock_appointments').select('*').eq('trucking_company_id', ctx.user.companyId).is('archived_at', null).order('scheduled_start'),
      supabase.from('drivers').select('*').eq('company_id', ctx.user.companyId).is('archived_at', null),
      supabase.from('trucks').select('*').eq('company_id', ctx.user.companyId).is('archived_at', null),
      supabase.from('trailers').select('*').eq('company_id', ctx.user.companyId).is('archived_at', null),
      supabase.from('containers').select('*').eq('company_id', ctx.user.companyId).is('archived_at', null),
    ]);
    return {
      appointments: apps.data ?? [], drivers: drivers.data ?? [],
      trucks: trucks.data ?? [], trailers: trailers.data ?? [], containers: containers.data ?? [],
    };
  },

  'operations.listFleet': async (input: { entity: 'drivers' | 'trucks' | 'trailers' | 'containers'; search?: string }, ctx) => {
    if (!ctx.user.companyId && !isAdmin(ctx.user.role)) return [];
    let q = supabase.from(input.entity).select('*').is('archived_at', null).order('updated_at', { ascending: false });
    if (ctx.user.companyId && !isAdmin(ctx.user.role)) q = q.eq('company_id', ctx.user.companyId);
    const { data, error } = await q;
    if (error) throwErr(error, 'Unable to load fleet');
    const s = (input.search ?? '').trim().toLowerCase();
    if (!s) return data ?? [];
    return (data ?? []).filter((r) => JSON.stringify(r).toLowerCase().includes(s));
  },

  'operations.createFleetRecord': async (input: { entity: string; payload: AnyRecord }, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const p = input.payload;
    let row: AnyRecord = { company_id: ctx.user.companyId, status: p.status ?? 'Active' };
    if (input.entity === 'drivers') {
      // Best-effort: look up linked auth user by email to enable driver_user_id on appointments.
      let linkedUserId: string | null = null;
      if (p.email) {
        const { data: profile } = await supabase
          .from('profiles').select('id').eq('email', String(p.email).trim().toLowerCase()).maybeSingle();
        linkedUserId = profile?.id ?? null;
      }
      row = {
        ...row,
        name: p.name ?? '',
        license_number: p.licenseNumber ?? '',
        phone: p.phone ?? '',
        // data JSONB stores email + linked auth userId so dispatcher can set driver_user_id on appointments.
        data: { name: p.name ?? '', email: p.email ?? '', ...(linkedUserId ? { userId: linkedUserId } : {}) },
      };
    } else if (input.entity === 'trucks') {
      row = { ...row, plate: p.plateNumber ?? p.unitNumber ?? '', make: p.make ?? '', model: p.model ?? '' };
    } else if (input.entity === 'trailers') {
      row = { ...row, plate: p.plateNumber ?? p.trailerNumber ?? '', trailer_type: p.trailerType ?? '' };
    } else if (input.entity === 'containers') {
      row = { ...row, container_number: p.containerNumber ?? '', container_type: p.containerType ?? '' };
    }
    const { data, error } = await supabase.from(input.entity).insert(row).select().single();
    if (error) throwErr(error, 'Unable to create record');
    return { id: data!.id };
  },

  'operations.updateFleetRecord': async (input: { entity: string; id: string; payload: AnyRecord }) => {
    const p = input.payload;
    let row: AnyRecord = { status: p.status ?? 'Active' };
    if (input.entity === 'drivers') {
      // Best-effort: look up linked auth user by email to keep driver_user_id mapping current.
      let linkedUserId: string | null = null;
      if (p.email) {
        const { data: profile } = await supabase
          .from('profiles').select('id').eq('email', String(p.email).trim().toLowerCase()).maybeSingle();
        linkedUserId = profile?.id ?? null;
      }
      row = {
        ...row,
        name: p.name ?? '',
        license_number: p.licenseNumber ?? '',
        phone: p.phone ?? '',
        data: { name: p.name ?? '', email: p.email ?? '', ...(linkedUserId ? { userId: linkedUserId } : {}) },
      };
    } else if (input.entity === 'trucks') {
      row = { ...row, plate: p.plateNumber ?? p.unitNumber ?? '' };
    } else if (input.entity === 'trailers') {
      row = { ...row, plate: p.plateNumber ?? p.trailerNumber ?? '' };
    } else if (input.entity === 'containers') {
      row = { ...row, container_number: p.containerNumber ?? '', container_type: p.containerType ?? '' };
    }
    const { error } = await supabase.from(input.entity).update(row).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update record');
    return { success: true };
  },

  'operations.archiveFleetRecord': async (input: { entity: string; id: string }) => {
    const { error } = await supabase.from(input.entity).update({ archived_at: new Date().toISOString() }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to archive record');
    return { success: true };
  },

  // patchVehicleInfo — updates ONLY non-status vehicle fields on dock_appointments.
  // Never touches status. Gate staff call this alongside yard.recordEvent.
  'operations.patchVehicleInfo': async (input: {
    appointmentId: string;
    driverName?: string | null;
    truckPlate?: string | null;
    trailerNumber?: string | null;
    referenceNumber?: string | null;
  }) => {
    const patch: AnyRecord = {};
    if (input.driverName    !== undefined) patch.driver_name      = input.driverName;
    if (input.truckPlate    !== undefined) patch.truck_plate      = input.truckPlate;
    if (input.trailerNumber !== undefined) patch.trailer_number   = input.trailerNumber;
    if (input.referenceNumber !== undefined) patch.reference_number = input.referenceNumber;
    if (Object.keys(patch).length === 0) return { success: true };
    const { error } = await supabase.from('dock_appointments').update(patch).eq('id', input.appointmentId);
    if (error) throwErr(error, 'Unable to update vehicle info');
    return { success: true };
  },

  // driverJobs — looks up by driver_user_id first (preferred), falls back to driver_name
  // for legacy records created before driver_user_id was available on the trucking flow.
  // Note: fleet drivers.id ≠ auth.uid; driver_user_id is only set when the driver is a
  // registered app user with Driver role. Name-string fallback covers fleet-only records.
  'operations.driverJobs': async (_input, ctx) => {
    const { data } = await supabase
      .from('dock_appointments')
      .select('*')
      .or(`driver_user_id.eq.${ctx.user.id},driver_name.eq.${encodeURIComponent(ctx.user.name ?? '')}`)
      .is('archived_at', null)
      .order('scheduled_start');
    return data ?? [];
  },

  'operations.uploadPodReference': async (input: { appointmentId: string; fileId: string }) => {
    const { error } = await supabase.from('dock_appointments').update({ pod_file: input.fileId }).eq('id', input.appointmentId);
    if (error) throwErr(error, 'Unable to upload POD');
    return { success: true };
  },

  // gateWarehouses — the warehouses (listings) owned by the gate staff's company.
  // Each warehouse is a separate gate; the panel scopes appointments to one of these.
  'operations.gateWarehouses': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data } = await supabase
      .from('warehouse_listings')
      .select('id,name')
      .eq('company_id', ctx.user.companyId)
      .order('name');
    return (data ?? []).map((x) => ({ id: String(x.id), name: String((x as AnyRecord).name ?? 'Warehouse') }));
  },

  // gatePanel — today's dock appointments for ONE warehouse (gate). A company can run
  // several warehouses; each has its own gate, so a listingId must be supplied to scope
  // the queue. Without it, no appointments are returned (the UI prompts to pick a gate).
  'operations.gatePanel': async (input: { listingId?: string | null } | undefined, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data: myListings } = await supabase.from('warehouse_listings').select('id').eq('company_id', ctx.user.companyId);
    const ownedIds = (myListings ?? []).map((x) => String(x.id));
    if (ownedIds.length === 0) return [];
    const requested = input?.listingId ? String(input.listingId) : null;
    // Only allow filtering to a warehouse the company actually owns.
    if (!requested || !ownedIds.includes(requested)) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setDate(end.getDate() + 1);
    const { data } = await supabase
      .from('dock_appointments').select('*')
      .eq('warehouse_listing_id', requested)
      .gte('scheduled_start', today.toISOString())
      .lt('scheduled_start', end.toISOString())
      .order('scheduled_start');
    return data ?? [];
  },

  // checkInAppointment — advances dock appointment status directly (used by trucking dispatcher
  // for assignment approval flow and by yard.tsx board view alongside gate_record_event).
  // Gate staff should use yard.recordEvent exclusively; this procedure is kept for
  // the warehouse/dispatcher-side approval step (Requested → Approved) and for
  // driver_user_id assignment when a registered Driver-role user is dispatched.
  'operations.checkInAppointment': async (input: {
    appointmentId: string;
    status: string;
    driverName?: string | null;
    truckPlate?: string | null;
    driverUserId?: string | null;   // auth.uid() of a Driver-role user; null for fleet-only
    trailerNumber?: string | null;
    referenceNumber?: string | null;
    notes?: string | null;
  }) => {
    const patch: AnyRecord = { status: input.status };
    if (input.status === 'CheckedIn') patch.check_in_ts = new Date().toISOString();
    if (input.status === 'Completed') patch.check_out_ts = new Date().toISOString();
    if (input.driverName      !== undefined) patch.driver_name      = input.driverName;
    if (input.truckPlate      !== undefined) patch.truck_plate      = input.truckPlate;
    if (input.driverUserId    !== undefined) patch.driver_user_id   = input.driverUserId;
    if (input.trailerNumber   !== undefined) patch.trailer_number   = input.trailerNumber;
    if (input.referenceNumber !== undefined) patch.reference_number = input.referenceNumber;
    if (input.notes           !== undefined) patch.notes            = input.notes;
    const { error } = await supabase.from('dock_appointments').update(patch).eq('id', input.appointmentId);
    if (error) throwErr(error, 'Unable to update appointment');
    return { success: true };
  },

  'operations.createDockAppointment': async (input: AnyRecord, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { data, error } = await supabase.from('dock_appointments').insert({
      warehouse_listing_id: input.warehouseListingId,
      booking_id: input.bookingId ?? null,
      trucking_company_id: ctx.user.companyId,
      scheduled_start: input.scheduledStart,
      scheduled_end: input.scheduledEnd,
      dock_door: input.dockDoor ?? '',
      truck_plate: input.truckPlate ?? '',
      driver_name: input.driverName ?? '',
      driver_user_id: (input.driverUserId as string | undefined) ?? null,
      appointment_type: input.appointmentType,
      pallet_count: input.palletCount,
      status: 'Requested',
    }).select().single();
    if (error) throwErr(error, 'Unable to create appointment');
    return { id: data!.id };
  },

  // approveDockAppointment — warehouse provider approves a Requested appointment.
  // Advances status from Requested → Approved directly (no gate event needed for approval).
  'operations.approveDockAppointment': async (input: { appointmentId: string; notes?: string }) => {
    const { error } = await supabase
      .from('dock_appointments')
      .update({ status: 'Approved' })
      .eq('id', input.appointmentId)
      .eq('status', 'Requested');
    if (error) throwErr(error, 'Unable to approve appointment');
    return { success: true };
  },

  // rejectDockAppointment — warehouse provider rejects a Requested appointment.
  'operations.rejectDockAppointment': async (input: { appointmentId: string; reason?: string }) => {
    const { error } = await supabase
      .from('dock_appointments')
      .update({ status: 'Cancelled', notes: input.reason ?? 'Rejected by warehouse' })
      .eq('id', input.appointmentId)
      .eq('status', 'Requested');
    if (error) throwErr(error, 'Unable to reject appointment');
    return { success: true };
  },

  // =========================================================================
  // YARD / GATE EVENTS  (used by driver screen and station-dock)
  // =========================================================================
  // yard.recordEvent — calls gate_record_event RPC (migration 0014) which appends
  // an append-only gate_events row AND atomically advances the dock_appointment status.
  'yard.recordEvent': async (input: {
    appointmentId: string;
    kind: string;
    notes?: string;
    meta?: Record<string, unknown>;
  }) => {
    const { error } = await supabase.rpc('gate_record_event', {
      p_appointment_id: input.appointmentId,
      p_kind: input.kind,
      p_notes: input.notes ?? null,
      p_meta: input.meta ?? {},
    });
    if (error) throwErr(error, 'Unable to record gate event');
    return { success: true };
  },

  // yard.listEvents — read-only log of gate_events for an appointment or recent history.
  // Used by gate-staff/station-dock to refresh after recording an event.
  'yard.listEvents': async (input: { appointmentId?: string; limit?: number } | undefined) => {
    let q = supabase
      .from('gate_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(input?.limit ?? 100);
    if (input?.appointmentId) q = q.eq('appointment_id', input.appointmentId);
    const { data, error } = await q;
    if (error) throwErr(error, 'Unable to load gate events');
    return data ?? [];
  },

  // =========================================================================
  // LOADS — "Uber for Trucks" marketplace
  // =========================================================================
  'loads.quote': async (input: {
    pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number;
    vehicleType: string; pallets: number; deliverySpeed: 'SameDay' | 'NextDay';
    cargoType?: string; weightKg?: number;
  }) => {
    const { data, error } = await supabase.rpc('quote_load', {
      p_pickup_lat: input.pickupLat, p_pickup_lng: input.pickupLng,
      p_dropoff_lat: input.dropoffLat, p_dropoff_lng: input.dropoffLng,
      p_vehicle_type: input.vehicleType, p_pallets: input.pallets,
      p_delivery_speed: input.deliverySpeed,
      p_cargo_type: input.cargoType ?? 'Pallet', p_weight_kg: input.weightKg ?? 0,
    });
    if (error) {
      if (isMissingRelation(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to price this load');
    }
    return (data ?? {}) as AnyRecord;
  },

  'loads.post': async (input: {
    pickupLat: number; pickupLng: number; pickupAddress?: string; pickupCity?: string;
    dropoffLat: number; dropoffLng: number; dropoffAddress?: string; dropoffCity?: string;
    vehicleType: string; pallets: number; deliverySpeed: 'SameDay' | 'NextDay'; notes?: string;
    cargoType?: string; itemCount?: number; weightKg?: number;
    lengthCm?: number; widthCm?: number; heightCm?: number;
    itemDescription?: string; recipientName?: string; recipientPhone?: string;
  }) => {
    const { data, error } = await supabase.rpc('post_load', {
      p_pickup_lat: input.pickupLat, p_pickup_lng: input.pickupLng,
      p_pickup_address: input.pickupAddress ?? '', p_pickup_city: input.pickupCity ?? '',
      p_dropoff_lat: input.dropoffLat, p_dropoff_lng: input.dropoffLng,
      p_dropoff_address: input.dropoffAddress ?? '', p_dropoff_city: input.dropoffCity ?? '',
      p_vehicle_type: input.vehicleType, p_pallets: input.pallets,
      p_delivery_speed: input.deliverySpeed, p_notes: input.notes ?? '',
      p_cargo_type: input.cargoType ?? 'Pallet', p_item_count: input.itemCount ?? 1,
      p_weight_kg: input.weightKg ?? 0,
      p_length_cm: input.lengthCm ?? 0, p_width_cm: input.widthCm ?? 0, p_height_cm: input.heightCm ?? 0,
      p_item_description: input.itemDescription ?? '',
      p_recipient_name: input.recipientName ?? '', p_recipient_phone: input.recipientPhone ?? '',
    });
    if (error) {
      if (isMissingRelation(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to post load');
    }
    return { id: data as string };
  },

  'loads.listOpen': async (input: { vehicleType?: string | null; vehicleTypes?: string[] | null } | undefined) => {
    let q = supabase.from('loads').select('*').eq('status', 'Open').is('archived_at', null).order('created_at', { ascending: false }).limit(200);
    if (input?.vehicleTypes && input.vehicleTypes.length > 0) q = q.in('vehicle_type', input.vehicleTypes);
    else if (input?.vehicleType) q = q.eq('vehicle_type', input.vehicleType);
    const { data, error } = await q;
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load marketplace');
    }
    return data ?? [];
  },

  'loads.listPosted': async (_input, ctx) => {
    const { data, error } = await supabase.from('loads').select('*')
      .eq('poster_user_id', ctx.user.id).is('archived_at', null)
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load your loads');
    }
    return data ?? [];
  },

  'loads.listAccepted': async (_input, ctx) => {
    const filter = ctx.user.companyId
      ? `accepted_driver_user_id.eq.${ctx.user.id},accepted_company_id.eq.${ctx.user.companyId}`
      : `accepted_driver_user_id.eq.${ctx.user.id}`;
    const { data, error } = await supabase.from('loads').select('*')
      .or(filter).is('archived_at', null).order('updated_at', { ascending: false }).limit(200);
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load your trips');
    }
    return data ?? [];
  },

  'loads.get': async (input: { id: string }) => {
    const { data, error } = await supabase.from('loads').select('*').eq('id', input.id).maybeSingle();
    if (error || !data) throw new Error('Load not found');
    return data;
  },

  'loads.accept': async (input: { id: string }) => {
    const { error } = await supabase.rpc('accept_load', { p_load_id: input.id });
    if (error) {
      // Only the loads table itself being absent means "migrations not applied".
      // Anything else (a missing dependency column/table inside accept_load, an RLS
      // denial, a business-rule raise like "no longer available") is a REAL error and
      // must surface verbatim so it can be diagnosed instead of masked.
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to accept load');
    }
    return { success: true };
  },

  'loads.advance': async (input: { id: string; status: string }) => {
    const { error } = await supabase.rpc('advance_load', { p_load_id: input.id, p_next_status: input.status });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to update load');
    }
    return { success: true };
  },

  // Carrier (trucking) company assigns one of its drivers to an accepted load.
  'loads.dispatch': async (input: { id: string; driverUserId: string }) => {
    const { error } = await supabase.rpc('dispatch_load', { p_load_id: input.id, p_driver_user_id: input.driverUserId });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to dispatch load');
    }
    return { success: true };
  },

  // Drivers in the current user's fleet that can be dispatched. Only fleet driver
  // records linked to a registered app user (data.userId) are assignable.
  'loads.fleetDrivers': async (_input, ctx) => {
    if (!ctx.user.companyId) return [] as AnyRecord[];
    const { data, error } = await supabase.from('drivers').select('*')
      .eq('company_id', ctx.user.companyId).is('archived_at', null)
      .order('updated_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load drivers');
    }
    return (data ?? []).map((d) => {
      const row = d as AnyRecord;
      const meta = (row.data ?? {}) as AnyRecord;
      return {
        id: String(row.id),
        name: String(meta.name ?? row.name ?? 'Driver'),
        userId: meta.userId ? String(meta.userId) : null,
        email: meta.email ? String(meta.email) : null,
        phone: row.phone ? String(row.phone) : null,
        licenseNumber: row.license_number ? String(row.license_number) : null,
      };
    });
  },

  // =========================================================================
  // PAYMENTS
  // =========================================================================
  'payments.list': async (_input, ctx) => {
    let q = supabase.from('payments').select('*').order('created_at', { ascending: false });
    if (!isAdmin(ctx.user.role)) {
      if (!ctx.user.companyId) return [];
      q = q.or(`provider_company_id.eq.${ctx.user.companyId},customer_company_id.eq.${ctx.user.companyId}`);
    }
    const { data, error } = await q;
    if (error) throwErr(error, 'Unable to load payments');
    return data ?? [];
  },
  'payments.getPayment': async (input: { id: string }) => {
    const { data, error } = await supabase.from('payments').select('*').eq('id', input.id).maybeSingle();
    if (error || !data) throw new Error('Payment not found');
    return data;
  },
  'payments.listInvoices': async (_input, ctx) => {
    let q = supabase.from('invoices').select('*').order('created_at', { ascending: false });
    if (!isAdmin(ctx.user.role)) {
      if (!ctx.user.companyId) return [];
      q = q.or(`provider_company_id.eq.${ctx.user.companyId},customer_company_id.eq.${ctx.user.companyId}`);
    }
    const { data, error } = await q;
    if (error) throwErr(error, 'Unable to load invoices');
    return data ?? [];
  },
  'payments.getInvoice': async (input: { id?: string; paymentId?: string }) => {
    if (!input.id && !input.paymentId) throw new Error('Invoice identifier required');
    const q = supabase.from('invoices').select('*');
    const { data, error } = input.id
      ? await q.eq('id', input.id).maybeSingle()
      : await q.eq('payment_id', input.paymentId!).maybeSingle();
    if (error || !data) throw new Error('Invoice not found');
    return data;
  },
  'payments.updateInvoiceStatus': async (input: { id: string; status: string; method?: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Only admins can change invoice status');
    if (!input.id) throw new Error('Invoice id required');
    const now = new Date().toISOString();

    const { data: inv, error: invErr } = await supabase.from('invoices').select('*').eq('id', input.id).maybeSingle();
    if (invErr || !inv) throw new Error('Invoice not found');

    // Marking an invoice as Paid must also record a real payment so the
    // reconciliation (Collected vs Payments) stays balanced. This covers
    // manual / cash / bank-transfer collections that never went through Stripe.
    if (input.status === 'Paid') {
      if (inv.status === 'Paid') throw new Error('This invoice is already marked paid.');
      if (inv.status === 'Void') throw new Error('A voided invoice cannot be paid.');

      // Guard against double-counting: if a payment already exists (e.g. Stripe
      // captured it), just reconcile the invoice status without a second row.
      const { data: existing } = await supabase
        .from('payments').select('id').eq('invoice_id', input.id).limit(1);
      if (existing && existing.length > 0) {
        const { error } = await supabase.from('invoices')
          .update({ status: 'Paid', paid_at: now }).eq('id', input.id);
        if (error) throwErr(error, 'Unable to update invoice');
        return { success: true, reconciledExisting: true };
      }

      const gross = Number(inv.total_amount ?? 0);
      const commission = Number(inv.commission_amount ?? 0);
      const net = Math.max(0, gross - commission);
      const currency = String(inv.currency ?? 'CAD');
      const method = input.method ?? 'manual';

      const { data: pay, error: payErr } = await supabase.from('payments').insert({
        invoice_id: inv.id,
        booking_id: inv.booking_id ?? null,
        customer_company_id: inv.customer_company_id ?? null,
        provider_company_id: inv.provider_company_id ?? null,
        gross_amount: gross,
        commission_amount: commission,
        net_amount: net,
        currency,
        status: 'Captured',
        payment_method: method,
        authorized_at: now,
        captured_at: now,
      }).select('id').single();
      if (payErr) throwErr(payErr, 'Unable to record payment');

      const { error: updErr } = await supabase.from('invoices')
        .update({ status: 'Paid', paid_at: now, payment_id: pay!.id }).eq('id', input.id);
      if (updErr) throwErr(updErr, 'Unable to update invoice');

      // Queue a payout to the provider for the net amount.
      if (inv.provider_company_id) {
        await supabase.from('payouts').insert({
          company_id: inv.provider_company_id,
          payment_id: pay!.id,
          gross_amount: gross,
          commission_amount: commission,
          net_amount: net,
          currency,
          status: 'Pending',
        });
      }
      return { success: true, paymentId: pay!.id };
    }

    const patch: AnyRecord = { status: input.status };
    if (input.status === 'Issued') patch.issued_at = now;
    else if (input.status === 'Void') patch.voided_at = now;
    const { error } = await supabase.from('invoices').update(patch).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update invoice');
    return { success: true };
  },
  'payments.listPayouts': async (_input, ctx) => {
    const q = supabase.from('payouts').select('*').is('archived_at', null).order('created_at', { ascending: false });
    const { data, error } = isAdmin(ctx.user.role)
      ? await q
      : ctx.user.companyId ? await q.eq('company_id', ctx.user.companyId) : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load payouts');
    return data ?? [];
  },
  'payments.getPayout': async (input: { id: string }) => {
    const { data, error } = await supabase.from('payouts').select('*').eq('id', input.id).maybeSingle();
    if (error || !data) throw new Error('Payout not found');
    return data;
  },
  'payments.updatePayoutStatus': async (input: { id: string; status: string }) => {
    const { error } = await supabase.from('payouts').update({ status: input.status }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update payout');
    return { success: true };
  },

  // =========================================================================
  // MESSAGING (thread-based)
  // =========================================================================
  'messaging.listThreads': async (_input, ctx) => {
    const { data: parts } = await supabase
      .from('thread_participants').select('thread_id').eq('user_id', ctx.user.id);
    const ids = (parts ?? []).map((p) => p.thread_id);
    if (ids.length === 0) return [];
    const { data: threads } = await supabase
      .from('chat_threads').select('*').in('id', ids).order('updated_at', { ascending: false });
    return threads ?? [];
  },

  'messaging.createThread': async (input: AnyRecord, ctx) => {
    const { data, error } = await supabase.from('chat_threads').insert({
      scope: input.scope,
      booking_id: input.bookingId ?? null,
      company_id: input.companyId ?? ctx.user.companyId ?? null,
      subject: input.subject ?? '',
      created_by: ctx.user.id,
    }).select().single();
    if (error) throwErr(error, 'Unable to create thread');
    await supabase.from('thread_participants').insert({ thread_id: data!.id, user_id: ctx.user.id });
    return { id: data!.id };
  },

  'messaging.openShiftThread': async (input: { shiftId: string }) => {
    const { data, error } = await supabase.rpc('open_shift_thread', { p_shift_id: input.shiftId });
    if (error) throwErr(error, 'Unable to open conversation');
    return { threadId: data as string };
  },

  // Opens (or reuses) the caller's direct conversation with the dock2door support team.
  'messaging.openSupportThread': async () => {
    const { data, error } = await supabase.rpc('open_support_thread');
    if (error) throwErr(error, 'Unable to contact support');
    return { threadId: data as string };
  },

  // Returns the counterpart's name + phone for an in-app tap-to-call button.
  'messaging.threadCallContact': async (input: { threadId: string }) => {
    const { data, error } = await supabase.rpc('thread_call_contact', { p_thread_id: input.threadId });
    if (error) throwErr(error, 'Unable to load contact');
    const row = Array.isArray(data) ? (data[0] as { name?: string; phone?: string } | undefined) : null;
    return { name: row?.name ?? null, phone: (row?.phone ?? '').trim() || null };
  },

  // Posts a message authored by the AI assistant (or a system note) into a
  // support thread. Stored with sender = the caller (the only id RLS allows)
  // but author_kind != 'user' so the UI renders it as the assistant/system.
  'messaging.sendSupportReply': async (
    input: { threadId: string; body: string; authorKind?: 'ai' | 'system' },
    ctx,
  ) => {
    const { data, error } = await supabase.from('thread_messages').insert({
      thread_id: input.threadId,
      sender_user_id: ctx.user.id,
      body: input.body,
      attachments: [],
      author_kind: input.authorKind ?? 'ai',
    }).select().single();
    if (error) throwErr(error, 'Unable to post reply');
    await supabase.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', input.threadId);
    return { id: data!.id };
  },

  // Hands an AI support conversation over to real humans: joins all admins and
  // flips the thread's support_status to 'human'.
  'messaging.escalateSupport': async (input: { threadId: string }) => {
    const { error } = await supabase.rpc('escalate_support_thread', { p_thread_id: input.threadId });
    if (error) throwErr(error, 'Unable to reach a human agent');
    return { success: true };
  },

  // Admin/super-admin support inbox: every Support conversation across all users.
  'messaging.listSupportThreads': async () => {
    const { data, error } = await supabase.rpc('list_support_threads');
    if (error) throwErr(error, 'Unable to load support inbox');
    return data ?? [];
  },

  // Admin joins a thread (becomes a participant) so they can read + reply.
  'messaging.adminJoinThread': async (input: { threadId: string }) => {
    const { error } = await supabase.rpc('admin_join_thread', { p_thread_id: input.threadId });
    if (error) throwErr(error, 'Unable to open conversation');
    return { success: true };
  },

  'messaging.getThread': async (input: { threadId: string }) => {
    const { data, error } = await supabase.from('chat_threads').select('*').eq('id', input.threadId).maybeSingle();
    if (error || !data) throw new Error('Thread not found');
    return data;
  },

  'messaging.listMessages': async (input: { threadId: string }) => {
    const { data, error } = await supabase
      .from('thread_messages').select('*').eq('thread_id', input.threadId).order('created_at');
    if (error) throwErr(error, 'Unable to load messages');
    return data ?? [];
  },

  'messaging.sendMessage': async (input: { threadId: string; body: string; attachments?: any[] }, ctx) => {
    const { data, error } = await supabase.from('thread_messages').insert({
      thread_id: input.threadId,
      sender_user_id: ctx.user.id,
      body: input.body,
      attachments: input.attachments ?? [],
    }).select().single();
    if (error) throwErr(error, 'Unable to send message');
    await supabase.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', input.threadId);
    return { id: data!.id };
  },

  'messaging.markThreadRead': async (input: { threadId: string }, ctx) => {
    await supabase.from('thread_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('thread_id', input.threadId)
      .eq('user_id', ctx.user.id);
    return { success: true };
  },

  // =========================================================================
  // NOTIFICATIONS
  // =========================================================================
  'notifications.list': async (_input, ctx) => {
    const { data } = await supabase.from('notifications').select('*').eq('user_id', ctx.user.id).order('created_at', { ascending: false });
    return data ?? [];
  },
  'notifications.markRead': async (input: { id: string }) => {
    // DB has both `read` (boolean, migration 0001) and `read_at` (timestamp, 0014).
    // The UI reads the `read` boolean, so set BOTH or the card stays "unread".
    const { error } = await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', input.id);
    if (error) throwErr(error, 'Unable to mark notification');
    return { success: true };
  },

  // =========================================================================
  // ADMIN
  // =========================================================================
  'admin.dashboard': async () => {
    const [users, companies, bookings, disputes, pendingCerts, pendingCompanies, pendingWarehouseListings, pendingServiceListings] = await Promise.all([
      supabase.from('profiles').select('id,email,name,role,status,company_id,created_at').limit(200),
      supabase.from('companies').select('*').limit(200),
      supabase.from('warehouse_bookings').select('*').limit(200),
      supabase.from('disputes').select('*').limit(200),
      supabase.from('worker_certifications').select('id').eq('status', 'Pending'),
      supabase.from('companies').select('id').eq('status', 'PendingApproval'),
      supabase.from('warehouse_listings').select('id').eq('status', 'PendingApproval'),
      supabase.from('service_listings').select('id').eq('status', 'PendingApproval'),
    ]);
    return {
      users: users.data ?? [], companies: companies.data ?? [],
      bookings: bookings.data ?? [], disputes: disputes.data ?? [], audits: [],
      // Pending counts for admin/super-admin work queue
      pendingCertCount: pendingCerts.data?.length ?? 0,
      pendingCompanyCount: pendingCompanies.data?.length ?? 0,
      pendingListingCount: (pendingWarehouseListings.data?.length ?? 0) + (pendingServiceListings.data?.length ?? 0),
      openDisputeCount: (disputes.data ?? []).filter((d) => d.status === 'Open' || d.status === 'UnderReview').length,
    };
  },

  // admin.listEntity — strict allowlist prevents arbitrary table enumeration.
  // Add new entries here explicitly; never allow pass-through of unknown entity names.
  // UI aliases: 'bookings' → warehouse_bookings, 'dock_appointments' → gate_events
  'admin.listEntity': async (input: { entity: string }) => {
    const ENTITY_TABLE: Record<string, string> = {
      users:              'profiles',
      companies:          'companies',
      disputes:           'disputes',
      bookings:           'warehouse_bookings',   // UI alias
      warehouse_bookings: 'warehouse_bookings',
      warehouse_listings: 'warehouse_listings',
      service_listings:   'service_listings',
      service_jobs:       'service_jobs',
      products:           'products',
      payments:           'payments',
      invoices:           'invoices',
      payouts:            'payouts',
      commission_rules:   'commission_rules',
      tax_rules:          'tax_rules',
      message_threads:    'chat_threads',
      notifications:      'notifications',
      audit_logs:         'audit_logs',
      shift_posts:        'shift_posts',
      shift_applications: 'shift_applications',
      shift_assignments:  'shift_assignments',
      dock_appointments:  'gate_events',          // UI alias → gate_events table (migration 0014)
    };
    const table = ENTITY_TABLE[input.entity];
    if (!table) throw new Error(`admin.listEntity: "${input.entity}" is not in the allowed entity list`);
    // gate_events is append-only and ordered by occurred_at (it has no created_at column).
    const orderColumn = table === 'gate_events' ? 'occurred_at' : 'created_at';
    const { data, error } = await supabase.from(table).select('*').order(orderColumn, { ascending: false }).limit(200);
    // Never swallow query/RLS errors into an empty list — that disguises real backend
    // failures as "No records". Surface the message so the UI can show a clear error.
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  // admin.getEntityRecord / updateEntityStatus / archiveEntity — same strict allowlist as
  // admin.listEntity to prevent arbitrary table enumeration or writes via entity name.
  // Status mutations for companies/users/listings should prefer the audited RPCs:
  //   admin.setCompanyStatus  → admin_set_company_status
  //   admin.setUserStatus     → admin_set_user_status
  //   warehouses.setListingStatus / services.setListingStatus → admin_set_*_status
  'admin.getEntityRecord': async (input: { entity: string; id: string }) => {
    if (!input.id) return null;
    const ENTITY_TABLE: Record<string, string> = {
      users:              'profiles',
      companies:          'companies',
      disputes:           'disputes',
      bookings:           'warehouse_bookings',
      warehouse_bookings: 'warehouse_bookings',
      warehouse_listings: 'warehouse_listings',
      service_listings:   'service_listings',
      service_jobs:       'service_jobs',
      products:           'products',
      payments:           'payments',
      invoices:           'invoices',
      payouts:            'payouts',
      commission_rules:   'commission_rules',
      tax_rules:          'tax_rules',
      message_threads:    'chat_threads',
      notifications:      'notifications',
      audit_logs:         'audit_logs',
      shift_posts:        'shift_posts',
      shift_applications: 'shift_applications',
      shift_assignments:  'shift_assignments',
      dock_appointments:  'gate_events',
    };
    const table = ENTITY_TABLE[input.entity];
    if (!table) throw new Error(`admin.getEntityRecord: "${input.entity}" is not in the allowed entity list`);
    const { data } = await supabase.from(table).select('*').eq('id', input.id).maybeSingle();
    return data;
  },

  'admin.updateEntityStatus': async (input: { entity: string; id: string; status: string; reason?: string }) => {
    // Audited paths — companies, users, and listings route through SECURITY DEFINER RPCs
    // that capture before/after JSONB and write audit_logs.
    const isNegative = ['Suspended', 'Rejected', 'Inactive', 'Voided', 'Cancelled'].includes(input.status);
    const trimmed = (input.reason ?? '').trim();
    if (isNegative && trimmed.length < 5) {
      throw new Error(`A specific reason (min 5 characters) is required when setting ${input.entity} to ${input.status}.`);
    }
    const reason = trimmed.length >= 5 ? trimmed : `${input.entity} status reviewed by admin`;

    if (input.entity === 'users') {
      const { error } = await supabase.rpc('admin_set_user_status', {
        p_user_id: input.id, p_status: input.status, p_reason: reason,
      });
      if (error) throwErr(error, 'Unable to update user status — check admin privileges');
      return { success: true };
    }
    if (input.entity === 'companies') {
      const { error } = await supabase.rpc('admin_set_company_status', {
        p_company_id: input.id, p_status: input.status, p_reason: reason,
      });
      if (error) throwErr(error, 'Unable to update company status — check admin privileges');
      return { success: true };
    }
    if (input.entity === 'warehouse_listings') {
      const { error } = await supabase.rpc('admin_set_listing_status', {
        p_listing_id: input.id, p_status: input.status, p_reason: reason,
      });
      if (error) throwErr(error, 'Unable to update listing status — check admin privileges');
      return { success: true };
    }
    if (input.entity === 'service_listings') {
      const { error } = await supabase.rpc('admin_set_service_listing_status', {
        p_listing_id: input.id, p_status: input.status, p_reason: reason,
      });
      if (error) throwErr(error, 'Unable to update service listing status — check admin privileges');
      return { success: true };
    }
    // Everything else is read-only here. Business state machines (shifts, bookings,
    // service_jobs, payments, invoices, certifications, time_entries) must use their
    // proper workflow RPCs (cancel_shift_with_reason, transition_booking,
    // transition_service_job, admin_initiate_refund, admin_approve_certification, etc.).
    throw new Error(
      `"${input.entity}" is read-only here. Use the proper workflow screen — direct status updates would skip audit and state-machine checks.`,
    );
  },

  'admin.archiveEntity': async (input: { entity: string; id: string; reason?: string }) => {
    const reason = (input.reason && input.reason.trim().length >= 5)
      ? input.reason.trim()
      : 'Archived via admin panel';

    // Only users and companies have a safe audited archive path. Everything else is
    // a business entity (booking, invoice, shift, etc.) whose lifecycle must go
    // through its own RPC — silent archive would bypass audit and state-machine.
    if (input.entity === 'users') {
      const { error } = await supabase.rpc('admin_set_user_status', {
        p_user_id: input.id, p_status: 'Inactive', p_reason: reason,
      });
      if (error) throwErr(error, 'Unable to archive user — check admin privileges');
      return { success: true };
    }
    if (input.entity === 'companies') {
      const { error } = await supabase.rpc('admin_set_company_status', {
        p_company_id: input.id, p_status: 'Suspended', p_reason: reason,
      });
      if (error) throwErr(error, 'Unable to archive company — check admin privileges');
      return { success: true };
    }
    throw new Error(
      `"${input.entity}" cannot be archived from Data Manager. Use the proper workflow screen — direct archives would skip audit and state-machine checks.`,
    );
  },

  // admin.setCompanyStatus routes through admin_set_company_status SECURITY DEFINER RPC (0007)
  // which asserts is_admin(), captures before/after JSONB, and writes to audit_logs.
  // Negative statuses (Suspended / Rejected) require a real reason (min 5 chars) so the
  // audit log + worker/employer notification is useful, not generic.
  'admin.setCompanyStatus': async (input: { companyId: string; status: string; reason?: string }) => {
    const isNegative = ['Suspended', 'Rejected', 'Inactive'].includes(input.status);
    const reason = (input.reason ?? '').trim();
    if (isNegative && reason.length < 5) {
      throw new Error('A specific reason (min 5 characters) is required when suspending or rejecting a company.');
    }
    const { error } = await supabase.rpc('admin_set_company_status', {
      p_company_id: input.companyId,
      p_status: input.status,
      p_reason: reason || `Company status set to ${input.status} by admin`,
    });
    if (error) throwErr(error, 'Unable to update company — check admin privileges');
    return { success: true };
  },

  // admin.setUserStatus routes through admin_set_user_status SECURITY DEFINER RPC (0007).
  'admin.setUserStatus': async (input: { userId: string; status: string; reason?: string }) => {
    const isNegative = ['Suspended', 'Inactive', 'Rejected'].includes(input.status);
    const reason = (input.reason ?? '').trim();
    if (isNegative && reason.length < 5) {
      throw new Error('A specific reason (min 5 characters) is required when suspending or deactivating a user.');
    }
    const { error } = await supabase.rpc('admin_set_user_status', {
      p_user_id: input.userId,
      p_status: input.status,
      p_reason: reason || `User status set to ${input.status} by admin`,
    });
    if (error) throwErr(error, 'Unable to update user — check admin privileges');
    return { success: true };
  },

  'admin.auditLogs': async (input: AnyRecord) => {
    let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(Number(input.limit ?? 200));
    if (input.entity) q = q.eq('entity', input.entity as string);
    if (input.entityId) q = q.eq('entity_id', input.entityId as string);
    if (input.companyId) q = q.eq('company_id', input.companyId as string);
    if (input.actorUserId) q = q.eq('actor_user_id', input.actorUserId as string);
    const { data } = await q;
    return data ?? [];
  },

  'admin.listCommissionRules': async () => {
    const { data } = await supabase.from('commission_rules').select('*').order('scope');
    return data ?? [];
  },
  'admin.upsertCommissionRule': async (input: AnyRecord) => {
    if (input.id) {
      await supabase.from('commission_rules').update({
        scope: input.module ?? input.scope,
        percentage: input.percentage,
        active: input.active ?? true,
      }).eq('id', input.id as string);
      return { id: input.id };
    }
    const { data, error } = await supabase.from('commission_rules').insert({
      scope: input.module ?? input.scope,
      percentage: input.percentage,
      active: input.active ?? true,
    }).select().single();
    if (error) throwErr(error, 'Unable to save rule');
    return { id: data!.id };
  },

  'admin.listTaxRules': async () => {
    const { data } = await supabase.from('tax_rules').select('*').order('region');
    return data ?? [];
  },
  'admin.upsertTaxRule': async (input: AnyRecord) => {
    if (input.id) {
      await supabase.from('tax_rules').update({
        region: input.jurisdiction ?? input.region,
        name: input.appliesTo ?? input.name ?? '',
        percentage: input.rate ?? input.percentage,
        active: input.active ?? true,
      }).eq('id', input.id as string);
      return { id: input.id };
    }
    const { data, error } = await supabase.from('tax_rules').insert({
      region: input.jurisdiction ?? input.region,
      name: input.appliesTo ?? input.name ?? '',
      percentage: input.rate ?? input.percentage,
      active: input.active ?? true,
    }).select().single();
    if (error) throwErr(error, 'Unable to save rule');
    return { id: data!.id };
  },

  'admin.listFeatureFlags': async () => {
    const { data } = await supabase.from('feature_flags').select('*').order('key');
    return data ?? [];
  },
  'admin.upsertFeatureFlag': async (input: AnyRecord) => {
    const { error } = await supabase.from('feature_flags').upsert({
      key: input.key,
      description: input.description ?? '',
      enabled: input.enabled ?? false,
    }, { onConflict: 'key' });
    if (error) throwErr(error, 'Unable to save flag');
    return { success: true };
  },

  'admin.getPlatformSettings': async () => {
    const { data } = await supabase.from('platform_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    return data ?? { id: null, data: {}, updated_at: null };
  },
  // admin.updatePlatformSettings — audited via admin_update_platform_settings RPC.
  // No direct UPDATE/INSERT on platform_settings (would bypass require_admin + audit_logs).
  'admin.updatePlatformSettings': async (input: { data: AnyRecord }) => {
    const { error } = await supabase.rpc('admin_update_platform_settings', {
      p_warehouse_commission_percentage: Number(input.data.warehouseCommissionPercentage ?? 8),
      p_service_commission_percentage: Number(input.data.serviceCommissionPercentage ?? 20),
      p_labour_commission_percentage: Number(input.data.labourCommissionPercentage ?? 15),
      p_handling_fee_per_pallet_default: Number(input.data.handlingFeePerPalletDefault ?? 12),
      p_tax_mode: String(input.data.taxMode ?? 'GST+PST'),
      p_trucking_commission_percentage: Number(input.data.truckingCommissionPercentage ?? 12),
      p_trucking_booking_fee: Number(input.data.truckingBookingFee ?? 5),
    });
    if (error) throwErr(error, 'Unable to update platform settings — admin only');
    const { data: row } = await supabase.from('platform_settings').select('id').limit(1).maybeSingle();
    return { id: row?.id ?? null };
  },

  // =========================================================================
  // ANALYTICS
  // =========================================================================
  // commissionBreakdown — platform commission earned by marketplace area, derived
  // from settled payments. Trucking loads tag payments with category='trucking';
  // older payments are inferred from their linked booking / invoice.
  'analytics.commissionBreakdown': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const settled = ['Captured', 'Paid'];
    const { data: payments } = await supabase
      .from('payments')
      .select('commission_amount,category,booking_id,invoice_id,status');
    const rows = (payments ?? []).filter((p) => settled.includes(String(p.status)));
    const invoiceIds = Array.from(new Set(rows.map((r) => r.invoice_id).filter(Boolean))) as string[];
    const [invRes, wpRes] = await Promise.all([
      invoiceIds.length ? supabase.from('invoices').select('id,service_job_id,booking_id').in('id', invoiceIds) : Promise.resolve({ data: [] as AnyRecord[] }),
      invoiceIds.length ? supabase.from('worker_payables').select('invoice_id').in('invoice_id', invoiceIds) : Promise.resolve({ data: [] as AnyRecord[] }),
    ]);
    const invById = new Map<string, AnyRecord>((invRes.data ?? []).map((i: AnyRecord) => [String(i.id), i]));
    const labourInvoices = new Set((wpRes.data ?? []).map((w: AnyRecord) => String(w.invoice_id)));
    const totals = { warehouse: 0, service: 0, labour: 0, trucking: 0, other: 0, total: 0 };
    for (const r of rows) {
      const amt = Number(r.commission_amount ?? 0);
      if (amt <= 0) continue;
      totals.total += amt;
      const cat = String(r.category ?? '');
      const inv = r.invoice_id ? invById.get(String(r.invoice_id)) : null;
      if (cat === 'trucking') totals.trucking += amt;
      else if (r.booking_id || inv?.booking_id) totals.warehouse += amt;
      else if (inv?.service_job_id) totals.service += amt;
      else if (r.invoice_id && labourInvoices.has(String(r.invoice_id))) totals.labour += amt;
      else totals.other += amt;
    }
    return totals;
  },

  'analytics.overview': async () => {
    const [bookings, payments, companies, disputes] = await Promise.all([
      supabase.from('warehouse_bookings').select('id,status,proposed_price,final_price'),
      supabase.from('payments').select('gross_amount,status'),
      supabase.from('companies').select('id,status'),
      supabase.from('disputes').select('id,status'),
    ]);
    const gmv = (payments.data ?? [])
      .filter((p) => p.status === 'Paid')
      .reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);
    return {
      totalBookings: bookings.data?.length ?? 0,
      grossBookingValue: gmv,
      activeCompanies: (companies.data ?? []).filter((c) => c.status === 'Approved').length,
      openDisputes: (disputes.data ?? []).filter((d) => d.status === 'Open' || d.status === 'UnderReview').length,
    };
  },

  // =========================================================================
  // SERVICE JOBS — provider + customer flows (audited via DB triggers/RPCs)
  // =========================================================================
  'serviceJobs.listMine': async (_input, ctx) => {
    if (!ctx.user.companyId && !isAdmin(ctx.user.role)) return [];
    const q = supabase.from('service_jobs').select('*').order('created_at', { ascending: false });
    const { data, error } = isAdmin(ctx.user.role)
      ? await q
      : await q.or(`customer_company_id.eq.${ctx.user.companyId},provider_company_id.eq.${ctx.user.companyId}`);
    if (error) throwErr(error, 'Unable to load service jobs');
    return (data ?? []).map(mapServiceJob);
  },

  'serviceJobs.create': async (input: {
    serviceId: string; customerCompanyId?: string;
    locationAddress: string; locationCity: string;
    dateTimeStart: string; durationHours: number;
    notes?: string; totalPrice?: number;
  }, ctx) => {
    const cid = input.customerCompanyId ?? ctx.user.companyId;
    if (!cid) throw new Error('Company context required');
    const { data, error } = await supabase.from('service_jobs').insert({
      service_id: input.serviceId,
      customer_company_id: cid,
      location_address: input.locationAddress,
      location_city: input.locationCity,
      date_time_start: input.dateTimeStart,
      duration_hours: input.durationHours,
      notes: input.notes ?? '',
      total_price: input.totalPrice ?? 0,
      status: 'Requested',
      payment_status: 'Pending',
    }).select().single();
    if (error) throwErr(error, 'Unable to create service job');
    return { id: data!.id };
  },

  'serviceJobs.accept': async (input: { id: string; reason?: string }) => {
    const { error } = await supabase.rpc('transition_service_job', {
      p_job_id: input.id, p_next_status: 'Accepted',
      p_reason: input.reason ?? null, p_check_in: false, p_check_out: false,
    });
    if (error) throwErr(error, 'Unable to accept job');
    return { success: true };
  },
  'serviceJobs.decline': async (input: { id: string; reason?: string }) => {
    const { error } = await supabase.rpc('transition_service_job', {
      p_job_id: input.id, p_next_status: 'Cancelled',
      p_reason: input.reason ?? 'Declined by provider', p_check_in: false, p_check_out: false,
    });
    if (error) throwErr(error, 'Unable to decline job');
    return { success: true };
  },
  'serviceJobs.checkIn': async (input: { id: string }) => {
    const { error } = await supabase.rpc('transition_service_job', {
      p_job_id: input.id, p_next_status: 'InProgress',
      p_reason: 'Provider checked in', p_check_in: true, p_check_out: false,
    });
    if (error) throwErr(error, 'Unable to check in');
    return { success: true };
  },
  'serviceJobs.complete': async (input: { id: string; reason?: string }) => {
    const { error } = await supabase.rpc('transition_service_job', {
      p_job_id: input.id, p_next_status: 'Completed',
      p_reason: input.reason ?? 'Completed by provider', p_check_in: false, p_check_out: true,
    });
    if (error) throwErr(error, 'Unable to complete job');
    return { success: true };
  },

  // =========================================================================
  // SHIFTS / LABOUR
  // =========================================================================
  'shifts.listOpen': async () => {
    const { data, error } = await supabase.from('shift_posts').select('*').eq('status', 'Posted').order('date');
    if (error) throwErr(error, 'Unable to load shifts');
    return data ?? [];
  },
  'shifts.listMineEmployer': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase.from('shift_posts').select('*').eq('employer_company_id', ctx.user.companyId).order('created_at', { ascending: false });
    if (error) throwErr(error, 'Unable to load shifts');
    return data ?? [];
  },
  'shifts.create': async (input: AnyRecord, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { data, error } = await supabase.from('shift_posts').insert({
      employer_company_id: ctx.user.companyId,
      title: input.title,
      category: input.category,
      location_address: input.locationAddress ?? '',
      location_city: input.locationCity ?? '',
      date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      hourly_rate: input.hourlyRate ?? null,
      flat_rate: input.flatRate ?? null,
      minimum_hours: input.minimumHours ?? 1,
      workers_needed: input.workersNeeded ?? 1,
      requirements: input.requirements ?? '',
      notes: input.notes ?? '',
      status: 'Posted',
    }).select().single();
    if (error) throwErr(error, 'Unable to create shift');
    return { id: data!.id };
  },
  // shifts.setStatus — all transitions are routed through audited RPCs. No direct shift_posts UPDATE.
  // Cancelled  → cancel_shift_with_reason (0024)
  // Completed  → employer_close_shift_post (0049) — validates all assignments are terminal first
  // InProgress / Posted → provider_set_shift_status (0050)
  'shifts.setStatus': async (input: { id: string; status: string; reason?: string }) => {
    if (input.status === 'Cancelled') {
      const reason = (input.reason ?? '').trim();
      if (reason.length < 5) throw new Error('Cancellation reason required (min 5 characters) — workers will see this.');
      const { error } = await supabase.rpc('cancel_shift_with_reason', {
        p_shift_id: input.id,
        p_reason: reason,
      });
      if (error) throwErr(error, 'Unable to cancel shift');
    } else if (input.status === 'Completed') {
      const { error } = await supabase.rpc('employer_close_shift_post', {
        p_shift_id: input.id,
        p_reason: input.reason ?? 'Shift closed by employer',
      });
      if (error) throwErr(error, 'Unable to close shift — ensure all workers are confirmed or marked no-show first');
    } else if (input.status === 'InProgress' || input.status === 'Posted') {
      const { error } = await supabase.rpc('provider_set_shift_status', {
        p_shift_id: input.id,
        p_status: input.status,
        p_reason: input.reason ?? null,
      });
      if (error) throwErr(error, `Unable to set shift to ${input.status}`);
    } else {
      throw new Error(`shifts.setStatus: status "${input.status}" is not a valid self-serve transition`);
    }
    return { success: true };
  },
  'shifts.update': async (input: { id: string; title: string; date: string; startTime: string; endTime: string; workersNeeded: number; hourlyRate: number; requirements?: string; notes?: string; reason?: string }) => {
    const { error } = await supabase.rpc('employer_update_shift', {
      p_shift_id: input.id, p_title: input.title, p_date: input.date, p_start: input.startTime, p_end: input.endTime,
      p_workers_needed: input.workersNeeded, p_hourly_rate: input.hourlyRate, p_requirements: input.requirements ?? '', p_notes: input.notes ?? '', p_reason: input.reason ?? '',
    });
    if (error) throwErr(error, 'Unable to update shift');
    return { success: true };
  },
  'shifts.adminAssign': async (input: { shiftId: string; workerUserId: string; rate?: number; replaceAssignmentId?: string; reason?: string }) => {
    const { data, error } = await supabase.rpc('admin_assign_worker_to_shift', {
      p_shift_id: input.shiftId, p_worker_user_id: input.workerUserId, p_rate: input.rate ?? null, p_replace_assignment_id: input.replaceAssignmentId ?? null, p_reason: input.reason ?? 'Admin assignment',
    });
    if (error) throwErr(error, 'Unable to assign worker');
    return { assignmentId: data as string };
  },
  'shifts.markNoShow': async (input: { shiftId: string; workerUserId: string; reason: string }) => {
    const { error } = await supabase.rpc('mark_shift_no_show', { p_shift_id: input.shiftId, p_worker_user_id: input.workerUserId, p_reason: input.reason });
    if (error) throwErr(error, 'Unable to mark no-show');
    return { success: true };
  },
  'shifts.adminApproveTimeEntry': async (input: { timeEntryId: string; reason?: string }) => {
    const { error } = await supabase.rpc('admin_approve_time_entry', { p_time_entry_id: input.timeEntryId, p_reason: input.reason ?? 'Approved for payroll' });
    if (error) throwErr(error, 'Unable to approve time entry');
    return { success: true };
  },
  'shifts.apply': async (input: { shiftId: string }) => {
    const { data, error } = await supabase.rpc('worker_apply_shift', { p_shift_id: input.shiftId });
    if (error) throwErr(error, 'Unable to apply');
    return { id: data as string };
  },
  // shifts.withdraw — routed through worker_withdraw_shift (0060) which verifies ownership,
  // gates valid status (Applied only), writes audit, and notifies the employer.
  'shifts.withdraw': async (input: { applicationId: string }) => {
    const { error } = await supabase.rpc('worker_withdraw_shift', { p_application_id: input.applicationId });
    if (error) throwErr(error, 'Unable to withdraw');
    return { success: true };
  },
  'shifts.acceptApplicant': async (input: { applicationId: string; rate?: number }) => {
    const { data, error } = await supabase.rpc('employer_accept_applicant', {
      p_application_id: input.applicationId, p_rate: input.rate ?? null,
    });
    if (error) throwErr(error, 'Unable to accept applicant');
    // Worker notification is queued inside employer_accept_applicant (migration 0036).
    return { assignmentId: data as string };
  },
  'shifts.rejectApplicant': async (input: { applicationId: string; reason?: string }) => {
    const { error } = await supabase.rpc('employer_reject_applicant', {
      p_application_id: input.applicationId, p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to reject');
    // Worker notification is queued inside employer_reject_applicant (migration 0058).
    return { success: true };
  },
  'shifts.clockIn': async (input: { assignmentId: string; lat?: number; lng?: number; accuracy?: number }) => {
    const { data, error } = await supabase.rpc('worker_clock_in', {
      p_assignment_id: input.assignmentId,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_accuracy: input.accuracy ?? null,
    });
    if (error) throwErr(error, 'Unable to clock in');
    return { timeEntryId: data as string };
  },
  'shifts.clockOut': async (input: { assignmentId: string; lat?: number; lng?: number }) => {
    const { error } = await supabase.rpc('worker_clock_out', {
      p_assignment_id: input.assignmentId,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
    });
    if (error) throwErr(error, 'Unable to clock out');
    return { success: true };
  },
  'shifts.closeShift': async (input: { shiftId: string; reason?: string }) => {
    const { error } = await supabase.rpc('employer_close_shift_post', {
      p_shift_id: input.shiftId,
      p_reason: input.reason ?? 'Shift closed by employer',
    });
    if (error) throwErr(error, 'Unable to close shift — ensure all assignments are in a terminal state');
    return { success: true };
  },
  'shifts.confirmAttendance': async (input: { assignmentId: string; confirmed: boolean; reason?: string }) => {
    const { error } = await supabase.rpc('worker_confirm_attendance', {
      p_assignment_id: input.assignmentId,
      p_confirmed: input.confirmed,
      p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, input.confirmed ? 'Unable to confirm attendance' : 'Unable to cancel attendance — a reason is required');
    return { success: true };
  },
  'shifts.confirmHours': async (input: { timeEntryId: string; hours: number; notes?: string }) => {
    const { error } = await supabase.rpc('employer_confirm_hours', {
      p_time_entry_id: input.timeEntryId, p_hours: input.hours, p_notes: input.notes ?? '',
    });
    if (error) throwErr(error, 'Unable to confirm hours');
    // Worker notification is queued inside employer_confirm_hours (migration 0079).
    return { success: true };
  },

  // =========================================================================
  // COMPANY STAFF
  // =========================================================================
  'company.listMembers': async (input: { companyId: string }) => {
    const { data, error } = await supabase
      .from('company_users')
      .select('id,user_id,company_role,status,profiles(id,name,email,role)')
      .eq('company_id', input.companyId);
    if (error) throwErr(error, 'Unable to load staff');
    return data ?? [];
  },
  'company.addMember': async (input: { companyId: string; userId: string; role?: string; reason?: string }) => {
    const role = input.role ?? 'Staff';
    const { error: e2 } = await supabase.rpc('company_add_member_v2', {
      p_company_id: input.companyId, p_user_id: input.userId, p_role: role, p_reason: input.reason ?? null,
    });
    if (e2) {
      const { error } = await supabase.rpc('company_add_member', {
        p_company_id: input.companyId, p_user_id: input.userId, p_role: role,
      });
      if (error) throwErr(error, 'Unable to add member');
    }
    return { success: true };
  },
  'company.updateMemberRole': async (input: { companyId: string; userId: string; role: string; reason?: string }) => {
    const { error } = await supabase.rpc('company_update_member_role', {
      p_company_id: input.companyId, p_user_id: input.userId, p_role: input.role, p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to update role');
    return { success: true };
  },
  'company.setMemberStatus': async (input: { companyId: string; userId: string; status: 'Active' | 'Suspended' | 'Inactive'; reason?: string }) => {
    const { error } = await supabase.rpc('company_set_member_status', {
      p_company_id: input.companyId, p_user_id: input.userId, p_status: input.status, p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to update status');
    return { success: true };
  },
  'company.removeMember': async (input: { companyId: string; userId: string; reason: string }) => {
    const { error } = await supabase.rpc('company_remove_member', {
      p_company_id: input.companyId, p_user_id: input.userId, p_reason: input.reason,
    });
    if (error) throwErr(error, 'Unable to remove member');
    return { success: true };
  },
  'company.findUserByEmail': async (input: { email: string }) => {
    const { data } = await supabase.from('profiles').select('id,name,email').eq('email', input.email.trim().toLowerCase()).maybeSingle();
    return data;
  },

  // =========================================================================
  // ADMIN — audited status mutations
  // =========================================================================
  'admin.setCompanyStatusAudited': async (input: { companyId: string; status: string; reason?: string }) => {
    const { error } = await supabase.rpc('admin_set_company_status', {
      p_company_id: input.companyId, p_status: input.status, p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to update company');
    return { success: true };
  },
  'admin.setUserStatusAudited': async (input: { userId: string; status: string; reason?: string }) => {
    const { error } = await supabase.rpc('admin_set_user_status', {
      p_user_id: input.userId, p_status: input.status, p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to update user');
    return { success: true };
  },
  'admin.setListingStatusAudited': async (input: { listingId: string; status: string; reason?: string }) => {
    const { error } = await supabase.rpc('admin_set_listing_status', {
      p_listing_id: input.listingId, p_status: input.status, p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to update listing');
    return { success: true };
  },

  // =========================================================================
  // CERTIFICATIONS
  // =========================================================================
  'certifications.listMine': async (_input, ctx) => {
    const { data, error } = await supabase
      .from('worker_certifications')
      .select('*')
      .eq('worker_user_id', ctx.user.id)
      .order('created_at', { ascending: false });
    if (error) throwErr(error, 'Unable to load certifications');
    return data ?? [];
  },

  'certifications.listPending': async () => {
    const { data, error } = await supabase
      .from('worker_certifications')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throwErr(error, 'Unable to load certifications');
    return data ?? [];
  },

  'certifications.create': async (
    input: { type: string; expiryDate: string | null; filePath: string; notes?: string },
    ctx,
  ) => {
    const { data, error } = await supabase.from('worker_certifications').insert({
      worker_user_id: ctx.user.id,
      type: input.type,
      expiry_date: input.expiryDate,
      file_path: input.filePath,
      certificate_file: input.filePath,
      notes: input.notes ?? '',
    }).select().single();
    if (error) throwErr(error, 'Unable to save certification');
    return { id: data!.id };
  },

  'certifications.adminApprove': async (input: { id: string; reason?: string }) => {
    // 1. Approve via audited RPC.
    const { error } = await supabase.rpc('admin_approve_certification', {
      p_cert_id: input.id,
      p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to approve certification');
    // Worker notification is queued inside admin_approve_certification (migration 0058).
    return { success: true };
  },

  'certifications.adminReject': async (input: { id: string; reason: string }) => {
    // 1. Reject via audited RPC.
    const { error } = await supabase.rpc('admin_reject_certification', {
      p_cert_id: input.id,
      p_reason: input.reason,
    });
    if (error) throwErr(error, 'Unable to reject certification');
    // Worker notification is queued inside admin_reject_certification (migration 0058).
    return { success: true };
  },

  // =========================================================================
  // REVIEWS / RATINGS
  // =========================================================================
  'reviews.post': async (input: {
    contextKind: 'warehouse_booking' | 'service_job' | 'shift_assignment';
    contextId: string;
    targetKind: 'company' | 'worker';
    targetCompanyId?: string | null;
    targetUserId?: string | null;
    rating: number;
    comment?: string;
  }) => {
    const { data, error } = await supabase.rpc('post_review', {
      p_context_kind: input.contextKind,
      p_context_id: input.contextId,
      p_target_kind: input.targetKind,
      p_target_company_id: input.targetCompanyId ?? null,
      p_target_user_id: input.targetUserId ?? null,
      p_rating: input.rating,
      p_comment: input.comment ?? '',
    });
    if (error) throwErr(error, 'Unable to submit review');
    return { id: data as string };
  },

  'reviews.listForCompany': async (input: { companyId: string }) => {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at, reviewer_user_id, reviewer_company_id, context_kind, context_id, target_kind, profiles:reviewer_user_id(name), reviewer_company:reviewer_company_id(name)')
      .eq('target_company_id', input.companyId)
      .order('created_at', { ascending: false });
    if (error) throwErr(error, 'Unable to load reviews');
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      rating: Number(r.rating ?? 0),
      comment: (r.comment ?? '') as string,
      createdAt: (r.created_at ?? '') as string,
      reviewerUserId: (r.reviewer_user_id ?? '') as string,
      reviewerName: (r.profiles?.name ?? 'User') as string,
      reviewerCompanyName: (r.reviewer_company?.name ?? null) as string | null,
      contextKind: (r.context_kind ?? '') as string,
      contextId: (r.context_id ?? '') as string,
    }));
  },

  'reviews.listForWorker': async (input: { userId: string }) => {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at, reviewer_user_id, reviewer_company_id, context_kind, context_id, target_kind, reviewer_company:reviewer_company_id(name)')
      .eq('target_user_id', input.userId)
      .order('created_at', { ascending: false });
    if (error) throwErr(error, 'Unable to load reviews');
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      rating: Number(r.rating ?? 0),
      comment: (r.comment ?? '') as string,
      createdAt: (r.created_at ?? '') as string,
      reviewerUserId: (r.reviewer_user_id ?? '') as string,
      reviewerCompanyName: (r.reviewer_company?.name ?? 'Employer') as string,
      contextKind: (r.context_kind ?? '') as string,
      contextId: (r.context_id ?? '') as string,
    }));
  },

  'reviews.summaries': async () => {
    const { data, error } = await supabase.from('review_summaries').select('*');
    if (error) throwErr(error, 'Unable to load review summaries');
    return (data ?? []).map((r: Row) => ({
      targetKind: (r.target_kind ?? 'company') as 'company' | 'worker',
      targetId: r.target_id as string,
      count: Number(r.count ?? 0),
      avgRating: Number(r.avg_rating ?? 0),
    }));
  },

  'reviews.listMineByContext': async (input: {
    contextKind: 'warehouse_booking' | 'service_job' | 'shift_assignment';
    contextIds: string[];
  }, ctx) => {
    if (input.contextIds.length === 0) return [];
    const { data, error } = await supabase
      .from('reviews')
      .select('id, context_kind, context_id, target_kind, rating')
      .eq('reviewer_user_id', ctx.user.id)
      .eq('context_kind', input.contextKind)
      .in('context_id', input.contextIds);
    if (error) throwErr(error, 'Unable to load my reviews');
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      contextKind: r.context_kind as string,
      contextId: r.context_id as string,
      targetKind: r.target_kind as string,
      rating: Number(r.rating ?? 0),
    }));
  },

  'workPhotos.adminModerate': async (input: { photoId: string; status: 'approved' | 'rejected'; reason?: string }) => {
    const { error } = await supabase.rpc('admin_moderate_work_photo', { p_photo_id: input.photoId, p_status: input.status, p_reason: input.reason ?? '' });
    if (error) throwErr(error, 'Unable to moderate photo');
    return { success: true };
  },

  // =========================================================================
  // UPLOADS — stubbed (no storage backend)
  // =========================================================================
  'uploads.createPresignedUrl': async () => {
    throw new Error('File uploads are not configured');
  },
  'uploads.confirmUpload': async () => {
    throw new Error('File uploads are not configured');
  },

  // =========================================================================
  // PAYMENTS — live Stripe intent creation via Edge Function
  // =========================================================================
  'payments.createPaymentIntent': async (input: { invoiceId: string }) => {
    const { data, error } = await supabase.functions.invoke('create-payment-intent', {
      body: { invoice_id: input.invoiceId },
    });
    if (error) throwErr(error, 'Unable to create payment intent');
    return data as { client_secret: string; payment_intent_id: string; amount: number; currency: string };
  },

  'payments.renderInvoice': async (input: { invoiceId: string }) => {
    if (!input.invoiceId) return { html: '' };
    const { data: inv } = await supabase.from('invoices').select('*').eq('id', input.invoiceId).maybeSingle();
    if (!inv) return { html: '' };
    const { data: lines } = await supabase.from('invoice_lines').select('*').eq('invoice_id', input.invoiceId);
    const lineRows = (lines ?? []).map((l: Row) =>
      `<tr><td>${l.description ?? ''}</td><td style="text-align:right">${Number(l.quantity ?? 1)}</td><td style="text-align:right">${Number(l.unit_price ?? 0).toFixed(2)}</td><td style="text-align:right">${Number(l.line_total ?? 0).toFixed(2)}</td></tr>`
    ).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoice_number ?? inv.id}</title><style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:32px;color:#0F1E2F;}h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px 8px;border-bottom:1px solid #E5E7EB;font-size:13px}.tot{font-weight:700;font-size:16px}</style></head><body><h1>Invoice ${inv.invoice_number ?? inv.id}</h1><p>Date: ${new Date(inv.created_at ?? Date.now()).toLocaleDateString()}</p><p>Status: ${inv.status}</p><table><thead><tr><th style="text-align:left">Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${lineRows}</tbody></table><p style="text-align:right;margin-top:18px">Subtotal: ${Number(inv.subtotal_amount ?? 0).toFixed(2)}</p><p style="text-align:right">Tax: ${Number(inv.tax_amount ?? 0).toFixed(2)}</p><p class="tot" style="text-align:right">Total: ${Number(inv.total_amount ?? 0).toFixed(2)} ${String(inv.currency ?? 'CAD').toUpperCase()}</p></body></html>`;
    return { html };
  },

  // =========================================================================
  // SHIPPING — EasyPost label purchase + shipments + tracking
  // =========================================================================
  'shipping.listShipments': async (_input, ctx) => {
    const q = supabase.from('shipments').select('*').is('archived_at', null).order('created_at', { ascending: false });
    const { data, error } = isAdmin(ctx.user.role)
      ? await q
      : ctx.user.companyId
        ? await q.or(`customer_company_id.eq.${ctx.user.companyId},provider_company_id.eq.${ctx.user.companyId}`)
        : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load shipments');
    return data ?? [];
  },
  'shipping.getShipment': async (input: { id: string }) => {
    const { data: ship, error } = await supabase.from('shipments').select('*').eq('id', input.id).maybeSingle();
    if (error || !ship) throw new Error('Shipment not found');
    const { data: events } = await supabase.from('tracking_events').select('*').eq('shipment_id', input.id).order('occurred_at', { ascending: false });
    const { data: pkgs } = await supabase.from('shipment_packages').select('*').eq('shipment_id', input.id);
    return { shipment: ship, events: events ?? [], packages: pkgs ?? [] };
  },
  'shipping.createForOrder': async (input: { orderId: string; carrierCode: string; serviceLevel: string; shipFrom: AnyRecord; shipTo: AnyRecord }) => {
    const { data, error } = await supabase.rpc('create_shipment_for_order', {
      p_order_id: input.orderId,
      p_carrier_code: input.carrierCode,
      p_service_level: input.serviceLevel,
      p_ship_from: input.shipFrom,
      p_ship_to: input.shipTo,
    });
    if (error) throwErr(error, 'Unable to create shipment');
    return { id: data as string };
  },
  'shipping.purchaseLabel': async (input: { shipmentId: string; rateQuoteId?: string; carrierAccountId?: string }) => {
    const { data, error } = await supabase.functions.invoke('purchase-shipping-label', {
      body: { shipment_id: input.shipmentId, rate_quote_id: input.rateQuoteId, carrier_account_id: input.carrierAccountId },
    });
    if (error) throwErr(error, 'Unable to purchase label');
    return data as { tracking_code: string; label_url: string; carrier: string; rate: number; currency: string };
  },
  'shipping.rateShop': async (input: { shipmentId: string; carrierCodes?: string[] }) => {
    const { data, error } = await supabase.functions.invoke('shipping-rate-shop', {
      body: { shipment_id: input.shipmentId, carrier_codes: input.carrierCodes ?? [] },
    });
    if (error) throwErr(error, 'Unable to compare rates');
    return data as { rates: AnyRecord[]; errors: { carrier: string; error: string }[]; attempted: number };
  },
  'shipping.listRateQuotes': async (input: { shipmentId: string }) => {
    const { data, error } = await supabase.from('shipping_rate_quotes').select('*').eq('shipment_id', input.shipmentId).order('rate_amount', { ascending: true });
    if (error) throwErr(error, 'Unable to load rate quotes');
    return data ?? [];
  },
  'shipping.voidLabel': async (input: { shipmentId: string; reason?: string }) => {
    const { data, error } = await supabase.functions.invoke('shipping-void-label', {
      body: { shipment_id: input.shipmentId, reason: input.reason ?? '' },
    });
    if (error) throwErr(error, 'Unable to void label');
    return data as { ok: boolean };
  },
  'shipping.createManifest': async (input: { companyId: string; carrierCode: string; carrierAccountId?: string; shipmentIds: string[] }) => {
    const { data, error } = await supabase.functions.invoke('shipping-create-manifest', {
      body: { company_id: input.companyId, carrier_code: input.carrierCode, carrier_account_id: input.carrierAccountId, shipment_ids: input.shipmentIds },
    });
    if (error) throwErr(error, 'Unable to create manifest');
    return data as { manifest_id: string; manifest_number: string; manifest_url: string; failed_reason: string; attach_errors: string[] };
  },
  'shipping.listManifests': async (input: { companyId?: string } | undefined, ctx) => {
    const q = supabase.from('shipping_manifests').select('*').order('created_at', { ascending: false });
    const scoped = input?.companyId
      ? q.eq('company_id', input.companyId)
      : isAdmin(ctx.user.role)
        ? q
        : ctx.user.companyId ? q.eq('company_id', ctx.user.companyId) : q.eq('company_id', '00000000-0000-0000-0000-000000000000');
    const { data, error } = await scoped;
    if (error) throwErr(error, 'Unable to load manifests');
    return data ?? [];
  },
  'shipping.trackPull': async (input: { shipmentId?: string; max?: number }) => {
    const { data, error } = await supabase.functions.invoke('shipping-track-pull', {
      body: { shipment_id: input.shipmentId, max: input.max ?? 25 },
    });
    if (error) throwErr(error, 'Unable to refresh tracking');
    return data as { polled: number; recorded: number; errors: string[] };
  },

  // =========================================================================
  // CARRIERS — multi-carrier accounts
  // =========================================================================
  'carriers.list': async (input: { scope?: 'platform' | 'company'; companyId?: string } | undefined, ctx) => {
    const q = supabase.from('carrier_accounts').select('*').order('carrier_code');
    if (input?.scope === 'platform') {
      const { data, error } = await q.eq('scope', 'platform');
      if (error) throwErr(error, 'Unable to load carriers');
      return data ?? [];
    }
    const companyId = input?.companyId ?? ctx.user.companyId ?? '';
    if (!companyId && !isAdmin(ctx.user.role)) return [];
    const { data, error } = isAdmin(ctx.user.role) && !companyId
      ? await q
      : await q.eq('company_id', companyId).eq('scope', 'company');
    if (error) throwErr(error, 'Unable to load carriers');
    return data ?? [];
  },
  'carriers.upsert': async (input: { id?: string; companyId?: string | null; scope: 'platform' | 'company'; carrierCode: string; displayName?: string; accountNumber?: string; mode?: 'test' | 'live'; credentialsSecretRef?: string; data?: AnyRecord; isActive?: boolean }) => {
    const { data, error } = await supabase.rpc('upsert_carrier_account', {
      p_id: input.id ?? null,
      p_company_id: input.scope === 'platform' ? null : (input.companyId ?? null),
      p_scope: input.scope,
      p_carrier_code: input.carrierCode.toUpperCase(),
      p_display_name: input.displayName ?? '',
      p_account_number: input.accountNumber ?? '',
      p_mode: input.mode ?? 'test',
      p_credentials_secret_ref: input.credentialsSecretRef ?? '',
      p_data: input.data ?? {},
      p_is_active: input.isActive ?? true,
    });
    if (error) throwErr(error, 'Unable to save carrier');
    return { id: data as string };
  },
  'carriers.delete': async (input: { id: string }) => {
    const { error } = await supabase.from('carrier_accounts').delete().eq('id', input.id);
    if (error) throwErr(error, 'Unable to delete carrier');
    return { ok: true };
  },
  'carriers.supported': async () => {
    return [
      { code: 'EASYPOST', name: 'EasyPost', implemented: true, mode: 'aggregator', requires: ['api_key'] },
      { code: 'SHIPPO', name: 'Shippo', implemented: true, mode: 'aggregator', requires: ['api_key'] },
      { code: 'CANADA_POST', name: 'Canada Post', implemented: true, mode: 'direct', requires: ['username', 'password', 'customer_number'] },
      { code: 'UPS', name: 'UPS', implemented: true, mode: 'direct', requires: ['client_id', 'client_secret', 'account_number'] },
      { code: 'DHL', name: 'DHL Express', implemented: true, mode: 'direct', requires: ['username', 'password', 'account_number'] },
      { code: 'FEDEX', name: 'FedEx', implemented: true, mode: 'direct', requires: ['client_id', 'client_secret', 'account_number'] },
    ];
  },

  // =========================================================================
  // RETURNS / RMA
  // =========================================================================
  'returns.list': async (_input, ctx) => {
    const q = supabase.from('return_authorizations').select('*').order('created_at', { ascending: false });
    const { data, error } = isAdmin(ctx.user.role)
      ? await q
      : ctx.user.companyId
        ? await q.or(`customer_company_id.eq.${ctx.user.companyId},provider_company_id.eq.${ctx.user.companyId}`)
        : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load returns');
    return data ?? [];
  },
  'returns.request': async (input: { orderId: string; reason: string; items?: AnyRecord[] }) => {
    const { data, error } = await supabase.rpc('request_rma', {
      p_order_id: input.orderId,
      p_reason: input.reason,
      p_items: input.items ?? [],
    });
    if (error) throwErr(error, 'Unable to request return');
    return { id: data as string };
  },

  // returns.advanceStatus — warehouse side updates RMA status.
  // Valid DB return_status enum values: Requested, Approved, Rejected, Received, Refunded, Closed
  'returns.advanceStatus': async (input: { rmaId: string; status: string; notes?: string }) => {
    const ALLOWED_STATUSES = new Set(['Approved', 'Rejected', 'Received', 'Refunded', 'Closed']);
    if (!ALLOWED_STATUSES.has(input.status)) {
      throw new Error(`returns.advanceStatus: status "${input.status}" is not valid`);
    }
    const patch: AnyRecord = { status: input.status };
    if (input.notes) patch.notes = input.notes;
    if (input.status === 'Received') patch.received_at = new Date().toISOString();
    const { error } = await supabase
      .from('return_authorizations')
      .update(patch)
      .eq('id', input.rmaId);
    if (error) throwErr(error, 'Unable to advance RMA status');
    return { success: true };
  },

  // =========================================================================
  // WMS — locations, stock levels, receipts, cycle counts
  // =========================================================================
  'wms.listLocations': async (_input, ctx) => {
    if (!ctx.user.companyId && !isAdmin(ctx.user.role)) return [];
    const q = supabase.from('warehouse_locations').select('*').is('archived_at', null).order('zone').order('aisle');
    const { data, error } = isAdmin(ctx.user.role) ? await q : await q.eq('warehouse_company_id', ctx.user.companyId!);
    if (error) throwErr(error, 'Unable to load locations');
    return data ?? [];
  },
  'wms.createLocation': async (input: AnyRecord, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { data, error } = await supabase.from('warehouse_locations').insert({
      warehouse_company_id: ctx.user.companyId,
      listing_id: input.listingId ?? null,
      code: input.code ?? input.label ?? '',
      zone: input.zone ?? '',
      aisle: input.aisle ?? '',
      rack: input.rack ?? '',
      level: input.level ?? '',
      bin: input.bin ?? '',
    }).select().single();
    if (error) throwErr(error, 'Unable to create location');
    return { id: data!.id };
  },
  'wms.listStockLevels': async (input: { variantId?: string; locationId?: string } | undefined, ctx) => {
    let q = supabase.from('stock_levels').select('*, product_variants(sku,name), warehouse_locations(code,zone,aisle,bin)').order('updated_at', { ascending: false }).limit(500);
    if (input?.variantId) q = q.eq('variant_id', input.variantId);
    if (input?.locationId) q = q.eq('location_id', input.locationId);
    if (!isAdmin(ctx.user.role) && ctx.user.companyId) q = q.eq('warehouse_company_id', ctx.user.companyId);
    const { data, error } = await q;
    if (error) throwErr(error, 'Unable to load stock');
    return data ?? [];
  },
  'wms.listReceipts': async (_input, ctx) => {
    const q = supabase.from('inventory_receipts').select('*').order('created_at', { ascending: false }).limit(200);
    const { data, error } = isAdmin(ctx.user.role)
      ? await q
      : ctx.user.companyId ? await q.eq('warehouse_company_id', ctx.user.companyId) : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load receipts');
    return data ?? [];
  },
  'wms.receive': async (input: { receiptId?: string; variantId: string; locationId: string; quantity: number; lotCode?: string; reference?: string }) => {
    // NOTE: param names/order must match the SQL signature exactly
    // wms_receive(p_receipt_id, p_variant_id, p_location_id, p_lot_code, p_expiry, p_qty)
    const { data, error } = await supabase.rpc('wms_receive', {
      p_receipt_id: input.receiptId ?? null,
      p_variant_id: input.variantId,
      p_location_id: input.locationId,
      p_lot_code: input.lotCode ?? null,
      p_expiry: null,
      p_qty: input.quantity,
    });
    if (error) throwErr(error, 'Unable to record receipt');
    return { movementId: data as string };
  },
  'wms.adjust': async (input: { variantId: string; locationId: string; delta: number; reason: string }) => {
    // wms_adjust(p_variant_id, p_location_id, p_lot_id, p_delta, p_reason)
    const { error } = await supabase.rpc('wms_adjust', {
      p_variant_id: input.variantId,
      p_location_id: input.locationId,
      p_lot_id: null,
      p_delta: input.delta,
      p_reason: input.reason,
    });
    if (error) throwErr(error, 'Unable to adjust stock');
    return { success: true };
  },
  'wms.listCycleCounts': async (_input, ctx) => {
    const q = supabase.from('cycle_counts').select('*').order('counted_at', { ascending: false }).limit(200);
    const { data, error } = isAdmin(ctx.user.role)
      ? await q
      : ctx.user.companyId ? await q.eq('warehouse_company_id', ctx.user.companyId) : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load cycle counts');
    return data ?? [];
  },

  // =========================================================================
  // YARD / GATE / POD
  // =========================================================================
  'yard.listMoves': async (_input, ctx) => {
    const q = supabase.from('yard_moves').select('*').order('created_at', { ascending: false }).limit(200);
    const { data, error } = isAdmin(ctx.user.role)
      ? await q
      : ctx.user.companyId ? await q.eq('warehouse_company_id', ctx.user.companyId) : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load yard moves');
    return data ?? [];
  },
  'pod.list': async (input: { appointmentId?: string; shipmentId?: string } | undefined) => {
    let q = supabase.from('pods').select('*').order('created_at', { ascending: false }).limit(100);
    if (input?.appointmentId) q = q.eq('appointment_id', input.appointmentId);
    if (input?.shipmentId) q = q.eq('shipment_id', input.shipmentId);
    const { data, error } = await q;
    if (error) throwErr(error, 'Unable to load PODs');
    return data ?? [];
  },
  'pod.attach': async (input: { appointmentId?: string; shipmentId?: string; filePath: string; signerName?: string; notes?: string }) => {
    const { data, error } = await supabase.rpc('attach_pod', {
      p_appointment_id: input.appointmentId ?? null,
      p_shipment_id: input.shipmentId ?? null,
      p_file_path: input.filePath,
      p_signer_name: input.signerName ?? '',
      p_notes: input.notes ?? '',
    });
    if (error) throwErr(error, 'Unable to attach POD');
    return { id: data as string };
  },

  // =========================================================================
  // NOTIFICATIONS / PUSH
  // =========================================================================
  'notifications.registerPushToken': async (input: { token: string; platform: string }, ctx) => {
    const { error } = await supabase.rpc('register_push_token', {
      p_user_id: ctx.user.id,
      p_token: input.token,
      p_platform: input.platform,
    });
    if (error) throwErr(error, 'Unable to register push token');
    return { success: true };
  },
  'notifications.getPreferences': async (_input, ctx) => {
    const { data } = await supabase.from('notification_preferences').select('*').eq('user_id', ctx.user.id).maybeSingle();
    return data ?? { user_id: ctx.user.id, email_enabled: true, push_enabled: true, sms_enabled: false };
  },
  'notifications.savePreferences': async (input: AnyRecord, ctx) => {
    await supabase.from('notification_preferences').upsert({
      user_id: ctx.user.id,
      email_enabled: input.email ?? true,
      push_enabled: input.push ?? true,
      sms_enabled: input.sms ?? false,
    }, { onConflict: 'user_id' });
    return { success: true };
  },
  'notifications.markAllRead': async (_input, ctx) => {
    await supabase.from('notifications').update({ read: true, read_at: new Date().toISOString() }).eq('user_id', ctx.user.id).is('read_at', null);
    return { success: true };
  },

  // =========================================================================
  // REVIEWS — ratings by company / user (extends reviews namespace)
  // =========================================================================
  'reviews.companySummary': async (input: { companyId: string }) => {
    const { data } = await supabase.from('review_summaries').select('*').eq('target_kind', 'company').eq('target_id', input.companyId).maybeSingle();
    return data ?? { count: 0, avg_rating: 0 };
  },
  'reviews.workerSummary': async (input: { userId: string }) => {
    const { data } = await supabase.from('review_summaries').select('*').eq('target_kind', 'worker').eq('target_id', input.userId).maybeSingle();
    return data ?? { count: 0, avg_rating: 0 };
  },
};

// ---------------------------------------------------------------------------
// Proxy factory
// ---------------------------------------------------------------------------
function procKey(ns: string, proc: string): string {
  return `${ns}.${proc}`;
}

function callProcedure(ns: string, proc: string, input: unknown): Promise<unknown> {
  const key = procKey(ns, proc);
  const fn = PROCEDURES[key];
  if (!fn) {
    console.error('[trpc-shim] unknown procedure:', key);
    return Promise.reject(new Error(`Unknown procedure: ${key}`));
  }
  return requireCtx()
    .then((ctx) => fn(input, ctx))
    .catch((err: unknown) => {
      // Always log the real error so it's visible in Metro / Rork console,
      // not just a generic screen message with no details.
      console.error('[trpc-shim] procedure error:', key, err instanceof Error ? err.message : String(err));
      throw err;
    });
}

// The 32 screens were written against a typed tRPC client and access query data
// loosely (e.g. `data ?? []` then `.map`/`.filter`, and `onError: (e: Error)`).
// Typing the shim hook results as `any` preserves that exact call surface.
type QueryHookInput<T> = [T] | [T, Partial<UseQueryOptions<any, any>>] | [];
type MutationHook = (options?: UseMutationOptions<any, any, any>) => UseMutationResult<any, any, any>;

function makeProcedureHandlers(ns: string, proc: string) {
  return {
    useQuery: (...args: QueryHookInput<unknown>) => {
      const input = args[0];
      const options = (args[1] ?? {}) as Partial<UseQueryOptions<any, any>>;
      return useQuery<any, any>({
        queryKey: ['trpc', ns, proc, input ?? null],
        queryFn: () => callProcedure(ns, proc, input),
        ...options,
      });
    },
    useMutation: ((options?: UseMutationOptions<any, any, any>) =>
      useMutation<any, any, any>({
        mutationFn: (input: unknown) => callProcedure(ns, proc, input),
        ...options,
      })) as MutationHook,
  };
}

type ProcProxy = {
  useQuery: (input?: unknown, options?: Partial<UseQueryOptions<any, any>>) => UseQueryResult<any, any>;
  useMutation: MutationHook;
  invalidate: (input?: unknown) => Promise<void>;
};

type RouterProxy = Record<string, ProcProxy>;
type TrpcShim = Record<string, RouterProxy> & {
  Provider: (props: { children: React.ReactNode; client?: unknown; queryClient?: unknown }) => any;
  useUtils: () => Record<string, Record<string, { invalidate: (input?: unknown) => Promise<void> }>>;
};

// useUtils uses the query client to invalidate
function makeUtilsProxy(): ReturnType<TrpcShim['useUtils']> {
  const queryClient = useQueryClient();
  return new Proxy({}, {
    get: (_t, ns: string) =>
      new Proxy({}, {
        get: (_t2, proc: string) => ({
          invalidate: (input?: unknown) =>
            queryClient.invalidateQueries({ queryKey: ['trpc', ns, proc, input ?? null] }),
        }),
      }),
  }) as ReturnType<TrpcShim['useUtils']>;
}

// Build namespace proxies with hooks
function makeNamespace(ns: string): RouterProxy {
  return new Proxy({}, {
    get: (_t, proc: string) => {
      if (proc === 'then') return undefined;
      const handlers = makeProcedureHandlers(ns, proc);
      return {
        useQuery: handlers.useQuery,
        useMutation: handlers.useMutation,
        invalidate: () => Promise.resolve(),
      } as ProcProxy;
    },
  }) as RouterProxy;
}

const trpcRoot = new Proxy({}, {
  get: (_t, prop: string) => {
    if (prop === 'useUtils') return makeUtilsProxy;
    if (prop === 'Provider') {
      const PassThrough = ({ children }: { children: React.ReactNode }) => children as React.ReactNode;
      return PassThrough;
    }
    if (typeof prop === 'string') return makeNamespace(prop);
    return undefined;
  },
}) as unknown as TrpcShim;

export const trpc = trpcRoot;

// Backwards compat exports — some code imports trpcClient even though we don't use it now
export const trpcClient = {} as unknown;
