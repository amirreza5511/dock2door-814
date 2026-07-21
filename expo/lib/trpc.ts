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

export type OceanLeg = {
  id: string;
  seq: number;
  leg_type: 'OriginPort' | 'OceanTransit' | 'DestPort' | 'Warehouse' | 'FinalMile';
  title: string;
  status: 'Pending' | 'Active' | 'Done';
  started_at: string | null;
  completed_at: string | null;
  notes: string;
};

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
 * Detects a missing COLUMN (undefined_column 42703, or a PostgREST schema-cache
 * miss that names a column). Used to gracefully fall back to a base schema when
 * an additive migration (e.g. 0120 ad media columns) hasn't been applied yet.
 */
function isMissingColumn(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '42703') return true;
  const msg = (e.message ?? '').toLowerCase();
  return (
    (msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache'))) ||
    (msg.includes('could not find') && msg.includes('column'))
  );
}

/**
 * Detects a missing FUNCTION (undefined_function 42883, or PostgREST's
 * "could not find the function" PGRST202). Used so brand-new RPC features whose
 * migration hasn't been applied yet degrade to a friendly "not ready" state.
 */
function isMissingFunction(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '42883' || e.code === 'PGRST202') return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('could not find the function') || (msg.includes('function') && msg.includes('does not exist'));
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
    referenceNumber: r.reference_number ?? '',
    transportMode: r.transport_mode ?? 'unspecified',
    carrierName: r.carrier_name ?? '',
    driverName: r.driver_name ?? '',
    vehiclePlate: r.vehicle_plate ?? '',
    cargoDescription: r.cargo_description ?? '',
    declaredPieces: r.declared_pieces != null ? Number(r.declared_pieces) : null,
    declaredWeightKg: r.declared_weight_kg != null ? Number(r.declared_weight_kg) : null,
    bolIssuedAt: r.bol_issued_at ?? null,
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
    providerCompanyId: r.provider_company_id ?? null,
    quoteStatus: r.quote_status ?? 'none',
    quotedAmount: r.quoted_amount != null ? Number(r.quoted_amount) : null,
    quoteNotes: r.quote_notes ?? '',
    quoteSentAt: r.quote_sent_at ?? null,
    cargoValue: r.cargo_value != null ? Number(r.cargo_value) : null,
    commissionAmount: Number(r.commission_amount ?? 0),
    invoiceId: r.invoice_id ?? null,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

// Marketplace listing with embedded company (service_listings + companies join).
function mapMarketplaceListing(r: Row): Row {
  const co = (r.company ?? null) as Row | null;
  return {
    id: r.id,
    companyId: r.company_id,
    companyName: co?.name ?? 'Provider',
    companyCity: co?.city ?? '',
    serviceType: r.service_type ?? 'service',
    category: r.category,
    subcategory: r.subcategory ?? '',
    title: r.title ?? '',
    description: r.description ?? '',
    coverageArea: Array.isArray(r.coverage_area) ? r.coverage_area : [],
    hourlyRate: Number(r.hourly_rate ?? 0),
    perJobRate: r.per_job_rate != null ? Number(r.per_job_rate) : null,
    dailyRate: r.daily_rate != null ? Number(r.daily_rate) : null,
    weeklyRate: r.weekly_rate != null ? Number(r.weekly_rate) : null,
    cargoRatePercent: r.cargo_rate_percent != null ? Number(r.cargo_rate_percent) : null,
    minPremium: r.min_premium != null ? Number(r.min_premium) : null,
    minimumHours: Number(r.minimum_hours ?? 1),
    negotiable: Boolean(r.negotiable),
    certifications: r.certifications ?? '',
    status: r.status ?? 'Draft',
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

  // Receiving: look up a booking by its reference number (WB-XXXXXXXX).
  // Returns the booking, listing, customer, and any existing receipt so the
  // receiving operator can verify who the cargo belongs to before accepting it.
  'bookings.lookupByReference': async (input: { reference: string }) => {
    const { data, error } = await supabase.rpc('warehouse_receiving_lookup', {
      p_reference: input.reference,
    });
    if (error) throwErr(error, 'Unable to find booking');
    return data as {
      booking: AnyRecord;
      listing: AnyRecord | null;
      customer: AnyRecord | null;
      receipt: AnyRecord | null;
    };
  },

  // Receiving: confirm the cargo physically arrived. Creates/updates the
  // inventory receipt (ASN) so it can be putaway into the WMS.
  'bookings.confirmArrival': async (input: { reference: string; carrier?: string; tracking?: string; notes?: string }) => {
    const { data, error } = await supabase.rpc('warehouse_confirm_receipt', {
      p_reference: input.reference,
      p_carrier: input.carrier ?? '',
      p_tracking: input.tracking ?? '',
      p_notes: input.notes ?? '',
    });
    if (error) throwErr(error, 'Unable to confirm receipt');
    return { receiptId: data as string };
  },

  // Customer declares how the cargo will arrive and (optionally) issues the BOL.
  'bookings.setTransport': async (input: {
    bookingId: string;
    transportMode?: 'unspecified' | 'own_driver' | 'self_delivery' | 'third_party';
    carrierName?: string;
    driverName?: string;
    vehiclePlate?: string;
    cargoDescription?: string;
    declaredPieces?: number | null;
    declaredWeightKg?: number | null;
    issueBol?: boolean;
  }) => {
    const { data, error } = await supabase.rpc('warehouse_booking_set_transport', {
      p_booking_id: input.bookingId,
      p_transport_mode: input.transportMode ?? null,
      p_carrier_name: input.carrierName ?? null,
      p_driver_name: input.driverName ?? null,
      p_vehicle_plate: input.vehiclePlate ?? null,
      p_cargo_description: input.cargoDescription ?? null,
      p_declared_pieces: input.declaredPieces ?? null,
      p_declared_weight_kg: input.declaredWeightKg ?? null,
      p_issue_bol: input.issueBol ?? false,
    });
    if (error) throwErr(error, 'Unable to update transport details');
    return mapWarehouseBooking(data as Row);
  },

  // =========================================================================
  // GRN — Goods Received Note (inbound inspection + acceptance record)
  // =========================================================================
  // Warehouse issues a GRN after receiving+inspecting the cargo. Closes the
  // inbound receipt and creates a permanent, printable acceptance record.
  'grn.issue': async (input: {
    bookingId: string;
    inspectionStatus?: 'good' | 'damaged' | 'partial' | 'rejected';
    palletsReceived?: number;
    piecesReceived?: number | null;
    conditionNotes?: string;
    inspectorNotes?: string;
  }) => {
    const { data, error } = await supabase.rpc('warehouse_issue_grn', {
      p_booking_id: input.bookingId,
      p_inspection_status: input.inspectionStatus ?? 'good',
      p_pallets_received: input.palletsReceived ?? 0,
      p_pieces_received: input.piecesReceived ?? null,
      p_condition_notes: input.conditionNotes ?? '',
      p_inspector_notes: input.inspectorNotes ?? '',
    });
    if (error) throwErr(error, 'Unable to issue goods received note');
    return data as AnyRecord;
  },

  // Fetch the most recent GRN for a booking (customer or warehouse can read).
  'grn.getByBooking': async (input: { bookingId: string }) => {
    const { data, error } = await supabase
      .from('goods_received_notes')
      .select('*')
      .eq('booking_id', input.bookingId)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isMissingRelation(error)) return null;
      throwErr(error, 'Unable to load goods received note');
    }
    return (data as AnyRecord | null) ?? null;
  },

  // List all bookings that already have a GRN issued, with their inspection
  // status. Used to show a persisted "already inspected" (green) state in lists.
  'grn.listIssued': async () => {
    const { data, error } = await supabase
      .from('goods_received_notes')
      .select('booking_id, inspection_status, grn_number, issued_at')
      .order('issued_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load goods received notes');
    }
    return (data as AnyRecord[] | null) ?? [];
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
    const row: AnyRecord = {
      company_id: ctx.user.companyId,
      category: input.category ?? 'Labour',
      coverage_area: input.coverageArea ?? [],
      hourly_rate: input.hourlyRate ?? 0,
      per_job_rate: input.perJobRate ?? null,
      minimum_hours: input.minimumHours ?? 1,
      certifications: input.certifications ?? '',
      status: input.status ?? 'Draft',
    };
    // Marketplace fields (migration 0132). Only send when provided so the insert
    // still works against a pre-migration schema for the legacy provider flow.
    if (input.serviceType !== undefined) row.service_type = input.serviceType;
    if (input.title !== undefined) row.title = input.title;
    if (input.description !== undefined) row.description = input.description;
    if (input.subcategory !== undefined) row.subcategory = input.subcategory;
    if (input.dailyRate !== undefined) row.daily_rate = input.dailyRate;
    if (input.weeklyRate !== undefined) row.weekly_rate = input.weeklyRate;
    if (input.cargoRatePercent !== undefined) row.cargo_rate_percent = input.cargoRatePercent;
    if (input.minPremium !== undefined) row.min_premium = input.minPremium;
    if (input.negotiable !== undefined) row.negotiable = input.negotiable;
    const { data, error } = await supabase.from('service_listings').insert(row).select().single();
    if (error) throwErr(error, 'Unable to create service');
    return { id: data!.id };
  },

  // =========================================================================
  // MARKETPLACE — cross-company services / equipment rental / mobile repair.
  // Any authenticated business user can browse Active listings (RLS sl_read_auth).
  // =========================================================================
  'marketplace.browse': async (input: { serviceType?: string } | undefined) => {
    const q = supabase
      .from('service_listings')
      .select('*, company:companies(id,name,city)')
      .eq('status', 'Active')
      .order('created_at', { ascending: false });
    if (input?.serviceType) q.eq('service_type', input.serviceType);
    const { data, error } = await q;
    if (error) {
      // New feature: if migration 0132 hasn't been applied yet, degrade to empty.
      if (isMissingColumn(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load the marketplace');
    }
    return (data ?? []).map(mapMarketplaceListing);
  },

  'marketplace.getListing': async (input: { id: string }) => {
    const { data, error } = await supabase
      .from('service_listings')
      .select('*, company:companies(id,name,city)')
      .eq('id', input.id)
      .maybeSingle();
    if (error) throwErr(error, 'Unable to load listing');
    return data ? mapMarketplaceListing(data) : null;
  },

  // Public provider profile: company info + all its Active listings + rating.
  'marketplace.providerProfile': async (input: { companyId: string }) => {
    const [{ data: company }, { data: listings }] = await Promise.all([
      supabase.from('companies').select('id,name,city,type,status').eq('id', input.companyId).maybeSingle(),
      supabase
        .from('service_listings')
        .select('*, company:companies(id,name,city)')
        .eq('company_id', input.companyId)
        .eq('status', 'Active')
        .order('created_at', { ascending: false }),
    ]);
    let rating = 0;
    let reviewCount = 0;
    try {
      const { data: reviews } = await supabase
        .from('reviews')
        .select('rating')
        .eq('target_id', input.companyId);
      const rows = reviews ?? [];
      reviewCount = rows.length;
      if (reviewCount > 0) rating = rows.reduce((s: number, r: Row) => s + Number(r.rating ?? 0), 0) / reviewCount;
    } catch {
      // reviews are optional; ignore if unavailable
    }
    return {
      company: company
        ? { id: company.id, name: (company as AnyRecord).name ?? 'Provider', city: (company as AnyRecord).city ?? '', type: (company as AnyRecord).type ?? '' }
        : null,
      listings: (listings ?? []).map(mapMarketplaceListing),
      rating: Math.round(rating * 10) / 10,
      reviewCount,
    };
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

  'operations.myFleetCode': async (_input, ctx) => {
    if (!ctx.user.companyId) return { fleetCode: null as string | null };
    let { data } = await supabase.from('companies').select('fleet_code, type').eq('id', ctx.user.companyId).maybeSingle();
    let code = (data?.fleet_code as string | null) ?? null;
    // Self-heal: if this fleet company has no code yet, mint one now.
    if (!code && (data?.type === 'TruckingCompany' || data?.type === 'DrayageCompany')) {
      const { data: gen } = await supabase.rpc('gen_fleet_code');
      const newCode = typeof gen === 'string' ? gen : null;
      if (newCode) {
        await supabase.from('companies').update({ fleet_code: newCode }).eq('id', ctx.user.companyId);
        code = newCode;
      }
    }
    return { fleetCode: code };
  },

  'operations.joinFleetByCode': async (input: { code: string }, ctx) => {
    if (!ctx.user) throw new Error('Not authenticated');
    const code = (input.code ?? '').trim().toUpperCase();
    if (code.length < 4) throw new Error('Enter a valid fleet code');
    const { data, error } = await supabase.rpc('join_fleet_by_code', { p_code: code });
    if (error) throwErr(error, 'Unable to join fleet');
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.company_id) throw new Error('Invalid fleet code');
    return { companyId: row.company_id as string, companyName: (row.company_name as string) ?? 'your fleet' };
  },

  'operations.listFleet': async (input: { entity: 'drivers' | 'trucks' | 'trailers' | 'containers' | 'chassis'; search?: string }, ctx) => {
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
        data: {
          name: p.name ?? '',
          email: p.email ?? '',
          truckNumber: p.truckNumber ?? '',
          chassisNumber: p.chassisNumber ?? '',
          notes: p.notes ?? '',
          driverType: p.driverType ?? 'Company',
          defaultHourlyRate: p.defaultHourlyRate ?? 0,
          ...(linkedUserId ? { userId: linkedUserId } : {}),
        },
      };
    } else if (input.entity === 'trucks') {
      row = { ...row, plate: p.plateNumber ?? p.unitNumber ?? '', make: p.make ?? '', model: p.model ?? '',
        ...(p.costPerMile != null ? { cost_per_mile: Number(p.costPerMile) || 0 } : {}),
        data: { unitNumber: p.unitNumber ?? '', notes: p.notes ?? '', insuranceExpiry: p.insuranceExpiry ?? '', inspectionExpiry: p.inspectionExpiry ?? '' } };
    } else if (input.entity === 'trailers') {
      row = { ...row, plate: p.plateNumber ?? p.trailerNumber ?? '', trailer_type: p.trailerType ?? p.containerType ?? '',
        is_rental: !!p.isRental, rental_daily_rate: p.rentalDailyRate ?? 0, rental_return_date: p.rentalReturnDate || null,
        data: { trailerNumber: p.trailerNumber ?? '', notes: p.notes ?? '', insuranceExpiry: p.insuranceExpiry ?? '', inspectionExpiry: p.inspectionExpiry ?? '' } };
    } else if (input.entity === 'chassis') {
      row = { ...row, chassis_number: p.chassisNumber ?? '', plate: p.plateNumber ?? '', chassis_type: p.chassisType ?? '',
        is_rental: !!p.isRental, rental_daily_rate: p.rentalDailyRate ?? 0, rental_return_date: p.rentalReturnDate || null,
        data: { notes: p.notes ?? '' } };
    } else if (input.entity === 'containers') {
      row = { ...row, container_number: p.containerNumber ?? '', container_type: p.containerType ?? '' };
    }
    let { data, error } = await supabase.from(input.entity).insert(row).select().single();
    if (error && isMissingColumn(error) && 'cost_per_mile' in row) {
      // Migration 0149 not applied yet — retry without the new column.
      delete row.cost_per_mile;
      ({ data, error } = await supabase.from(input.entity).insert(row).select().single());
    }
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
        data: {
          name: p.name ?? '',
          email: p.email ?? '',
          truckNumber: p.truckNumber ?? '',
          chassisNumber: p.chassisNumber ?? '',
          notes: p.notes ?? '',
          driverType: p.driverType ?? 'Company',
          defaultHourlyRate: p.defaultHourlyRate ?? 0,
          ...(linkedUserId ? { userId: linkedUserId } : {}),
        },
      };
    } else if (input.entity === 'trucks') {
      row = { ...row, plate: p.plateNumber ?? p.unitNumber ?? '',
        ...(p.costPerMile != null ? { cost_per_mile: Number(p.costPerMile) || 0 } : {}),
        data: { unitNumber: p.unitNumber ?? '', notes: p.notes ?? '', insuranceExpiry: p.insuranceExpiry ?? '', inspectionExpiry: p.inspectionExpiry ?? '' } };
    } else if (input.entity === 'trailers') {
      row = { ...row, plate: p.plateNumber ?? p.trailerNumber ?? '', trailer_type: p.trailerType ?? p.containerType ?? '',
        is_rental: !!p.isRental, rental_daily_rate: p.rentalDailyRate ?? 0, rental_return_date: p.rentalReturnDate || null,
        data: { trailerNumber: p.trailerNumber ?? '', notes: p.notes ?? '', insuranceExpiry: p.insuranceExpiry ?? '', inspectionExpiry: p.inspectionExpiry ?? '' } };
    } else if (input.entity === 'chassis') {
      row = { ...row, chassis_number: p.chassisNumber ?? '', plate: p.plateNumber ?? '', chassis_type: p.chassisType ?? '',
        is_rental: !!p.isRental, rental_daily_rate: p.rentalDailyRate ?? 0, rental_return_date: p.rentalReturnDate || null,
        data: { notes: p.notes ?? '' } };
    } else if (input.entity === 'containers') {
      row = { ...row, container_number: p.containerNumber ?? '', container_type: p.containerType ?? '' };
    }
    let { error } = await supabase.from(input.entity).update(row).eq('id', input.id);
    if (error && isMissingColumn(error) && 'cost_per_mile' in row) {
      delete row.cost_per_mile;
      ({ error } = await supabase.from(input.entity).update(row).eq('id', input.id));
    }
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
    cargoType?: string; weightKg?: number; distanceKm?: number; storagePayer?: 'shipper' | 'receiver';
    cargoClass?: string;
  }) => {
    const { data, error } = await supabase.rpc('quote_load', {
      p_pickup_lat: input.pickupLat, p_pickup_lng: input.pickupLng,
      p_dropoff_lat: input.dropoffLat, p_dropoff_lng: input.dropoffLng,
      p_vehicle_type: input.vehicleType, p_pallets: input.pallets,
      p_delivery_speed: input.deliverySpeed,
      p_cargo_type: input.cargoType ?? 'Pallet', p_weight_kg: input.weightKg ?? 0,
      p_distance_km: input.distanceKm ?? null,
      p_storage_payer: input.storagePayer ?? 'shipper',
      p_cargo_class: input.cargoClass ?? 'General',
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
    distanceKm?: number; storagePayer?: 'shipper' | 'receiver'; cargoClass?: string;
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
      p_distance_km: input.distanceKm ?? null,
      p_storage_payer: input.storagePayer ?? 'shipper',
      p_cargo_class: input.cargoClass ?? 'General',
    });
    if (error) {
      if (isMissingRelation(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to post load');
    }
    return { id: data as string };
  },

  // Cargo-class surcharge catalogue (drives the shipper's cargo-class picker).
  'loads.cargoClasses': async () => {
    const { data, error } = await supabase.from('cargo_class_surcharges')
      .select('*').order('sort_order', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load cargo classes');
    }
    return data ?? [];
  },

  // All scannable pieces (labels) for a shipment — used for labels & scan progress.
  'loads.pieces': async (input: { loadId: string }) => {
    const { data, error } = await supabase.from('load_pieces')
      .select('*').eq('load_id', input.loadId).order('piece_no', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load shipment pieces');
    }
    return data ?? [];
  },

  // Driver scans a piece's barcode/QR at pickup; returns live scanned/total progress.
  'loads.scanPiece': async (input: { barcode: string }) => {
    const { data, error } = await supabase.rpc('scan_load_piece', { p_barcode: input.barcode });
    if (error) {
      if (isMissingRelation(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to scan this label');
    }
    return (data ?? {}) as AnyRecord;
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

  // Shipper sets/updates the receiver's phone &/or email after posting a load.
  'loads.setReceiverContact': async (input: { id: string; phone?: string | null; email?: string | null }) => {
    const { error } = await supabase.rpc('set_receiver_contact', {
      p_load_id: input.id,
      p_phone: input.phone ?? null,
      p_email: input.email ?? null,
    });
    if (error) throwErr(error, 'Unable to update receiver contact');
    return { success: true };
  },

  // Public, unauthenticated tracking read for an accountless receiver (by token).
  'loads.publicTrack': async (input: { token: string }) => {
    const { data, error } = await supabase.rpc('public_track_load', { p_token: input.token });
    if (error) throw new Error('Unable to load tracking');
    return (data as AnyRecord | null) ?? null;
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

  'loads.advance': async (input: { id: string; status: string; proofPhotoPath?: string | null; receiverName?: string | null; signaturePath?: string | null }) => {
    const { error } = await supabase.rpc('advance_load', {
      p_load_id: input.id,
      p_next_status: input.status,
      p_proof_photo_path: input.proofPhotoPath ?? null,
      p_receiver_name: input.receiverName ?? null,
      p_signature_path: input.signaturePath ?? null,
    });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to update load');
    }
    return { success: true };
  },

  // Driver pushes their live GPS fix onto an active load so the shipper can track it.
  'loads.updateLocation': async (input: { id: string; lat: number; lng: number }) => {
    const { error } = await supabase.rpc('update_driver_location', {
      p_load_id: input.id, p_lat: input.lat, p_lng: input.lng,
    });
    if (error) {
      if (isLoadsTableMissing(error)) return { success: false };
      throwErr(error, 'Unable to update location');
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

  // Carrier sets the driver-pay plan (percent/flat) + fuel cost for a load.
  'loads.setSettlement': async (input: { id: string; payType: 'Percent' | 'Flat' | null; payValue: number | null; fuelCost?: number | null }) => {
    const { error } = await supabase.rpc('set_load_settlement', {
      p_load_id: input.id,
      p_pay_type: input.payType,
      p_pay_value: input.payValue,
      p_fuel_cost: input.fuelCost ?? null,
    });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to save settlement');
    }
    return { success: true };
  },

  'loads.markSettled': async (input: { id: string; settled: boolean }) => {
    const { error } = await supabase.rpc('mark_load_settled', { p_load_id: input.id, p_settled: input.settled });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to update settlement');
    }
    return { success: true };
  },

  // Delivered loads for the carrier company — powers the settlement + reports.
  'loads.settlement': async (_input, ctx) => {
    if (!ctx.user.companyId) return [] as AnyRecord[];
    const { data, error } = await supabase.from('loads').select('*')
      .eq('accepted_company_id', ctx.user.companyId)
      .in('status', ['Delivered'])
      .is('archived_at', null)
      .order('delivered_at', { ascending: false }).limit(500);
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load settlement');
    }
    return data ?? [];
  },

  // Delivery deadline used for delay alerts on the dispatch board.
  'loads.setDeadline': async (input: { id: string; deadline: string | null }) => {
    const { error } = await supabase.rpc('set_load_deadline', { p_load_id: input.id, p_deadline: input.deadline });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to set deadline');
    }
    return { success: true };
  },

  // Geofence auto check-in: driver entered the drop-off radius while EnRoute.
  'loads.geofenceArrive': async (input: { id: string }) => {
    const { data, error } = await supabase.rpc('geofence_arrive', { p_load_id: input.id });
    if (error) {
      if (isLoadsTableMissing(error)) return { arrived: false };
      throwErr(error, 'Unable to auto check-in');
    }
    return { arrived: data === true };
  },

  // Multi-stop: ordered extra stops between the primary pickup and drop-off.
  'loads.stops': async (input: { loadId: string }) => {
    const { data, error } = await supabase.from('load_stops').select('*')
      .eq('load_id', input.loadId).order('seq', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load stops');
    }
    return data ?? [];
  },

  'loads.setStops': async (input: { loadId: string; stops: AnyRecord[] }) => {
    const { error } = await supabase.rpc('set_load_stops', { p_load_id: input.loadId, p_stops: input.stops });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to save stops');
    }
    return { success: true };
  },

  'loads.completeStop': async (input: { stopId: string; done?: boolean }) => {
    const { error } = await supabase.rpc('complete_load_stop', { p_stop_id: input.stopId, p_done: input.done ?? true });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to update stop');
    }
    return { success: true };
  },

  // Carrier attaches a specific truck + trailer to an active load (full set).
  'loads.setFleet': async (input: { id: string; truckId?: string | null; trailerId?: string | null }) => {
    const { error } = await supabase.rpc('set_load_fleet', {
      p_load_id: input.id,
      p_truck_id: input.truckId ?? null,
      p_trailer_id: input.trailerId ?? null,
    });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to assign fleet units');
    }
    return { success: true };
  },

  // Assigned driver accepts or rejects a dispatched load. Rejecting sends it
  // back to the company's waiting-for-driver pool and notifies the dispatcher.
  'loads.respondDispatch': async (input: { id: string; accept: boolean; reason?: string | null }) => {
    const { error } = await supabase.rpc('respond_dispatch', {
      p_load_id: input.id,
      p_accept: input.accept,
      p_reason: input.reason ?? null,
    });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to respond to dispatch');
    }
    return { success: true };
  },

  // =========================================================================
  // DRIVER SHIFT CLOCK (hourly pay) — migration 0147
  // =========================================================================
  // Driver's current open shift (or null). Powers the Start/End toggle.
  'driverShifts.open': async (_input, ctx) => {
    const { data, error } = await supabase.from('driver_shifts').select('*')
      .eq('driver_user_id', ctx.user.id).is('ended_at', null)
      .order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (error) {
      if (isMissingRelation(error)) return null;
      throwErr(error, 'Unable to load shift');
    }
    return (data as AnyRecord | null) ?? null;
  },

  // Driver's recent shifts (for their own log).
  'driverShifts.mine': async (input: { days?: number } | undefined, ctx) => {
    const since = new Date(); since.setDate(since.getDate() - (input?.days ?? 30));
    const { data, error } = await supabase.from('driver_shifts').select('*')
      .eq('driver_user_id', ctx.user.id)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false }).limit(200);
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load shifts');
    }
    return data ?? [];
  },

  'driverShifts.start': async (_input, ctx) => {
    const { data, error } = await supabase.rpc('start_shift', { p_company_id: ctx.user.companyId });
    if (error) {
      if (isMissingRelation(error)) throw new Error('Shift tracking isn\u2019t set up on the server yet. Apply migration 0147 and try again.');
      throwErr(error, 'Unable to start shift');
    }
    return (data as AnyRecord) ?? {};
  },

  'driverShifts.end': async () => {
    const { data, error } = await supabase.rpc('end_shift');
    if (error) throwErr(error, 'Unable to end shift');
    return (data as AnyRecord) ?? {};
  },

  // Company view: all shifts within a period, for hourly settlement.
  'driverShifts.company': async (input: { days?: number } | undefined, ctx) => {
    if (!ctx.user.companyId) return [] as AnyRecord[];
    const since = new Date(); since.setDate(since.getDate() - (input?.days ?? 30));
    const { data, error } = await supabase.from('driver_shifts').select('*')
      .eq('company_id', ctx.user.companyId)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false }).limit(1000);
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load shifts');
    }
    return data ?? [];
  },

  'driverShifts.setMinutes': async (input: { id: string; minutes: number }) => {
    const { error } = await supabase.rpc('set_shift_minutes', { p_shift_id: input.id, p_minutes: input.minutes });
    if (error) throwErr(error, 'Unable to update shift hours');
    return { success: true };
  },

  // =========================================================================
  // FUEL SURCHARGE (FSC) — migration 0147
  // =========================================================================
  'fsc.list': async (_input, ctx) => {
    if (!ctx.user.companyId) return [] as AnyRecord[];
    const { data, error } = await supabase.from('fuel_surcharges').select('*')
      .eq('company_id', ctx.user.companyId)
      .order('month', { ascending: false }).limit(36);
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load fuel surcharge');
    }
    return data ?? [];
  },

  // Current month's FSC percent (0 if not set).
  'fsc.current': async (_input, ctx) => {
    if (!ctx.user.companyId) return { percent: 0 };
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const monthStr = month.toISOString().slice(0, 10);
    const { data, error } = await supabase.from('fuel_surcharges').select('percent')
      .eq('company_id', ctx.user.companyId).eq('month', monthStr).maybeSingle();
    if (error) {
      if (isMissingRelation(error)) return { percent: 0 };
      throwErr(error, 'Unable to load fuel surcharge');
    }
    return { percent: Number((data as AnyRecord | null)?.percent ?? 0) };
  },

  'fsc.set': async (input: { month: string; percent: number }) => {
    const { data, error } = await supabase.rpc('set_fuel_surcharge', { p_month: input.month, p_percent: input.percent });
    if (error) {
      if (isMissingRelation(error)) throw new Error('Fuel surcharge isn\u2019t set up on the server yet. Apply migration 0147 and try again.');
      throwErr(error, 'Unable to save fuel surcharge');
    }
    return (data as AnyRecord) ?? {};
  },

  // Freight arriving at / stored in the current company's warehouse hub(s).
  // Pending = expected inbound, AtHub = received & in storage.
  'loads.hubInbound': async (_input, ctx) => {
    if (!ctx.user.companyId) return [] as AnyRecord[];
    const { data, error } = await supabase.from('loads').select('*')
      .eq('hub_company_id', ctx.user.companyId)
      .in('hub_leg_status', ['Pending', 'AtHub'])
      .is('archived_at', null)
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load hub freight');
    }
    return data ?? [];
  },

  // Warehouse confirms the freight physically arrived at the hub.
  'loads.hubConfirmInbound': async (input: { id: string }) => {
    const { error } = await supabase.rpc('hub_confirm_inbound', { p_load_id: input.id });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to confirm inbound');
    }
    return { success: true };
  },

  // Warehouse releases the freight for final delivery; returns the storage charge.
  'loads.hubRelease': async (input: { id: string }) => {
    const { data, error } = await supabase.rpc('hub_release_load', { p_load_id: input.id });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to release load');
    }
    return { charge: Number(data ?? 0) };
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
        driverType: (meta.driverType as string) ?? 'Company',
        defaultHourlyRate: Number(meta.defaultHourlyRate ?? 0),
      };
    });
  },

  // Driver keeps a hub-routed load in their own truck overnight instead of
  // dropping it at the warehouse hub; the hub fee is redirected to the driver.
  'loads.driverHold': async (input: { id: string; hold?: boolean }) => {
    const { error } = await supabase.rpc('driver_hold_load', { p_load_id: input.id, p_hold: input.hold ?? true });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to update truck-hold');
    }
    return { success: true };
  },

  // Open jobs board: hub-routed legs a driver can claim. Pickup legs are loads
  // still heading to the hub; delivery legs are loads released from the hub
  // awaiting their final leg. Optionally filtered to a zone (city substring).
  'loads.openLegs': async (input: { zone?: string } | undefined, ctx) => {
    void ctx;
    const { data, error } = await supabase.from('loads').select('*')
      .eq('uses_hub', true).is('archived_at', null)
      .or('and(hub_leg_status.eq.Pending,pickup_leg_driver_user_id.is.null),and(hub_leg_status.eq.Released,delivery_leg_driver_user_id.is.null)')
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (isMissingRelation(error)) return [] as AnyRecord[];
      throwErr(error, 'Unable to load open jobs');
    }
    const zone = (input?.zone ?? '').trim().toLowerCase();
    const rows = (data ?? []) as AnyRecord[];
    if (!zone) return rows;
    return rows.filter((r) => {
      const leg = r.hub_leg_status === 'Released' ? 'delivery' : 'pickup';
      const city = leg === 'delivery' ? String(r.dropoff_city ?? '') : String(r.pickup_city ?? '');
      return city.toLowerCase().includes(zone);
    });
  },

  // Driver self-claims a leg ('pickup' or 'delivery') from the open board.
  'loads.claimLeg': async (input: { id: string; leg: 'pickup' | 'delivery' }) => {
    const { error } = await supabase.rpc('claim_load_leg', { p_load_id: input.id, p_leg: input.leg });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to claim this leg');
    }
    return { success: true };
  },

  // Dispatcher assigns a specific fleet driver to a leg.
  'loads.assignLeg': async (input: { id: string; leg: 'pickup' | 'delivery'; driverUserId: string }) => {
    const { error } = await supabase.rpc('assign_load_leg', { p_load_id: input.id, p_leg: input.leg, p_driver_user_id: input.driverUserId });
    if (error) {
      if (isLoadsTableMissing(error)) throw new Error(LOADS_NOT_READY);
      throwErr(error, 'Unable to assign this leg');
    }
    return { success: true };
  },

  // Fleet toggles whether one of their warehouse listings is a discoverable
  // network hub or kept internal-only.
  'warehouse.setHub': async (input: { listingId: string; enabled: boolean }) => {
    const { error } = await supabase.rpc('set_warehouse_hub', { p_listing_id: input.listingId, p_enabled: input.enabled });
    if (error) throwErr(error, 'Unable to update hub setting');
    return { success: true };
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
  // DRAYAGE — World 4: container drayage ecosystem
  // =========================================================================
  'drayage.listTerminals': async (input: { type?: string; search?: string } | undefined) => {
    let q = supabase.from('terminals').select('*').eq('is_active', true).order('terminal_type').order('name');
    if (input?.type && input.type !== 'all') q = q.eq('terminal_type', input.type);
    if (input?.search) {
      const s = input.search.trim();
      q = q.or(`name.ilike.%${s}%,code.ilike.%${s}%,city.ilike.%${s}%,operator.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load terminals');
    return data ?? [];
  },

  'drayage.createOrder': async (input: AnyRecord) => {
    const { data, error } = await supabase.rpc('create_drayage_order', {
      p_direction: input.direction,
      p_container_number: input.containerNumber ?? '',
      p_container_size: input.containerSize ?? '40ft',
      p_container_type: input.containerType ?? '',
      p_bol_number: input.bolNumber ?? '',
      p_booking_number: input.bookingNumber ?? '',
      p_commodity: input.commodity ?? '',
      p_weight_kg: input.weightKg ?? 0,
      p_is_hazmat: input.isHazmat ?? false,
      p_is_overweight: input.isOverweight ?? false,
      p_is_oversized: input.isOversized ?? false,
      p_origin_terminal_id: input.originTerminalId ?? null,
      p_destination_terminal_id: input.destinationTerminalId ?? null,
      p_warehouse_company_id: input.warehouseCompanyId ?? null,
      p_pickup_address: input.pickupAddress ?? '',
      p_pickup_city: input.pickupCity ?? '',
      p_pickup_lat: input.pickupLat ?? 0,
      p_pickup_lng: input.pickupLng ?? 0,
      p_delivery_address: input.deliveryAddress ?? '',
      p_delivery_city: input.deliveryCity ?? '',
      p_delivery_lat: input.deliveryLat ?? 0,
      p_delivery_lng: input.deliveryLng ?? 0,
      p_port_reservation_date: input.portReservationDate ?? null,
      p_port_reservation_time: input.portReservationTime ?? '',
      p_is_prepull: input.isPrepull ?? false,
      p_prepull_pickup_date: input.prepullPickupDate ?? null,
      p_prepull_yard_terminal_id: input.prepullYardTerminalId ?? null,
      p_notes: input.notes ?? '',
      p_target_drayage_company_id: input.targetDrayageCompanyId ?? null,
      p_handling_mode: input.handlingMode ?? 'LiveUnload',
      p_pickup_back_date: input.pickupBackDate ?? null,
    });
    if (error) {
      const e = error as { code?: string; message?: string; details?: string; hint?: string };
      const detail = [e.code, e.message, e.details, e.hint].filter(Boolean).join(' | ');
      // Surface the REAL database error so a half-applied migration or signature
      // mismatch is diagnosable, instead of a misleading generic "run migration" text.
      if (e.code === '42P01' || e.code === 'PGRST205') {
        throw new Error(`Drayage tables are missing on the server — apply migration 0100. [${detail}]`);
      }
      if (e.code === 'PGRST202' || (e.message ?? '').toLowerCase().includes('could not find the function')) {
        throw new Error(`The drayage order function signature is out of date — apply the latest migration (0108). [${detail}]`);
      }
      throw new Error(`Unable to create drayage order. [${detail}]`);
    }
    return { id: data as string };
  },

  // List active drayage companies (for the customer's "invite a company" picker)
  'drayage.listCompanies': async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, city, status')
      .eq('type', 'DrayageCompany')
      .eq('status', 'Approved')
      .order('name');
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load drayage companies');
    return data ?? [];
  },

  // Quotes on a single order (customer view — see every bid)
  'drayage.listOrderQuotes': async (input: { orderId: string }) => {
    const { data, error } = await supabase
      .from('drayage_quotes')
      .select('*, companies:drayage_company_id(id, name, city)')
      .eq('order_id', input.orderId)
      .order('price', { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load quotes');
    return data ?? [];
  },

  // The current company's quotes (drayage company view)
  'drayage.myQuotes': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('drayage_quotes')
      .select('*')
      .eq('drayage_company_id', ctx.user.companyId)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load your quotes');
    return data ?? [];
  },

  'drayage.submitQuote': async (input: {
    orderId: string; price: number; currency?: string; etaNote?: string; message?: string;
  }) => {
    const { error } = await supabase.rpc('submit_drayage_quote', {
      p_order_id: input.orderId,
      p_price: input.price,
      p_currency: input.currency ?? 'CAD',
      p_eta_note: input.etaNote ?? '',
      p_message: input.message ?? '',
    });
    if (error) throwErr(error, 'Unable to submit quote');
    return { success: true };
  },

  'drayage.acceptQuote': async (input: { quoteId: string }) => {
    const { error } = await supabase.rpc('accept_drayage_quote', { p_quote_id: input.quoteId });
    if (error) throwErr(error, 'Unable to accept quote');
    return { success: true };
  },

  'drayage.withdrawQuote': async (input: { quoteId: string }) => {
    const { error } = await supabase.rpc('withdraw_drayage_quote', { p_quote_id: input.quoteId });
    if (error) throwErr(error, 'Unable to withdraw quote');
    return { success: true };
  },

  'drayage.listOrders': async (input: { filter?: 'all' | 'open' | 'mine' | 'customer'; limit?: number } | undefined, ctx) => {
    const filter = input?.filter ?? 'all';
    const limit = input?.limit ?? 100;
    let q = supabase.from('drayage_orders').select('*').order('created_at', { ascending: false }).limit(limit);
    if (filter === 'open') {
      q = q.eq('status', 'Open');
    } else if (filter === 'mine' && ctx.user.companyId) {
      q = q.eq('drayage_company_id', ctx.user.companyId);
    } else if (filter === 'customer' && ctx.user.companyId) {
      q = q.eq('customer_company_id', ctx.user.companyId);
    }
    const { data, error } = await q;
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load drayage orders');
    return data ?? [];
  },

  'drayage.getOrder': async (input: { id: string }) => {
    const { data, error } = await supabase.from('drayage_orders').select('*').eq('id', input.id).maybeSingle();
    if (error || !data) throw new Error(error?.message ?? 'Order not found');
    return data;
  },

  'drayage.getOrderDetails': async (input: { id: string }) => {
    const [orderRes, movesRes, trackingRes, inspRes, docsRes] = await Promise.all([
      supabase.from('drayage_orders').select('*').eq('id', input.id).maybeSingle(),
      supabase.from('drayage_moves').select('*').eq('order_id', input.id).order('sequence', { ascending: true }),
      supabase.from('container_tracking').select('*').eq('order_id', input.id).order('recorded_at', { ascending: false }).limit(1),
      supabase.from('equipment_inspections').select('*').eq('order_id', input.id).order('created_at', { ascending: false }),
      supabase.from('drayage_documents').select('*').eq('order_id', input.id).order('created_at', { ascending: false }),
    ]);
    if (orderRes.error || !orderRes.data) throw new Error(orderRes.error?.message ?? 'Order not found');
    const order = orderRes.data as AnyRecord;
    // Resolve linked equipment (truck / chassis / trailer) for display.
    const [truckRes, chassisRes, trailerRes, lineRes, stRes] = await Promise.all([
      order.truck_id ? supabase.from('trucks').select('*').eq('id', order.truck_id).maybeSingle() : Promise.resolve({ data: null }),
      order.chassis_id ? supabase.from('chassis').select('*').eq('id', order.chassis_id).maybeSingle() : Promise.resolve({ data: null }),
      order.trailer_id ? supabase.from('trailers').select('*').eq('id', order.trailer_id).maybeSingle() : Promise.resolve({ data: null }),
      order.shipping_line_id ? supabase.from('shipping_lines').select('*').eq('id', order.shipping_line_id).maybeSingle() : Promise.resolve({ data: null }),
      order.street_turn_order_id
        ? supabase.from('drayage_orders').select('id, reference_code, status, container_number').eq('id', order.street_turn_order_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return {
      order,
      moves: movesRes.data ?? [],
      latestTracking: trackingRes.data?.[0] ?? null,
      inspections: inspRes.data ?? [],
      documents: docsRes.data ?? [],
      truck: truckRes.data ?? null,
      chassis: chassisRes.data ?? null,
      trailer: trailerRes.data ?? null,
      shippingLine: lineRes.data ?? null,
      streetTurnOrder: stRes.data ?? null,
    };
  },

  // -------------------------------------------------------------------------
  // EQUIPMENT TRACKING, CHARGES, INSPECTIONS, DOCS, SHIPPING LINES (0148)
  // -------------------------------------------------------------------------
  'drayage.assignEquipment': async (input: { orderId: string; truckId?: string | null; chassisId?: string | null; trailerId?: string | null }) => {
    const { error } = await supabase.rpc('assign_drayage_equipment', {
      p_order_id: input.orderId,
      p_truck_id: input.truckId ?? null,
      p_chassis_id: input.chassisId ?? null,
      p_trailer_id: input.trailerId ?? null,
    });
    if (error) throwErr(error, 'Unable to assign equipment');
    return { success: true };
  },

  'drayage.dropEquipment': async (input: { equipmentType: 'chassis' | 'trailer'; equipmentId: string; lat?: number | null; lng?: number | null; label?: string }) => {
    const { error } = await supabase.rpc('drop_equipment', {
      p_equipment_type: input.equipmentType,
      p_equipment_id: input.equipmentId,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_label: input.label ?? '',
    });
    if (error) throwErr(error, 'Unable to drop equipment');
    return { success: true };
  },

  'drayage.pickupEquipment': async (input: { equipmentType: 'chassis' | 'trailer'; equipmentId: string; truckId?: string | null }) => {
    const { error } = await supabase.rpc('pickup_equipment', {
      p_equipment_type: input.equipmentType,
      p_equipment_id: input.equipmentId,
      p_truck_id: input.truckId ?? null,
    });
    if (error) throwErr(error, 'Unable to pick up equipment');
    return { success: true };
  },

  // Live location of all chassis + trailers for the current company (attached to a
  // truck => follows the driver's latest GPS; dropped => last drop location).
  'drayage.equipmentLive': async (_input, ctx) => {
    if (!ctx.user.companyId) return { chassis: [] as AnyRecord[], trailers: [] as AnyRecord[] };
    const [chassisRes, trailersRes] = await Promise.all([
      supabase.from('chassis').select('*').eq('company_id', ctx.user.companyId).is('archived_at', null),
      supabase.from('trailers').select('*').eq('company_id', ctx.user.companyId).is('archived_at', null),
    ]);
    if (isMissingRelation(chassisRes.error)) return { chassis: [], trailers: [] };
    const chassis = (chassisRes.data ?? []) as AnyRecord[];
    const trailers = (trailersRes.data ?? []) as AnyRecord[];
    // Resolve live truck GPS for attached equipment via the latest container_tracking ping
    // of any order that references that truck.
    const truckIds = Array.from(new Set([...chassis, ...trailers].map((e) => e.current_truck_id).filter(Boolean)));
    const truckLoc = new Map<string, AnyRecord>();
    if (truckIds.length > 0) {
      const { data: ords } = await supabase.from('drayage_orders').select('id, truck_id').in('truck_id', truckIds as string[]);
      const orderToTruck = new Map<string, string>();
      for (const o of (ords ?? []) as AnyRecord[]) if (o.truck_id) orderToTruck.set(String(o.id), String(o.truck_id));
      const orderIds = Array.from(orderToTruck.keys());
      if (orderIds.length > 0) {
        const { data: tracks } = await supabase.from('container_tracking').select('order_id, lat, lng, recorded_at').in('order_id', orderIds).order('recorded_at', { ascending: false }).limit(300);
        for (const t of (tracks ?? []) as AnyRecord[]) {
          const tId = orderToTruck.get(String(t.order_id));
          if (tId && !truckLoc.has(tId)) truckLoc.set(tId, t);
        }
      }
    }
    const decorate = (e: AnyRecord) => {
      const truckId = e.current_truck_id ? String(e.current_truck_id) : null;
      if (!e.is_dropped && truckId && truckLoc.has(truckId)) {
        const t = truckLoc.get(truckId)!;
        return { ...e, live_lat: Number(t.lat), live_lng: Number(t.lng), live_at: t.recorded_at, live_source: 'truck' };
      }
      if (e.is_dropped && e.dropped_lat != null) {
        return { ...e, live_lat: Number(e.dropped_lat), live_lng: Number(e.dropped_lng), live_at: e.dropped_at, live_source: 'dropped' };
      }
      return { ...e, live_lat: null, live_lng: null, live_at: null, live_source: 'unknown' };
    };
    return { chassis: chassis.map(decorate), trailers: trailers.map(decorate) };
  },

  'drayage.setCharges': async (input: {
    orderId: string;
    perDiemFreeDays?: number | null; perDiemLastFreeDay?: string | null; perDiemDailyRate?: number | null;
    demurrageFreeDays?: number | null; demurrageLastFreeDay?: string | null; demurrageDailyRate?: number | null;
    storageFreeDays?: number | null; storageLastFreeDay?: string | null; storageDailyRate?: number | null;
  }) => {
    const { error } = await supabase.rpc('set_drayage_charges', {
      p_order_id: input.orderId,
      p_per_diem_free_days: input.perDiemFreeDays ?? null,
      p_per_diem_last_free_day: input.perDiemLastFreeDay ?? null,
      p_per_diem_daily_rate: input.perDiemDailyRate ?? null,
      p_demurrage_free_days: input.demurrageFreeDays ?? null,
      p_demurrage_last_free_day: input.demurrageLastFreeDay ?? null,
      p_demurrage_daily_rate: input.demurrageDailyRate ?? null,
      p_storage_free_days: input.storageFreeDays ?? null,
      p_storage_last_free_day: input.storageLastFreeDay ?? null,
      p_storage_daily_rate: input.storageDailyRate ?? null,
    });
    if (error) throwErr(error, 'Unable to save charges');
    return { success: true };
  },

  'drayage.listShippingLines': async () => {
    const { data, error } = await supabase.from('shipping_lines').select('*').eq('is_active', true).order('name', { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load shipping lines');
    return data ?? [];
  },

  'drayage.addShippingLine': async (input: { name: string; scac?: string }) => {
    const { data, error } = await supabase.rpc('add_shipping_line', { p_name: input.name, p_scac: input.scac ?? '' });
    if (error) throwErr(error, 'Unable to add shipping line');
    return data;
  },

  'drayage.setOrderShippingLine': async (input: { orderId: string; shippingLineId: string }) => {
    const { error } = await supabase.rpc('set_order_shipping_line', { p_order_id: input.orderId, p_shipping_line_id: input.shippingLineId });
    if (error) throwErr(error, 'Unable to set shipping line');
    return { success: true };
  },

  'drayage.reportEmptyContainer': async (input: { orderId: string; containerNumber: string }) => {
    const { error } = await supabase.rpc('report_empty_container', { p_order_id: input.orderId, p_container_number: input.containerNumber });
    if (error) throwErr(error, 'Unable to report empty container');
    return { success: true };
  },

  'drayage.recordInspection': async (input: {
    orderId: string; equipmentType: 'Container' | 'Chassis'; reference: string; phase: 'Pickup' | 'Drop';
    condition: 'Good' | 'Damaged'; damageNotes?: string; photoPaths?: string[]; moveId?: string | null; inspectorRole?: string;
  }) => {
    const { data, error } = await supabase.rpc('record_equipment_inspection', {
      p_order_id: input.orderId,
      p_equipment_type: input.equipmentType,
      p_reference: input.reference,
      p_phase: input.phase,
      p_condition: input.condition,
      p_damage_notes: input.damageNotes ?? '',
      p_photo_paths: input.photoPaths ?? [],
      p_move_id: input.moveId ?? null,
      p_inspector_role: input.inspectorRole ?? 'Driver',
    });
    if (error) throwErr(error, 'Unable to record inspection');
    return { id: data };
  },

  'drayage.addDocument': async (input: { orderId: string; docType: string; filePaths: string[]; signerName?: string; notes?: string }) => {
    const { data, error } = await supabase.rpc('add_drayage_document', {
      p_order_id: input.orderId,
      p_doc_type: input.docType,
      p_file_paths: input.filePaths,
      p_signer_name: input.signerName ?? '',
      p_notes: input.notes ?? '',
    });
    if (error) throwErr(error, 'Unable to add document');
    return { id: data };
  },

  'drayage.assignOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.rpc('assign_drayage_order', { p_order_id: input.orderId });
    if (error) throwErr(error, 'Unable to assign order');
    return { success: true };
  },

  'drayage.updatePortReservation': async (input: {
    orderId: string; reservationDate: string; reservationTime: string; confirmed?: boolean;
  }) => {
    const { error } = await supabase.rpc('update_port_reservation', {
      p_order_id: input.orderId,
      p_reservation_date: input.reservationDate,
      p_reservation_time: input.reservationTime,
      p_confirmed: input.confirmed ?? false,
    });
    if (error) throwErr(error, 'Unable to update port reservation');
    return { success: true };
  },

  'drayage.listMoves': async (input: { orderId?: string; driverId?: string; status?: string } | undefined) => {
    let q = supabase.from('drayage_moves').select('*, drayage_orders!inner(*)').order('created_at', { ascending: false });
    if (input?.orderId) q = q.eq('order_id', input.orderId);
    if (input?.driverId) q = q.eq('driver_user_id', input.driverId);
    if (input?.status && input.status !== 'all') q = q.eq('status', input.status);
    const { data, error } = await q.limit(200);
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load drayage moves');
    return data ?? [];
  },

  'drayage.dispatchMove': async (input: {
    moveId: string; driverUserId: string; apptDate?: string; apptTime?: string;
  }) => {
    const { error } = await supabase.rpc('dispatch_drayage_move', {
      p_move_id: input.moveId,
      p_driver_user_id: input.driverUserId,
      p_appt_date: input.apptDate ?? null,
      p_appt_time: input.apptTime ?? '',
    });
    if (error) throwErr(error, 'Unable to dispatch move');
    return { success: true };
  },

  'drayage.advanceMove': async (input: { moveId: string; nextStatus: string; proofPhotoPath?: string | null; receiverName?: string | null; containerNumber?: string | null }) => {
    const { error } = await supabase.rpc('advance_drayage_move', {
      p_move_id: input.moveId,
      p_next_status: input.nextStatus,
      p_photo_path: input.proofPhotoPath ?? null,
      p_receiver_name: input.receiverName ?? null,
      p_container_number: input.containerNumber ?? null,
    });
    if (error) throwErr(error, 'Unable to advance move');
    return { success: true };
  },

  'drayage.driverWorkOrders': async (_input, ctx) => {
    const { data, error } = await supabase
      .from('drayage_moves')
      .select('*, drayage_orders!inner(*)')
      .eq('driver_user_id', ctx.user.id)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load work orders');
    return data ?? [];
  },

  'drayage.pingLocation': async (input: {
    orderId: string; moveId?: string; lat: number; lng: number;
    heading?: number; speedKph?: number; accuracy?: number;
  }) => {
    const { error } = await supabase.rpc('ping_container_location', {
      p_order_id: input.orderId,
      p_move_id: input.moveId ?? null,
      p_lat: input.lat,
      p_lng: input.lng,
      p_heading: input.heading ?? 0,
      p_speed_kph: input.speedKph ?? 0,
      p_accuracy: input.accuracy ?? null,
    });
    if (error) throwErr(error, 'Unable to ping location');
    return { success: true };
  },

  // Open (or reuse) the driver <-> dispatch chat thread for a drayage order.
  'drayage.openThread': async (input: { orderId: string }) => {
    const { data, error } = await supabase.rpc('open_drayage_thread', { p_order_id: input.orderId });
    if (error) throwErr(error, 'Unable to open conversation');
    return { threadId: data as string };
  },

  'drayage.getTracking': async (input: { orderId: string; limit?: number }) => {
    const { data, error } = await supabase
      .from('container_tracking')
      .select('*')
      .eq('order_id', input.orderId)
      .order('recorded_at', { ascending: false })
      .limit(input.limit ?? 50);
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load tracking data');
    return data ?? [];
  },

  'drayage.dashboard': async (_input, ctx) => {
    if (!ctx.user.companyId) return { openOrders: [], myOrders: [], activeMoves: [], drivers: [], pendingDrivers: [] };
    const [openRes, myRes, movesRes, driversRes] = await Promise.all([
      supabase.from('drayage_orders').select('*').eq('status', 'Open').order('created_at', { ascending: false }).limit(50),
      supabase.from('drayage_orders').select('*').eq('drayage_company_id', ctx.user.companyId).order('created_at', { ascending: false }).limit(100),
      supabase.from('drayage_moves').select('*, drayage_orders!inner(*)')
        .in('status', ['Assigned', 'EnRoute', 'AtOrigin', 'Loaded', 'InTransit', 'AtDestination', 'Unloaded'])
        .order('updated_at', { ascending: false }).limit(50),
      supabase.from('drivers').select('*').eq('company_id', ctx.user.companyId).is('archived_at', null).order('created_at', { ascending: false }),
    ]);
    if (isMissingRelation(openRes.error)) return { openOrders: [], myOrders: [], activeMoves: [], drivers: [], pendingDrivers: [] };
    const allDrivers = (driversRes.data ?? []) as AnyRecord[];
    // Only approved (non-pending) drivers can be dispatched; pending ones await approval.
    const pendingDrivers = allDrivers.filter((d) => d.status === 'PendingApproval');
    const activeDrivers = allDrivers.filter((d) => d.status !== 'PendingApproval');
    return {
      openOrders: openRes.data ?? [],
      myOrders: myRes.data ?? [],
      activeMoves: movesRes.data ?? [],
      drivers: activeDrivers,
      pendingDrivers,
    };
  },

  // Approve (-> Active) or reject (-> archived) a driver who requested to join the fleet.
  'drayage.approveDriver': async (input: { driverId: string; approve: boolean }) => {
    const { error } = await supabase.rpc('approve_fleet_driver', {
      p_driver_id: input.driverId,
      p_approve: input.approve,
    });
    if (error) throwErr(error, 'Unable to update driver request');
    return { success: true };
  },

  // Live fleet view for dispatch: every active driver + their most recent GPS ping,
  // so a drayage company can see where all their trucks are right now (app & web).
  'drayage.fleetLive': async (_input, ctx) => {
    if (!ctx.user.companyId) return { trucks: [] as any[] };
    const movesRes = await supabase
      .from('drayage_moves')
      .select('id, order_id, status, driver_user_id, move_type, drayage_orders!inner(id, reference_code, container_number, container_size, direction, drayage_company_id)')
      .eq('drayage_orders.drayage_company_id', ctx.user.companyId)
      .in('status', ['Assigned', 'EnRoute', 'AtOrigin', 'Loaded', 'InTransit', 'AtDestination', 'Unloaded'])
      .not('driver_user_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (isMissingRelation(movesRes.error)) return { trucks: [] as any[] };
    if (movesRes.error) throwErr(movesRes.error, 'Unable to load live fleet');
    const moves = (movesRes.data ?? []) as any[];
    if (moves.length === 0) return { trucks: [] as any[] };

    const orderIds = Array.from(new Set(moves.map((m) => m.order_id)));
    const driverIds = Array.from(new Set(moves.map((m) => m.driver_user_id).filter(Boolean)));

    const [trackRes, driversRes] = await Promise.all([
      supabase
        .from('container_tracking')
        .select('order_id, move_id, driver_user_id, lat, lng, heading, speed_kph, recorded_at')
        .in('order_id', orderIds)
        .order('recorded_at', { ascending: false })
        .limit(500),
      supabase
        .from('drivers')
        .select('*')
        .eq('company_id', ctx.user.companyId),
    ]);
    const tracks = (trackRes.data ?? []) as any[];
    const fleetDrivers = (driversRes.data ?? []) as any[];

    // Latest ping per move (fallback: latest per order).
    const latestByMove = new Map<string, any>();
    const latestByOrder = new Map<string, any>();
    for (const t of tracks) {
      if (t.move_id && !latestByMove.has(t.move_id)) latestByMove.set(t.move_id, t);
      if (!latestByOrder.has(t.order_id)) latestByOrder.set(t.order_id, t);
    }

    const driverName = (userId: string): { name: string; truck: string | null } => {
      const d = fleetDrivers.find((x) => (x.driver_user_id ?? x.data?.userId) === userId);
      return {
        name: d?.name ?? d?.data?.name ?? 'Driver',
        truck: d?.data?.truck_plate ?? d?.data?.truck_number ?? null,
      };
    };

    const trucks = moves.map((m) => {
      const ping = latestByMove.get(m.id) ?? latestByOrder.get(m.order_id) ?? null;
      const info = driverName(m.driver_user_id);
      return {
        moveId: m.id,
        orderId: m.order_id,
        status: m.status,
        moveType: m.move_type,
        driverUserId: m.driver_user_id,
        driverName: info.name,
        truck: info.truck,
        referenceCode: m.drayage_orders?.reference_code ?? null,
        containerNumber: m.drayage_orders?.container_number ?? null,
        containerSize: m.drayage_orders?.container_size ?? null,
        direction: m.drayage_orders?.direction ?? null,
        lat: ping ? Number(ping.lat) : null,
        lng: ping ? Number(ping.lng) : null,
        heading: ping ? Number(ping.heading) : 0,
        speedKph: ping ? Number(ping.speed_kph) : 0,
        recordedAt: ping?.recorded_at ?? null,
      };
    });
    return { trucks };
  },

  'drayage.customerOrders': async (_input, ctx) => {
    let q = supabase.from('drayage_orders').select('*').order('created_at', { ascending: false }).limit(100);
    if (ctx.user.companyId) {
      q = q.eq('customer_company_id', ctx.user.companyId);
    } else {
      q = q.eq('customer_user_id', ctx.user.id);
    }
    const { data, error } = await q;
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load your drayage orders');
    return data ?? [];
  },

  // -------------------------------------------------------------------------
  // DRAYAGE RATES — zones, rate cards & accessorials (0115)
  // -------------------------------------------------------------------------

  // The current drayage company's zones.
  'drayage.myZones': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('drayage_zones')
      .select('*')
      .eq('drayage_company_id', ctx.user.companyId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load zones');
    return data ?? [];
  },

  'drayage.upsertZone': async (input: { id?: string | null; name: string; description?: string; sortOrder?: number; isActive?: boolean }, ctx) => {
    if (!ctx.user.companyId) throw new Error('No company associated with your account');
    const row: AnyRecord = {
      drayage_company_id: ctx.user.companyId,
      name: input.name.trim(),
      description: input.description ?? '',
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
      updated_at: new Date().toISOString(),
    };
    if (input.id) row.id = input.id;
    const { data, error } = await supabase.from('drayage_zones').upsert(row).select().single();
    if (error) throwErr(error, 'Unable to save zone');
    return data;
  },

  'drayage.deleteZone': async (input: { id: string }) => {
    const { error } = await supabase.from('drayage_zones').delete().eq('id', input.id);
    if (error) throwErr(error, 'Unable to delete zone');
    return { success: true };
  },

  // The current drayage company's rate cards, with their per-zone rates attached.
  'drayage.myRateCards': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('drayage_rate_cards')
      .select('*, drayage_zone_rates(*), customer:customer_company_id(id, name)')
      .eq('drayage_company_id', ctx.user.companyId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load rate cards');
    return data ?? [];
  },

  'drayage.upsertRateCard': async (input: AnyRecord, ctx) => {
    if (!ctx.user.companyId) throw new Error('No company associated with your account');
    const row: AnyRecord = {
      drayage_company_id: ctx.user.companyId,
      customer_company_id: input.customerCompanyId ?? null,
      name: String(input.name ?? 'Standard rates').trim(),
      currency: input.currency ?? 'CAD',
      is_default: input.isDefault ?? false,
      is_active: input.isActive ?? true,
      fuel_surcharge_pct: input.fuelSurchargePct ?? 0,
      prepull_fee: input.prepullFee ?? 0,
      drop_pick_fee: input.dropPickFee ?? 0,
      chassis_per_day: input.chassisPerDay ?? 0,
      waiting_free_min: input.waitingFreeMin ?? 120,
      waiting_per_hour: input.waitingPerHour ?? 0,
      hourly_rate: input.hourlyRate ?? 0,
      hazmat_fee: input.hazmatFee ?? 0,
      overweight_fee: input.overweightFee ?? 0,
      updated_at: new Date().toISOString(),
    };
    if (input.id) row.id = input.id;
    const { data, error } = await supabase.from('drayage_rate_cards').upsert(row).select().single();
    if (error) throwErr(error, 'Unable to save rate card');
    return data;
  },

  'drayage.deleteRateCard': async (input: { id: string }) => {
    const { error } = await supabase.from('drayage_rate_cards').delete().eq('id', input.id);
    if (error) throwErr(error, 'Unable to delete rate card');
    return { success: true };
  },

  // Set (or clear) the base linehaul rate for a zone on a card.
  'drayage.setZoneRate': async (input: { rateCardId: string; zoneId: string; baseRate: number }) => {
    const { error } = await supabase.from('drayage_zone_rates').upsert(
      { rate_card_id: input.rateCardId, zone_id: input.zoneId, base_rate: input.baseRate, updated_at: new Date().toISOString() },
      { onConflict: 'rate_card_id,zone_id' },
    );
    if (error) throwErr(error, 'Unable to save zone rate');
    return { success: true };
  },

  // Resolve the published rate card + zones that apply to a given order, so both
  // the customer and the drayage company can see the pricing and estimate it.
  'drayage.rateCardForOrder': async (input: { orderId: string }) => {
    const { data: order, error: oErr } = await supabase
      .from('drayage_orders')
      .select('id, drayage_company_id, target_drayage_company_id, customer_company_id, zone_id, rate_card_id')
      .eq('id', input.orderId)
      .maybeSingle();
    if (oErr) throwErr(oErr, 'Unable to load order');
    const companyId = order?.drayage_company_id ?? order?.target_drayage_company_id ?? null;
    if (!companyId) return { card: null, zones: [], zoneRates: [] };

    const [zonesRes, cardsRes] = await Promise.all([
      supabase.from('drayage_zones').select('*').eq('drayage_company_id', companyId).eq('is_active', true).order('sort_order'),
      supabase.from('drayage_rate_cards').select('*, drayage_zone_rates(*)').eq('drayage_company_id', companyId).eq('is_active', true),
    ]);
    if (isMissingRelation(zonesRes.error) || isMissingRelation(cardsRes.error)) return { card: null, zones: [], zoneRates: [] };
    const cards = (cardsRes.data ?? []) as AnyRecord[];
    // Prefer a customer-specific card, else the default.
    const custCard = order?.customer_company_id
      ? cards.find((c) => c.customer_company_id === order.customer_company_id)
      : null;
    const card = custCard ?? cards.find((c) => c.is_default) ?? cards.find((c) => !c.customer_company_id) ?? null;
    return {
      card,
      zones: zonesRes.data ?? [],
      zoneRates: (card?.drayage_zone_rates ?? []) as AnyRecord[],
    };
  },

  // Lock the price onto the order using a chosen zone (authoritative server calc).
  'drayage.applyRate': async (input: { orderId: string; zoneId: string }) => {
    const { error } = await supabase.rpc('apply_drayage_rate', {
      p_order_id: input.orderId,
      p_zone_id: input.zoneId,
    });
    if (error) throwErr(error, 'Unable to apply rate');
    return { success: true };
  },

  // -------------------------------------------------------------------------
  // DEAD RUNS + STREET TURNS (0149)
  // -------------------------------------------------------------------------

  // Empty-mile analytics: empty legs + deadhead gaps costed per truck.
  // Returns null when migration 0149 hasn't been applied yet.
  'drayage.deadRuns': async (input: { days?: number } | undefined) => {
    const { data, error } = await supabase.rpc('drayage_dead_runs', { p_days: input?.days ?? 7 });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return null;
      throwErr(error, 'Unable to load dead runs');
    }
    return data;
  },

  'drayage.streetTurnSuggestions': async () => {
    const { data, error } = await supabase.rpc('drayage_street_turn_suggestions');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load street turn suggestions');
    }
    return (data ?? []) as AnyRecord[];
  },

  'drayage.linkStreetTurn': async (input: { providerOrderId: string; receiverOrderId: string }) => {
    const { error } = await supabase.rpc('link_street_turn', {
      p_provider_order_id: input.providerOrderId,
      p_receiver_order_id: input.receiverOrderId,
    });
    if (error) throwErr(error, 'Unable to pair street turn');
    return { success: true };
  },

  'drayage.unlinkStreetTurn': async (input: { orderId: string }) => {
    const { error } = await supabase.rpc('unlink_street_turn', { p_order_id: input.orderId });
    if (error) throwErr(error, 'Unable to unpair street turn');
    return { success: true };
  },

  'drayage.setDefaultCostPerMile': async (input: { rate: number }) => {
    const { error } = await supabase.rpc('set_company_cost_per_mile', { p_rate: input.rate });
    if (error) throwErr(error, 'Unable to save default cost per mile');
    return { success: true };
  },

  // -------------------------------------------------------------------------
  // AI COPILOT (0149) — context snapshot, watchdog, events, memory, chat
  // -------------------------------------------------------------------------

  // Live role-aware data snapshot embedded into the copilot system prompt.
  'ai.context': async () => {
    const { data, error } = await supabase.rpc('ai_copilot_context');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return null;
      throwErr(error, 'Unable to load copilot context');
    }
    return data ?? {};
  },

  'ai.runWatchdog': async () => {
    const { data, error } = await supabase.rpc('ai_run_watchdog');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return { created: 0, notReady: true };
      throwErr(error, 'Unable to run system scan');
    }
    return { created: Number(data ?? 0), notReady: false };
  },

  'ai.events': async () => {
    const { data, error } = await supabase
      .from('ai_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(120);
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load alerts');
    return data ?? [];
  },

  'ai.setEventStatus': async (input: { id: string; status: 'open' | 'resolved' | 'dismissed' }) => {
    const { error } = await supabase
      .from('ai_events')
      .update({ status: input.status, resolved_at: input.status === 'open' ? null : new Date().toISOString() })
      .eq('id', input.id);
    if (error) throwErr(error, 'Unable to update alert');
    return { success: true };
  },

  'ai.logError': async (input: { title: string; body?: string; entityType?: string; entityId?: string }) => {
    const { error } = await supabase.rpc('ai_log_event', {
      p_kind: 'error',
      p_severity: 'medium',
      p_title: input.title,
      p_body: input.body ?? '',
      p_entity_type: input.entityType ?? '',
      p_entity_id: input.entityId ?? '',
      p_dedupe_key: '',
    });
    if (error && !isMissingFunction(error) && !isMissingRelation(error)) throwErr(error, 'Unable to log');
    return { success: true };
  },

  'ai.memories': async (_input, ctx) => {
    const { data, error } = await supabase
      .from('ai_memories')
      .select('*')
      .eq('user_id', ctx.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load memories');
    return data ?? [];
  },

  'ai.addMemory': async (input: { content: string }, ctx) => {
    const content = input.content.trim();
    if (!content) throw new Error('Nothing to remember');
    const { error } = await supabase
      .from('ai_memories')
      .insert({ user_id: ctx.user.id, company_id: ctx.user.companyId, content });
    if (error) throwErr(error, 'Unable to save memory');
    return { success: true };
  },

  'ai.deleteMemory': async (input: { id: string }) => {
    const { error } = await supabase.from('ai_memories').delete().eq('id', input.id);
    if (error) throwErr(error, 'Unable to delete memory');
    return { success: true };
  },

  'ai.chatHistory': async (_input, ctx) => {
    const { data, error } = await supabase
      .from('ai_chat_messages')
      .select('*')
      .eq('user_id', ctx.user.id)
      .order('created_at', { ascending: true })
      .limit(200);
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load chat history');
    return data ?? [];
  },

  'ai.appendChat': async (input: { items: { role: 'user' | 'assistant'; content: string; actions?: unknown[] }[] }, ctx) => {
    const rows = input.items.map((m) => ({
      user_id: ctx.user.id,
      role: m.role,
      content: m.content,
      actions: m.actions ?? [],
    }));
    const { error } = await supabase.from('ai_chat_messages').insert(rows);
    if (error && !isMissingRelation(error)) throwErr(error, 'Unable to save chat');
    return { success: true };
  },

  'ai.clearChat': async (_input, ctx) => {
    const { error } = await supabase.from('ai_chat_messages').delete().eq('user_id', ctx.user.id);
    if (error) throwErr(error, 'Unable to clear chat');
    return { success: true };
  },

  // Auto watchdog: runs a scan at most once per throttle window per company.
  // Safe to call on any dashboard mount — the DB enforces the cadence.
  'ai.maybeRunWatchdog': async (input: { minMinutes?: number } | undefined) => {
    const { data, error } = await supabase.rpc('ai_maybe_run_watchdog', { p_min_minutes: input?.minMinutes ?? 30 });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return { ran: false, created: 0, notReady: true };
      throwErr(error, 'Unable to run system scan');
    }
    const r = (data ?? {}) as { ran?: boolean; created?: number };
    return { ran: !!r.ran, created: Number(r.created ?? 0), notReady: false };
  },

  // -------------------------------------------------------------------------
  // AI AGENT (0158) — provider directory, intake forwarding, support tickets
  // -------------------------------------------------------------------------

  'ai.providers': async (input: { types?: string[] } | undefined) => {
    const { data, error } = await supabase.rpc('ai_list_provider_companies', { p_types: input?.types ?? null });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load providers');
    }
    return (data ?? []) as unknown[];
  },

  'ai.forwardIntake': async (input: { targetCompanyId: string; subject: string; body: string }) => {
    const { data, error } = await supabase.rpc('ai_forward_intake', {
      p_target_company_id: input.targetCompanyId,
      p_subject: input.subject,
      p_body: input.body,
    });
    if (error) throwErr(error, 'Unable to send the request to the provider');
    return { threadId: data as string };
  },

  'tickets.create': async (input: { subject: string; summary?: string }) => {
    const { data, error } = await supabase.rpc('create_support_ticket', {
      p_subject: input.subject,
      p_summary: input.summary ?? '',
    });
    if (error) throwErr(error, 'Unable to create a support ticket');
    const r = (data ?? {}) as { ticketId?: string; threadId?: string };
    return { ticketId: r.ticketId ?? '', threadId: r.threadId ?? '' };
  },

  'tickets.list': async (input: { scope?: 'mine' | 'all' } | undefined) => {
    const { data, error } = await supabase.rpc('list_support_tickets', { p_scope: input?.scope ?? 'mine' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load tickets');
    }
    return (data ?? []) as unknown[];
  },

  'tickets.setStatus': async (input: { id: string; status: 'open' | 'in_progress' | 'resolved' }) => {
    const { error } = await supabase.rpc('set_support_ticket_status', { p_id: input.id, p_status: input.status });
    if (error) throwErr(error, 'Unable to update the ticket');
    return { success: true };
  },

  // =========================================================================
  // WORKSPACE CUSTOMIZATIONS — companies tailor their own pages, admins approve
  // =========================================================================
  'customization.mySettings': async () => {
    const { data, error } = await supabase.rpc('get_company_customizations');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return {};
      throwErr(error, 'Unable to load workspace settings');
    }
    return (data ?? {}) as Record<string, unknown>;
  },

  'customization.myRequests': async () => {
    const { data, error } = await supabase.rpc('list_customization_requests', { p_scope: 'mine' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load your requests');
    }
    return (data ?? []) as AnyRecord[];
  },

  'customization.allRequests': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.rpc('list_customization_requests', { p_scope: 'all' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load requests');
    }
    return (data ?? []) as AnyRecord[];
  },

  'customization.submit': async (input: { title: string; details?: string; payload?: Record<string, unknown> }) => {
    if (!input.title?.trim()) throw new Error('A short title is required');
    const { data, error } = await supabase.rpc('submit_customization_request', {
      p_title: input.title.trim(),
      p_details: input.details ?? '',
      p_payload: input.payload ?? {},
    });
    if (error) throwErr(error, 'Unable to submit your request');
    return { id: data as string };
  },

  'customization.decide': async (input: { requestId: string; approve: boolean; note?: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.rpc('decide_customization_request', {
      p_request_id: input.requestId,
      p_approve: input.approve,
      p_note: input.note ?? '',
    });
    if (error) throwErr(error, 'Unable to update the request');
    return (data ?? {}) as Record<string, unknown>;
  },

  // Admins read/edit a company's active settings directly (no request needed). Migration 0152.
  'customization.adminGet': async (input: { companyId: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.rpc('admin_get_company_customizations', { p_company_id: input.companyId });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return {};
      throwErr(error, 'Unable to load company settings');
    }
    return (data ?? {}) as Record<string, unknown>;
  },

  'customization.adminSet': async (input: { companyId: string; payload: Record<string, unknown> }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.rpc('admin_set_company_customizations', {
      p_company_id: input.companyId,
      p_payload: input.payload ?? {},
    });
    if (error) throwErr(error, 'Unable to save company settings');
    return (data ?? {}) as Record<string, unknown>;
  },

  'drayage.setOrderCustomFields': async (input: { orderId: string; values: Record<string, unknown> }) => {
    const { data, error } = await supabase.rpc('set_order_custom_fields', {
      p_order_id: input.orderId,
      p_values: input.values ?? {},
    });
    if (error) throwErr(error, 'Unable to save custom fields');
    return (data ?? {}) as Record<string, unknown>;
  },

  // Dispatch finalizes/changes how the container is handled at the stop
  // (Live load / Live unload / Drop & pick). Migration 0151.
  'drayage.setHandlingMode': async (input: { orderId: string; handlingMode: 'LiveLoad' | 'LiveUnload' | 'DropPick'; pickupBackDate?: string | null }) => {
    const { error } = await supabase.rpc('set_drayage_handling_mode', {
      p_order_id: input.orderId,
      p_handling_mode: input.handlingMode,
      p_pickup_back_date: input.handlingMode === 'DropPick' ? (input.pickupBackDate ?? null) : null,
    });
    if (error) throwErr(error, 'Unable to update handling mode');
    return { success: true };
  },

  // -------------------------------------------------------------------------
  // UNIVERSAL PROVIDER PRICING — zones, rate cards & accessorials for every
  // vertical (warehouse, trucking, labor, service, forwarding). Migration 0116.
  // -------------------------------------------------------------------------

  'pricing.myZones': async (input: { vertical: string }, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('provider_zones')
      .select('*')
      .eq('company_id', ctx.user.companyId)
      .eq('vertical', input.vertical)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load zones');
    return data ?? [];
  },

  'pricing.upsertZone': async (input: { id?: string | null; vertical: string; name: string; description?: string; sortOrder?: number; isActive?: boolean }, ctx) => {
    if (!ctx.user.companyId) throw new Error('No company associated with your account');
    const row: AnyRecord = {
      company_id: ctx.user.companyId,
      vertical: input.vertical,
      name: input.name.trim(),
      description: input.description ?? '',
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
      updated_at: new Date().toISOString(),
    };
    if (input.id) row.id = input.id;
    const { data, error } = await supabase.from('provider_zones').upsert(row).select().single();
    if (error) throwErr(error, 'Unable to save zone');
    return data;
  },

  'pricing.deleteZone': async (input: { id: string }) => {
    const { error } = await supabase.from('provider_zones').delete().eq('id', input.id);
    if (error) throwErr(error, 'Unable to delete zone');
    return { success: true };
  },

  'pricing.myRateCards': async (input: { vertical: string }, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('provider_rate_cards')
      .select('*, provider_zone_rates(*), customer:customer_company_id(id, name)')
      .eq('company_id', ctx.user.companyId)
      .eq('vertical', input.vertical)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load rate cards');
    return data ?? [];
  },

  'pricing.upsertRateCard': async (input: AnyRecord, ctx) => {
    if (!ctx.user.companyId) throw new Error('No company associated with your account');
    const row: AnyRecord = {
      company_id: ctx.user.companyId,
      vertical: String(input.vertical),
      customer_company_id: input.customerCompanyId ?? null,
      name: String(input.name ?? 'Standard rates').trim(),
      currency: input.currency ?? 'CAD',
      base_unit: input.baseUnit ?? '',
      is_default: input.isDefault ?? false,
      is_active: input.isActive ?? true,
      updated_at: new Date().toISOString(),
    };
    if (input.accessorials !== undefined) row.accessorials = input.accessorials;
    if (input.id) row.id = input.id;
    const { data, error } = await supabase.from('provider_rate_cards').upsert(row).select().single();
    if (error) throwErr(error, 'Unable to save rate card');
    return data;
  },

  'pricing.deleteRateCard': async (input: { id: string }) => {
    const { error } = await supabase.from('provider_rate_cards').delete().eq('id', input.id);
    if (error) throwErr(error, 'Unable to delete rate card');
    return { success: true };
  },

  'pricing.setZoneRate': async (input: { rateCardId: string; zoneId: string; baseRate: number }) => {
    const { error } = await supabase.from('provider_zone_rates').upsert(
      { rate_card_id: input.rateCardId, zone_id: input.zoneId, base_rate: input.baseRate, updated_at: new Date().toISOString() },
      { onConflict: 'rate_card_id,zone_id' },
    );
    if (error) throwErr(error, 'Unable to save zone rate');
    return { success: true };
  },

  // Companies a provider can scope a private card to (any other approved company).
  'pricing.listCustomerCompanies': async (_input, ctx) => {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, city, type, status')
      .eq('status', 'Approved')
      .order('name', { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load companies');
    return (data ?? []).filter((c) => c.id !== ctx.user.companyId);
  },

  // Resolve the published card + zones that apply to a (company, vertical, customer)
  // so a customer-facing screen can show the pricing and estimate a charge.
  'pricing.cardForCompany': async (input: { companyId: string; vertical: string; customerCompanyId?: string | null }) => {
    if (!input.companyId) return { card: null, zones: [], zoneRates: [] };
    const [zonesRes, cardsRes] = await Promise.all([
      supabase.from('provider_zones').select('*').eq('company_id', input.companyId).eq('vertical', input.vertical).eq('is_active', true).order('sort_order'),
      supabase.from('provider_rate_cards').select('*, provider_zone_rates(*)').eq('company_id', input.companyId).eq('vertical', input.vertical).eq('is_active', true),
    ]);
    if (isMissingRelation(zonesRes.error) || isMissingRelation(cardsRes.error)) return { card: null, zones: [], zoneRates: [] };
    const cards = (cardsRes.data ?? []) as AnyRecord[];
    const custCard = input.customerCompanyId
      ? cards.find((c) => c.customer_company_id === input.customerCompanyId)
      : null;
    const card = custCard ?? cards.find((c) => c.is_default) ?? cards.find((c) => !c.customer_company_id) ?? null;
    return {
      card,
      zones: zonesRes.data ?? [],
      zoneRates: (card?.provider_zone_rates ?? []) as AnyRecord[],
    };
  },

  // Authoritative server-side quote for a chosen card + zone + selected add-ons.
  'pricing.computeQuote': async (input: { cardId: string; zoneId?: string | null; selected?: Record<string, number> }) => {
    const { data, error } = await supabase.rpc('provider_compute_quote', {
      p_card_id: input.cardId,
      p_zone_id: input.zoneId ?? null,
      p_selected: input.selected ?? {},
    });
    if (error) throwErr(error, 'Unable to compute quote');
    return data as { currency: string; base: number; lines: { key: string; label: string; amount: number }[]; total: number };
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

  // Opens (or reuses) the conversation tied to a load so the shipper, the
  // assigned driver and the fleet dispatcher can all talk in one thread.
  'messaging.openLoadThread': async (input: { loadId: string }) => {
    const { data, error } = await supabase.rpc('open_load_thread', { p_load_id: input.loadId });
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
    // Shift-scoped conversations are only open while the worker is accepted and
    // the shift is still active. Surface that window so the UI can lock the input
    // once a shift is over (or before anyone is accepted).
    let messagingClosed = false;
    const shiftId = (data as { shift_id?: string | null }).shift_id ?? null;
    if (shiftId) {
      const { data: openData } = await supabase.rpc('shift_chat_is_open', { p_shift_id: shiftId });
      messagingClosed = openData !== true;
    }
    return { ...data, messaging_closed: messagingClosed };
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
  // FREIGHT PRICING — rate cards (global + per-company) & commission overrides
  // =========================================================================
  // Lists every rate card row. Global rows have company_id = null; company
  // overrides carry a company_id. The console groups them client-side.
  'admin.listRateCards': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase
      .from('load_rate_cards')
      .select('*')
      .order('company_id', { ascending: true, nullsFirst: true })
      .order('vehicle_type', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load rate cards');
    }
    return data ?? [];
  },

  'admin.upsertRateCard': async (input: {
    companyId?: string | null; vehicleType: string;
    basePrice: number; perKm: number; perPallet: number; sameDayMultiplier: number;
    handlingFeePerPallet?: number; storageFeePerPalletDay?: number;
  }) => {
    const { data, error } = await supabase.rpc('admin_upsert_rate_card', {
      p_company_id: input.companyId ?? null,
      p_vehicle_type: input.vehicleType,
      p_base_price: input.basePrice,
      p_per_km: input.perKm,
      p_per_pallet: input.perPallet,
      p_same_day_multiplier: input.sameDayMultiplier,
      p_handling_fee_per_pallet: input.handlingFeePerPallet ?? 5,
      p_storage_fee_per_pallet_day: input.storageFeePerPalletDay ?? 2,
    });
    if (error) throwErr(error, 'Unable to save rate card — admin only');
    return { id: data as string };
  },

  'admin.deleteRateCard': async (input: { id: string }) => {
    const { error } = await supabase.rpc('admin_delete_rate_card', { p_id: input.id });
    if (error) throwErr(error, 'Unable to delete rate card');
    return { success: true };
  },

  'admin.listCommissionOverrides': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.from('load_commission_overrides').select('*');
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load commission overrides');
    }
    return data ?? [];
  },

  'admin.upsertCommissionOverride': async (input: { companyId: string; commissionPercentage: number; bookingFee: number }) => {
    const { error } = await supabase.rpc('admin_upsert_commission_override', {
      p_company_id: input.companyId,
      p_commission_percentage: input.commissionPercentage,
      p_booking_fee: input.bookingFee,
    });
    if (error) throwErr(error, 'Unable to save commission override');
    return { success: true };
  },

  'admin.deleteCommissionOverride': async (input: { companyId: string }) => {
    const { error } = await supabase.rpc('admin_delete_commission_override', { p_company_id: input.companyId });
    if (error) throwErr(error, 'Unable to delete commission override');
    return { success: true };
  },

  // Companies the admin can attach a pricing override to.
  'admin.listCompaniesForPricing': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, type')
      .order('name', { ascending: true });
    if (error) throwErr(error, 'Unable to load companies');
    return (data ?? []).map((c) => ({ id: String(c.id), name: String((c as AnyRecord).name ?? 'Company'), type: String((c as AnyRecord).type ?? '') }));
  },

  // =========================================================================
  // ADVERTISEMENTS
  // =========================================================================
  // ads.serve — active ads for the given placement (a role segment key) plus
  // any 'all' placements, filtered to the current flight window. Ordered by
  // priority so the highest-value sponsor wins the rotation slot.
  'ads.serve': async (input: { placement?: string } | undefined) => {
    const placement = input?.placement ?? 'all';
    const nowIso = new Date().toISOString();
    // Try the rich schema first (0120). Fall back to the base columns if the
    // migration hasn't been applied yet, so the banner never hard-fails.
    const richCols = 'id,title,body,image_url,target_url,cta_label,advertiser_name,placement,placements,links,priority,starts_at,ends_at,media_type,video_url,link_type,max_impressions,weight,impressions,clicks,pricing_model,cpm_rate,cpc_rate,budget_cap';
    let data: AnyRecord[] | null = null;
    let error: unknown = null;
    {
      const res = await supabase
        .from('advertisements')
        .select(richCols)
        .eq('status', 'Active')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      data = res.data as AnyRecord[] | null;
      error = res.error;
    }
    if (error && isMissingColumn(error)) {
      const res = await supabase
        .from('advertisements')
        .select('id,title,body,image_url,target_url,cta_label,advertiser_name,placement,priority,starts_at,ends_at')
        .eq('status', 'Active')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      data = res.data as AnyRecord[] | null;
      error = res.error;
    }
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load ads');
    }
    return (data ?? []).filter((a) => {
      // Placement membership: an ad shows if it targets 'all', the current
      // placement, or lists it in the multi-placement array.
      const list = Array.isArray(a.placements) && (a.placements as string[]).length > 0
        ? (a.placements as string[])
        : [a.placement as string];
      if (!list.includes('all') && !list.includes(placement)) return false;
      const startsAt = a.starts_at as string | null;
      const endsAt = a.ends_at as string | null;
      if (startsAt && startsAt > nowIso) return false;
      if (endsAt && endsAt < nowIso) return false;
      const cap = Number(a.max_impressions ?? 0);
      const shown = Number(a.impressions ?? 0);
      if (cap > 0 && shown >= cap) return false;
      // Budget cap: stop serving once delivery has earned the ad's whole budget.
      const budget = Number(a.budget_cap ?? 0);
      if (budget > 0) {
        const model = String(a.pricing_model ?? 'flat');
        const accrued = model === 'cpm'
          ? (shown / 1000) * Number(a.cpm_rate ?? 0)
          : model === 'cpc'
            ? Number(a.clicks ?? 0) * Number(a.cpc_rate ?? 0)
            : 0;
        if (accrued >= budget) return false;
      }
      return true;
    });
  },

  'ads.recordImpression': async (input: { id: string }) => {
    const { error } = await supabase.rpc('ad_record_impression', { p_id: input.id });
    if (error && !isMissingRelation(error)) {
      // Impression tracking is best-effort — never surface to the user.
      return { success: false };
    }
    return { success: true };
  },

  'ads.recordClick': async (input: { id: string; linkType?: string }) => {
    // Prefer the per-link tracker (0122): it bumps the total click counter AND
    // the per-destination breakdown in one call. Fall back to the legacy total-
    // only counter if the migration/function isn't present yet.
    if (input.linkType && input.linkType.length > 0) {
      const res = await supabase.rpc('ad_record_link_click', {
        p_id: input.id,
        p_link_type: input.linkType,
      });
      if (!res.error) return { success: true };
    }
    const { error } = await supabase.rpc('ad_record_click', { p_id: input.id });
    if (error && !isMissingRelation(error)) {
      return { success: false };
    }
    return { success: true };
  },

  // ── Admin ad management ────────────────────────────────────────────────
  'admin.listAds': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase
      .from('advertisements')
      .select('*')
      .order('status', { ascending: true })
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load ads');
    }
    return data ?? [];
  },

  'admin.upsertAd': async (input: {
    id?: string | null;
    title: string; body?: string; imageUrl?: string; targetUrl?: string; ctaLabel?: string;
    advertiserName?: string; advertiserCompanyId?: string | null;
    placement?: string; placements?: string[]; status?: string; priority?: number;
    startsAt?: string | null; endsAt?: string | null;
    mediaType?: string; videoUrl?: string; linkType?: string;
    links?: { type: string; value: string }[];
    maxImpressions?: number; weight?: number;
    pricingModel?: string; price?: number; cpmRate?: number; cpcRate?: number; budgetCap?: number;
  }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    // Normalise the multi-placement list; fall back to the single placement / 'all'.
    const placements = (input.placements ?? []).filter((p) => p && p.length > 0);
    const primaryPlacement = placements.includes('all')
      ? 'all'
      : (placements[0] ?? (input.placement && input.placement.length > 0 ? input.placement : 'all'));
    // Normalise the link list; keep only entries with a value.
    const links = (input.links ?? []).filter((l) => l && l.value && l.value.trim().length > 0)
      .map((l) => ({ type: l.type, value: l.value.trim() }));
    const primaryLink = links[0];
    const baseRow: AnyRecord = {
      title: input.title,
      body: input.body ?? '',
      image_url: input.imageUrl ?? '',
      target_url: primaryLink?.value ?? input.targetUrl ?? '',
      cta_label: input.ctaLabel && input.ctaLabel.length > 0 ? input.ctaLabel : 'Learn more',
      advertiser_name: input.advertiserName ?? '',
      advertiser_company_id: input.advertiserCompanyId ?? null,
      placement: primaryPlacement,
      status: input.status && input.status.length > 0 ? input.status : 'Active',
      priority: input.priority ?? 0,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      updated_at: new Date().toISOString(),
    };
    const richRow: AnyRecord = {
      ...baseRow,
      placements: placements.length > 0 ? placements : [primaryPlacement],
      links,
      media_type: input.mediaType && input.mediaType.length > 0 ? input.mediaType : 'image',
      video_url: input.videoUrl ?? '',
      link_type: primaryLink?.type ?? (input.linkType && input.linkType.length > 0 ? input.linkType : 'website'),
      max_impressions: input.maxImpressions ?? 0,
      weight: input.weight ?? 1,
    };
    const usageRow: AnyRecord = {
      pricing_model: input.pricingModel && input.pricingModel.length > 0 ? input.pricingModel : 'flat',
      price: Math.max(0, Number(input.price ?? 0)),
      cpm_rate: Math.max(0, Number(input.cpmRate ?? 0)),
      cpc_rate: Math.max(0, Number(input.cpcRate ?? 0)),
      budget_cap: Math.max(0, Number(input.budgetCap ?? 0)),
    };
    const runUpsert = async (row: AnyRecord) => {
      if (input.id) {
        return supabase.from('advertisements').update(row).eq('id', input.id).select('id').maybeSingle();
      }
      return supabase.from('advertisements').insert({ ...row, created_by: ctx.user.id }).select('id').maybeSingle();
    };
    let res = await runUpsert({ ...richRow, ...usageRow });
    if (res.error && isMissingColumn(res.error)) {
      // 0127 not applied yet — retry without the usage-billing columns.
      res = await runUpsert(richRow);
    }
    if (res.error && isMissingColumn(res.error)) {
      // 0120 not applied yet — persist the base creative so the ad still saves.
      res = await runUpsert(baseRow);
    }
    if (res.error) throwErr(res.error, input.id ? 'Unable to update ad' : 'Unable to create ad');
    return { id: String((res.data as AnyRecord | null)?.id ?? input.id ?? '') };
  },

  // Bill the unbilled delivery of an ad (CPM/CPC/flat) — issues an invoice +
  // captured payment via the sandbox engine and advances the billed watermarks.
  'admin.billAdUsage': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.rpc('admin_bill_ad_usage', { p_id: input.id });
    if (error) throwErr(error, 'Unable to bill this ad');
    return { billed: Number(data ?? 0) };
  },

  'admin.setAdStatus': async (input: { id: string; status: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase
      .from('advertisements')
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq('id', input.id);
    if (error) throwErr(error, 'Unable to update ad status');
    return { success: true };
  },

  'admin.deleteAd': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.from('advertisements').delete().eq('id', input.id);
    if (error) throwErr(error, 'Unable to delete ad');
    return { success: true };
  },

  // ── Self-serve advertising (members advertise their own business) ────────
  // A member submits an ad → super admin sets a price (quote) → member pays →
  // super admin approves → the ad goes live. See migration 0123.
  'ads.mySubmissions': async (_input, ctx) => {
    const { data, error } = await supabase
      .from('advertisements')
      .select('*')
      .eq('submitted_by', ctx.user.id)
      .eq('source', 'self_serve')
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error) || isMissingColumn(error)) return [];
      throwErr(error, 'Unable to load your ads');
    }
    return data ?? [];
  },

  'ads.submitAd': async (input: {
    id?: string | null;
    title: string; body?: string; imageUrl?: string; ctaLabel?: string;
    advertiserName?: string; placements?: string[];
    mediaType?: string; videoUrl?: string;
    links?: { type: string; value: string }[];
  }, ctx) => {
    if (!input.title || input.title.trim().length === 0) throw new Error('Give your ad a title.');
    const placements = (input.placements ?? []).filter((p) => p && p.length > 0);
    const primaryPlacement = placements.includes('all')
      ? 'all'
      : (placements[0] ?? 'all');
    const links = (input.links ?? []).filter((l) => l && l.value && l.value.trim().length > 0)
      .map((l) => ({ type: l.type, value: l.value.trim() }));
    const primaryLink = links[0];
    const row: AnyRecord = {
      title: input.title.trim(),
      body: (input.body ?? '').trim(),
      image_url: (input.imageUrl ?? '').trim(),
      target_url: primaryLink?.value ?? '',
      cta_label: input.ctaLabel && input.ctaLabel.trim().length > 0 ? input.ctaLabel.trim() : 'Learn more',
      advertiser_name: (input.advertiserName ?? '').trim(),
      advertiser_company_id: ctx.user.companyId,
      owner_company_id: ctx.user.companyId,
      placement: primaryPlacement,
      placements: placements.length > 0 ? placements : [primaryPlacement],
      links,
      media_type: input.mediaType && input.mediaType.length > 0 ? input.mediaType : 'image',
      video_url: (input.videoUrl ?? '').trim(),
      link_type: primaryLink?.type ?? 'website',
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      // Edit an existing draft — RLS only allows this while Pending.
      const { error } = await supabase.from('advertisements')
        .update(row).eq('id', input.id).eq('submitted_by', ctx.user.id);
      if (error) throwErr(error, 'Unable to update your ad');
      return { id: input.id };
    }
    const { data, error } = await supabase.from('advertisements')
      .insert({
        ...row,
        source: 'self_serve',
        submitted_by: ctx.user.id,
        status: 'Paused',
        review_status: 'Pending',
        price: 0,
        weight: 1,
        priority: 0,
        created_by: ctx.user.id,
      })
      .select('id').maybeSingle();
    if (error) throwErr(error, 'Unable to submit your ad');
    return { id: String((data as AnyRecord | null)?.id ?? '') };
  },

  'ads.payAd': async (input: { id: string }, ctx) => {
    // Confirm the member owns this ad and it is awaiting payment, then record
    // the payment via the SECURITY DEFINER function (0123).
    const { error } = await supabase.rpc('ad_mark_paid', { p_id: input.id });
    if (error) throwErr(error, 'Unable to record payment');
    return { success: true };
  },

  'ads.cancelSubmission': async (input: { id: string }, ctx) => {
    const { error } = await supabase.from('advertisements')
      .delete().eq('id', input.id).eq('submitted_by', ctx.user.id);
    if (error) throwErr(error, 'Unable to cancel your ad');
    return { success: true };
  },

  'admin.quoteAd': async (input: { id: string; price: number; currency?: string; note?: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.from('advertisements').update({
      price: Math.max(0, Number(input.price) || 0),
      currency: input.currency && input.currency.length > 0 ? input.currency : 'CAD',
      review_status: 'Quoted',
      admin_note: input.note ?? '',
      updated_at: new Date().toISOString(),
    }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to send quote');
    return { success: true };
  },

  'admin.approveAd': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    // Run the sandbox settle engine so a paid member ad produces a real invoice
    // + captured payment before it goes live. Ignore "already settled" so
    // approving twice is safe; a genuine failure still surfaces below.
    const { data: ad } = await supabase.from('advertisements')
      .select('source, price').eq('id', input.id).maybeSingle();
    const adRow = ad as { source?: string | null; price?: number | null } | null;
    if (adRow?.source === 'self_serve' && Number(adRow.price ?? 0) > 0) {
      const { error: settleError } = await supabase.rpc('admin_settle_advertisement', { p_id: input.id });
      if (settleError && !/already|settled|exists/i.test(settleError.message ?? '')) {
        throwErr(settleError, 'Unable to bill this ad');
      }
    }
    const { error } = await supabase.from('advertisements').update({
      review_status: 'Approved',
      status: 'Active',
      updated_at: new Date().toISOString(),
    }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to approve ad');
    return { success: true };
  },

  'admin.rejectAd': async (input: { id: string; note?: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.from('advertisements').update({
      review_status: 'Rejected',
      status: 'Paused',
      admin_note: input.note ?? '',
      updated_at: new Date().toISOString(),
    }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to reject ad');
    return { success: true };
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

  // overview — platform-wide report. Counts real operational activity across ALL
  // job types (warehouse bookings, drayage moves, worker shifts) so completed test
  // jobs show up, not just warehouse bookings. Field names match analytics.tsx.
  'analytics.overview': async () => {
    const [bookings, payments, companies, disputes, moves, assignments, ads] = await Promise.all([
      supabase.from('warehouse_bookings').select('id,status'),
      supabase.from('payments').select('gross_amount,commission_amount,category,status'),
      supabase.from('companies').select('id,status'),
      supabase.from('disputes').select('id,status'),
      supabase.from('drayage_moves').select('id,status'),
      supabase.from('shift_assignments').select('id,status'),
      supabase.from('advertisements').select('id,status,impressions,clicks,billed_amount'),
    ]);

    const settled = ['Paid', 'Captured'];
    const settledPayments = (payments.data ?? []).filter((p) => settled.includes(String(p.status)));
    const gmv = settledPayments.reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);

    // Platform revenue = commission we actually keep, by marketplace area.
    const commission = { trucking: 0, warehouse: 0, service: 0, labour: 0, advertising: 0, other: 0, total: 0 };
    for (const p of settledPayments) {
      const amt = Number(p.commission_amount ?? 0);
      if (amt <= 0) continue;
      const cat = String(p.category ?? 'other');
      if (cat in commission) (commission as Record<string, number>)[cat] += amt;
      else commission.other += amt;
      commission.total += amt;
    }

    // Advertising delivery + revenue.
    const adRows = ads.data ?? [];
    const adStats = {
      active: adRows.filter((a) => String(a.status) === 'Active').length,
      total: adRows.length,
      impressions: adRows.reduce((s, a) => s + Number(a.impressions ?? 0), 0),
      clicks: adRows.reduce((s, a) => s + Number(a.clicks ?? 0), 0),
      revenue: Math.round(adRows.reduce((s, a) => s + Number(a.billed_amount ?? 0), 0)),
    };

    const bookingRows = bookings.data ?? [];
    const moveRows = moves.data ?? [];
    const shiftRows = assignments.data ?? [];

    const bookingDone = ['Completed', 'CheckedOut', 'Fulfilled'];
    const shiftDone = ['Completed', 'HoursConfirmed', 'Confirmed'];

    // Every operational job the platform has run, of any type.
    const bookingVolume = bookingRows.length + moveRows.length + shiftRows.length;

    const completed =
      bookingRows.filter((b) => bookingDone.includes(String(b.status))).length +
      moveRows.filter((m) => String(m.status) === 'Completed').length +
      shiftRows.filter((a) => shiftDone.includes(String(a.status))).length;

    const utilizationRate = bookingVolume > 0 ? Math.round((completed / bookingVolume) * 100) : 0;
    const activeCompanies = (companies.data ?? []).filter((c) => c.status === 'Approved').length;

    return {
      bookingVolume,
      revenue: Math.round(commission.total),
      utilizationRate,
      companyPerformance: completed,
      grossBookingValue: Math.round(gmv),
      commission: {
        trucking: Math.round(commission.trucking),
        warehouse: Math.round(commission.warehouse),
        service: Math.round(commission.service),
        labour: Math.round(commission.labour),
        advertising: Math.round(commission.advertising),
        other: Math.round(commission.other),
        total: Math.round(commission.total),
      },
      ads: adStats,
      // extra fields kept for any other consumers
      totalBookings: bookingVolume,
      completedJobs: completed,
      activeCompanies,
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
    requestQuote?: boolean; cargoValue?: number | null;
  }, ctx) => {
    const cid = input.customerCompanyId ?? ctx.user.companyId;
    if (!cid) throw new Error('Company context required');
    const row: AnyRecord = {
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
    };
    // Marketplace requests go through the quote flow; degrade gracefully if the
    // 0133 columns aren't live yet.
    if (input.requestQuote) row.quote_status = 'requested';
    if (input.cargoValue != null) row.cargo_value = input.cargoValue;
    let res = await supabase.from('service_jobs').insert(row).select().single();
    if (res.error && isMissingColumn(res.error)) {
      delete row.quote_status; delete row.cargo_value;
      res = await supabase.from('service_jobs').insert(row).select().single();
    }
    if (res.error) throwErr(res.error, 'Unable to create service job');
    return { id: res.data!.id };
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

  // --- Marketplace quote → order flow -------------------------------------
  // Provider sends an official price for a quote request.
  'serviceJobs.sendQuote': async (input: { id: string; amount: number; notes?: string; commissionRate?: number }) => {
    const { error } = await supabase.rpc('send_service_quote', {
      p_job_id: input.id,
      p_amount: Number(input.amount) || 0,
      p_notes: input.notes ?? '',
      p_commission_rate: input.commissionRate ?? 0.08,
    });
    if (error) throwErr(error, 'Unable to send quote');
    return { success: true };
  },
  // Customer accepts or declines a received quote.
  'serviceJobs.respondQuote': async (input: { id: string; accept: boolean }) => {
    const { error } = await supabase.rpc('respond_service_quote', {
      p_job_id: input.id,
      p_accept: input.accept,
    });
    if (error) throwErr(error, 'Unable to respond to quote');
    return { success: true };
  },
  // Provider bills a job — creates an invoice with platform commission.
  'serviceJobs.invoice': async (input: { id: string; taxRate?: number; commissionRate?: number }) => {
    const { data, error } = await supabase.rpc('invoice_service_job', {
      p_job_id: input.id,
      p_tax_rate: Number(input.taxRate) || 0,
      p_commission_rate: input.commissionRate ?? 0.08,
    });
    if (error) throwErr(error, 'Unable to invoice job');
    return { invoiceId: data as string };
  },
  // Job photos — before/after/progress evidence.
  'serviceJobs.listPhotos': async (input: { id: string }) => {
    const { data, error } = await supabase
      .from('service_job_photos')
      .select('*')
      .eq('job_id', input.id)
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load photos');
    }
    return (data ?? []).map((p: Row) => ({
      id: p.id,
      jobId: p.job_id,
      url: p.url,
      caption: p.caption ?? '',
      kind: p.kind ?? 'progress',
      createdAt: p.created_at ?? new Date().toISOString(),
    }));
  },
  'serviceJobs.addPhoto': async (input: { id: string; url: string; caption?: string; kind?: string }, ctx) => {
    const { data, error } = await supabase.from('service_job_photos').insert({
      job_id: input.id,
      url: input.url,
      caption: input.caption ?? '',
      kind: input.kind ?? 'progress',
      uploaded_by: ctx.user.id,
    }).select().single();
    if (error) throwErr(error, 'Unable to add photo');
    return { id: data!.id };
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
      skills: Array.isArray(input.skills) && input.skills.length > 0 ? input.skills : [input.category],
      is_ongoing: Boolean(input.isOngoing),
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
  // EMPLOYMENT AGENCY (Domain 1) — roster, clients, claims, payables (0154)
  // =========================================================================
  'agency.workers': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('agency_workers')
      .select('*')
      .eq('agency_company_id', ctx.user.companyId)
      .neq('status', 'Removed')
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load your worker roster');
    }
    return data ?? [];
  },
  'agency.addWorker': async (input: { name: string; email?: string; phone?: string; hourlyCost?: number }) => {
    const { data, error } = await supabase.rpc('agency_add_worker', {
      p_name: input.name,
      p_email: input.email ?? '',
      p_phone: input.phone ?? '',
      p_hourly_cost: input.hourlyCost ?? 0,
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Agency features are not live yet — apply migration 0154.');
      throwErr(error, 'Unable to add worker');
    }
    return { id: data as string };
  },
  'agency.setWorkerStatus': async (input: { id: string; status: 'Active' | 'Removed' }, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { error } = await supabase
      .from('agency_workers')
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq('id', input.id)
      .eq('agency_company_id', ctx.user.companyId);
    if (error) throwErr(error, 'Unable to update worker');
    return { success: true };
  },
  'agency.clients': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('agency_clients')
      .select('*')
      .eq('agency_company_id', ctx.user.companyId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load clients');
    }
    return data ?? [];
  },
  'agency.addClient': async (input: { name: string; contactName?: string; email?: string; phone?: string; address?: string; notes?: string }, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { data, error } = await supabase
      .from('agency_clients')
      .insert({
        agency_company_id: ctx.user.companyId,
        name: input.name,
        contact_name: input.contactName ?? '',
        email: input.email ?? '',
        phone: input.phone ?? '',
        address: input.address ?? '',
        notes: input.notes ?? '',
      })
      .select('id')
      .single();
    if (error) {
      if (isMissingRelation(error)) throw new Error('Agency features are not live yet — apply migration 0154.');
      throwErr(error, 'Unable to add client');
    }
    return { id: data!.id as string };
  },
  'agency.setClientStatus': async (input: { id: string; status: 'Active' | 'Inactive' }, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { error } = await supabase
      .from('agency_clients')
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq('id', input.id)
      .eq('agency_company_id', ctx.user.companyId);
    if (error) throwErr(error, 'Unable to update client');
    return { success: true };
  },
  'agency.claimShift': async (input: { shiftId: string; agencyWorkerId: string }) => {
    const { data, error } = await supabase.rpc('agency_claim_shift', {
      p_shift_id: input.shiftId,
      p_agency_worker_id: input.agencyWorkerId,
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Agency features are not live yet — apply migration 0154.');
      throwErr(error, 'Unable to claim shift');
    }
    return { assignmentId: data as string };
  },
  'agency.assignments': async () => {
    const { data, error } = await supabase.rpc('agency_list_assignments');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load placements');
    }
    return data ?? [];
  },
  'agency.payables': async () => {
    const { data, error } = await supabase.rpc('agency_list_payables');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load payables');
    }
    return data ?? [];
  },

  // =========================================================================
  // CUSTOMS BROKER (Domain 4) — clearance requests, docs, messages (0155)
  // =========================================================================
  'clearance.create': async (input: {
    title: string; mode?: 'Import' | 'Export'; containerNo?: string; blNumber?: string;
    port?: string; eta?: string; cargoDescription?: string; commercialValue?: number;
    currency?: string; incoterms?: string; notes?: string;
  }) => {
    const { data, error } = await supabase.rpc('clearance_create_request', {
      p_title: input.title,
      p_mode: input.mode ?? 'Import',
      p_container_no: input.containerNo ?? '',
      p_bl_number: input.blNumber ?? '',
      p_port: input.port ?? '',
      p_eta: input.eta ?? null,
      p_cargo_description: input.cargoDescription ?? '',
      p_commercial_value: input.commercialValue ?? 0,
      p_currency: input.currency ?? 'CAD',
      p_incoterms: input.incoterms ?? '',
      p_notes: input.notes ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Customs clearance is not live yet — apply migration 0155.');
      throwErr(error, 'Unable to submit clearance request');
    }
    return { id: data as string };
  },
  'clearance.mine': async () => {
    const { data, error } = await supabase.rpc('clearance_list_mine');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load clearance requests');
    }
    return data ?? [];
  },
  'clearance.get': async (input: { requestId: string }) => {
    const { data, error } = await supabase
      .from('clearance_requests')
      .select('*')
      .eq('id', input.requestId)
      .maybeSingle();
    if (error) {
      if (isMissingRelation(error)) return null;
      throwErr(error, 'Unable to load request');
    }
    return data ?? null;
  },
  'clearance.documents': async (input: { requestId: string }) => {
    const { data, error } = await supabase
      .from('clearance_documents')
      .select('*')
      .eq('request_id', input.requestId)
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load documents');
    }
    return data ?? [];
  },
  'clearance.messages': async (input: { requestId: string }) => {
    const { data, error } = await supabase
      .from('clearance_messages')
      .select('*')
      .eq('request_id', input.requestId)
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load messages');
    }
    return data ?? [];
  },
  'clearance.sendMessage': async (input: { requestId: string; body: string }) => {
    const { error } = await supabase.rpc('clearance_send_message', {
      p_request_id: input.requestId,
      p_body: input.body,
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Customs clearance is not live yet — apply migration 0155.');
      throwErr(error, 'Unable to send message');
    }
    return { success: true };
  },
  'clearance.acceptQuote': async (input: { requestId: string }) => {
    const { error } = await supabase.rpc('clearance_accept_quote', { p_request_id: input.requestId });
    if (error) throwErr(error, 'Unable to accept quote');
    return { success: true };
  },
  'clearance.cancel': async (input: { requestId: string }) => {
    const { error } = await supabase.rpc('clearance_cancel_request', { p_request_id: input.requestId });
    if (error) throwErr(error, 'Unable to cancel request');
    return { success: true };
  },
  'clearance.submitDocument': async (input: {
    requestId: string; filePath: string; name: string; docType?: string; documentId?: string;
  }) => {
    const { data, error } = await supabase.rpc('clearance_submit_document', {
      p_request_id: input.requestId,
      p_file_path: input.filePath,
      p_name: input.name,
      p_doc_type: input.docType ?? 'Other',
      p_document_id: input.documentId ?? null,
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Customs clearance is not live yet — apply migration 0155.');
      throwErr(error, 'Unable to save document');
    }
    return { id: data as string };
  },
  'broker.requests': async (input: { scope?: 'open' | 'mine' } | undefined) => {
    const { data, error } = await supabase.rpc('broker_list_requests', { p_scope: input?.scope ?? 'mine' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load requests');
    }
    return data ?? [];
  },
  'broker.claim': async (input: { requestId: string }) => {
    const { error } = await supabase.rpc('broker_claim_request', { p_request_id: input.requestId });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Customs broker features are not live yet — apply migration 0155.');
      throwErr(error, 'Unable to claim request');
    }
    return { success: true };
  },
  'broker.quote': async (input: { requestId: string; amount: number; note?: string }) => {
    const { error } = await supabase.rpc('broker_quote', {
      p_request_id: input.requestId,
      p_amount: input.amount,
      p_note: input.note ?? '',
    });
    if (error) throwErr(error, 'Unable to send quote');
    return { success: true };
  },
  'broker.requestDocument': async (input: { requestId: string; name: string; docType?: string; note?: string }) => {
    const { data, error } = await supabase.rpc('broker_request_document', {
      p_request_id: input.requestId,
      p_name: input.name,
      p_doc_type: input.docType ?? 'Other',
      p_note: input.note ?? '',
    });
    if (error) throwErr(error, 'Unable to request document');
    return { id: data as string };
  },
  'broker.setDocumentStatus': async (input: { documentId: string; status: 'Accepted' | 'Rejected'; note?: string }) => {
    const { error } = await supabase.rpc('broker_set_document_status', {
      p_document_id: input.documentId,
      p_status: input.status,
      p_note: input.note ?? '',
    });
    if (error) throwErr(error, 'Unable to update document');
    return { success: true };
  },
  'broker.markCleared': async (input: { requestId: string; entryNumber?: string }) => {
    const { data, error } = await supabase.rpc('broker_mark_cleared', {
      p_request_id: input.requestId,
      p_entry_number: input.entryNumber ?? '',
    });
    if (error) throwErr(error, 'Unable to mark as cleared');
    return { invoiceId: data as string };
  },
  'broker.reject': async (input: { requestId: string; reason?: string }) => {
    const { error } = await supabase.rpc('broker_reject_request', {
      p_request_id: input.requestId,
      p_reason: input.reason ?? '',
    });
    if (error) throwErr(error, 'Unable to decline request');
    return { success: true };
  },
  'broker.billing': async () => {
    const { data, error } = await supabase.rpc('broker_list_billing');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load billing');
    }
    return data ?? [];
  },

  // =========================================================================
  // OCEAN BOOKING BOARD (0162) — worldwide container shipping, bid model
  // =========================================================================
  'ocean.create': async (input: {
    title: string; originCountry?: string; originPort?: string; destCountry?: string;
    destPort?: string; containerSize?: string; cargoType?: string; weight?: number;
    weightUnit?: 'kg' | 'lb'; readyDate?: string; incoterms?: string; currency?: string; notes?: string;
  }) => {
    const { data, error } = await supabase.rpc('ocean_create_request', {
      p_title: input.title,
      p_origin_country: input.originCountry ?? '',
      p_origin_port: input.originPort ?? '',
      p_dest_country: input.destCountry ?? '',
      p_dest_port: input.destPort ?? '',
      p_container_size: input.containerSize ?? '40ft',
      p_cargo_type: input.cargoType ?? '',
      p_weight: input.weight ?? 0,
      p_weight_unit: input.weightUnit ?? 'kg',
      p_ready_date: input.readyDate ?? null,
      p_incoterms: input.incoterms ?? '',
      p_currency: input.currency ?? 'CAD',
      p_notes: input.notes ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Ocean booking is not live yet — apply migration 0162.');
      throwErr(error, 'Unable to post ocean request');
    }
    return { id: data as string };
  },
  'ocean.mine': async () => {
    const { data, error } = await supabase.rpc('ocean_list_mine');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load ocean requests');
    }
    return data ?? [];
  },
  'ocean.get': async (input: { requestId: string }) => {
    const { data, error } = await supabase
      .from('ocean_requests').select('*').eq('id', input.requestId).maybeSingle();
    if (error) {
      if (isMissingRelation(error)) return null;
      throwErr(error, 'Unable to load request');
    }
    return data ?? null;
  },
  'ocean.offers': async (input: { requestId: string }) => {
    const { data, error } = await supabase.rpc('ocean_list_offers', { p_request_id: input.requestId });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load offers');
    }
    return data ?? [];
  },
  'ocean.acceptOffer': async (input: { offerId: string }) => {
    const { error } = await supabase.rpc('ocean_accept_offer', { p_offer_id: input.offerId });
    if (error) throwErr(error, 'Unable to accept offer');
    return { success: true };
  },
  'ocean.cancel': async (input: { requestId: string }) => {
    const { error } = await supabase.rpc('ocean_cancel_request', { p_request_id: input.requestId });
    if (error) throwErr(error, 'Unable to cancel request');
    return { success: true };
  },
  'ocean.setStatus': async (input: { requestId: string; status: 'InTransit' | 'Completed' }) => {
    const { error } = await supabase.rpc('ocean_set_status', {
      p_request_id: input.requestId,
      p_status: input.status,
    });
    if (error) throwErr(error, 'Unable to update status');
    return { success: true };
  },
  'ocean.messages': async (input: { requestId: string }) => {
    const { data, error } = await supabase
      .from('ocean_messages').select('*').eq('request_id', input.requestId)
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load messages');
    }
    return data ?? [];
  },
  'ocean.sendMessage': async (input: { requestId: string; body: string }) => {
    const { error } = await supabase.rpc('ocean_send_message', {
      p_request_id: input.requestId,
      p_body: input.body,
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Ocean booking is not live yet — apply migration 0162.');
      throwErr(error, 'Unable to send message');
    }
    return { success: true };
  },
  // Forwarder side
  'ocean.board': async (input: { scope?: 'open' | 'mine' } | undefined) => {
    const { data, error } = await supabase.rpc('ocean_forwarder_board', { p_scope: input?.scope ?? 'open' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load board');
    }
    return data ?? [];
  },
  'ocean.submitOffer': async (input: {
    requestId: string; amount: number; currency?: string; transitDays?: number;
    sailingDate?: string; note?: string;
  }) => {
    const { data, error } = await supabase.rpc('ocean_submit_offer', {
      p_request_id: input.requestId,
      p_amount: input.amount,
      p_currency: input.currency ?? 'CAD',
      p_transit_days: input.transitDays ?? 0,
      p_sailing_date: input.sailingDate ?? null,
      p_note: input.note ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Ocean booking is not live yet — apply migration 0162.');
      throwErr(error, 'Unable to submit offer');
    }
    return { id: data as string };
  },
  'ocean.withdrawOffer': async (input: { offerId: string }) => {
    const { error } = await supabase.rpc('ocean_withdraw_offer', { p_offer_id: input.offerId });
    if (error) throwErr(error, 'Unable to withdraw offer');
    return { success: true };
  },

  // ── Ocean final-mile / LCL-FCL legs (0165) ───────────────────────────────
  'ocean.setupFinalMile': async (input: {
    requestId: string; needsFinalMile?: boolean; destWarehouseId?: string | null;
    finalMileAddress?: string; finalMileCity?: string; finalMileContact?: string; finalMilePhone?: string;
  }) => {
    const { error } = await supabase.rpc('ocean_setup_final_mile', {
      p_request_id: input.requestId,
      p_needs_final_mile: input.needsFinalMile ?? true,
      p_dest_warehouse_id: input.destWarehouseId ?? null,
      p_final_mile_address: input.finalMileAddress ?? '',
      p_final_mile_city: input.finalMileCity ?? '',
      p_final_mile_contact: input.finalMileContact ?? '',
      p_final_mile_phone: input.finalMilePhone ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Final-mile routing is not live yet — apply migration 0165.');
      throwErr(error, 'Unable to set up final-mile delivery');
    }
    return { success: true };
  },
  'ocean.advanceLeg': async (input: { legId: string; notes?: string }) => {
    const { error } = await supabase.rpc('ocean_advance_leg', { p_leg_id: input.legId, p_notes: input.notes ?? '' });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Final-mile routing is not live yet — apply migration 0165.');
      throwErr(error, 'Unable to update leg');
    }
    return { success: true };
  },
  'ocean.legs': async (input: { requestId: string }) => {
    const { data, error } = await supabase.rpc('ocean_list_legs', { p_request_id: input.requestId });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [] as OceanLeg[];
      throwErr(error, 'Unable to load shipment legs');
    }
    return (data ?? []) as OceanLeg[];
  },

  // =========================================================================
  // GLOBAL FREIGHT (0167/0168) — Domain 6 worldwide freight quote exchange
  // =========================================================================
  'freight.create': async (input: {
    title: string; originCountry?: string; originCity?: string; originPort?: string;
    destCountry?: string; destCity?: string; destPort?: string;
    freightMode?: string; weight?: number; weightUnit?: 'kg' | 'lb';
    volume?: number; volumeUnit?: 'cbm' | 'cft';
    length?: number; width?: number; height?: number; dimUnit?: 'cm' | 'in'; pieces?: number;
    commodity?: string; declaredValue?: number; currency?: string; hsCode?: string; notes?: string;
    readyDate?: string; deliveryMethod?: string; pickupAddress?: string; pickupCity?: string;
    needsContainerPickup?: boolean;
  }) => {
    const { data, error } = await supabase.rpc('freight_create_quote', {
      p_title: input.title,
      p_origin_country: input.originCountry ?? '',
      p_origin_city: input.originCity ?? '',
      p_origin_port: input.originPort ?? '',
      p_dest_country: input.destCountry ?? '',
      p_dest_city: input.destCity ?? '',
      p_dest_port: input.destPort ?? '',
      p_freight_mode: input.freightMode ?? 'ocean',
      p_weight: input.weight ?? 0,
      p_weight_unit: input.weightUnit ?? 'kg',
      p_volume: input.volume ?? 0,
      p_volume_unit: input.volumeUnit ?? 'cbm',
      p_length: input.length ?? 0,
      p_width: input.width ?? 0,
      p_height: input.height ?? 0,
      p_dim_unit: input.dimUnit ?? 'cm',
      p_pieces: input.pieces ?? 1,
      p_commodity: input.commodity ?? '',
      p_declared_value: input.declaredValue ?? 0,
      p_currency: input.currency ?? 'USD',
      p_hs_code: input.hsCode ?? '',
      p_notes: input.notes ?? '',
      p_ready_date: input.readyDate ?? null,
      p_delivery_method: input.deliveryMethod ?? 'port_delivery',
      p_pickup_address: input.pickupAddress ?? '',
      p_pickup_city: input.pickupCity ?? '',
      p_needs_container_pickup: input.needsContainerPickup ?? false,
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Global Freight is not live yet — apply migrations 0167 & 0168.');
      throwErr(error, 'Unable to post freight request');
    }
    return { id: data as string };
  },
  'freight.mine': async () => {
    const { data, error } = await supabase.rpc('freight_list_mine');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load freight requests');
    }
    return data ?? [];
  },
  'freight.get': async (input: { quoteId: string }) => {
    const { data, error } = await supabase.rpc('freight_get_quote', { p_quote_id: input.quoteId });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return null;
      throwErr(error, 'Unable to load request');
    }
    return (Array.isArray(data) ? data[0] : data) ?? null;
  },
  'freight.addDocument': async (input: { quoteId: string; filePath: string; fileName?: string; docType?: string }) => {
    const { data, error } = await supabase.rpc('freight_add_document', {
      p_quote_id: input.quoteId,
      p_file_path: input.filePath,
      p_file_name: input.fileName ?? '',
      p_doc_type: input.docType ?? 'other',
    });
    if (error) throwErr(error, 'Unable to attach document');
    return { id: data as string };
  },
  'freight.documents': async (input: { quoteId: string }) => {
    const { data, error } = await supabase.rpc('freight_list_documents', { p_quote_id: input.quoteId });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load documents');
    }
    return data ?? [];
  },
  // Admin approval queue (0169)
  'freight.adminList': async (input: { scope?: 'pending' | 'all' } | undefined) => {
    const { data, error } = await supabase.rpc('freight_admin_list', { p_scope: input?.scope ?? 'pending' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load freight review queue');
    }
    return data ?? [];
  },
  'freight.approve': async (input: { quoteId: string }) => {
    const { error } = await supabase.rpc('freight_approve_quote', { p_quote_id: input.quoteId });
    if (error) throwErr(error, 'Unable to approve request');
    return { success: true };
  },
  'freight.reject': async (input: { quoteId: string; reason?: string }) => {
    const { error } = await supabase.rpc('freight_reject_quote', { p_quote_id: input.quoteId, p_reason: input.reason ?? '' });
    if (error) throwErr(error, 'Unable to reject request');
    return { success: true };
  },
  // Provider board + offers (0170)
  'freight.board': async (input: { scope?: 'open' | 'mine' } | undefined) => {
    const { data, error } = await supabase.rpc('freight_provider_board', { p_scope: input?.scope ?? 'open' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load freight board');
    }
    return data ?? [];
  },
  'freight.offers': async (input: { quoteId: string }) => {
    const { data, error } = await supabase.rpc('freight_list_offers', { p_quote_id: input.quoteId });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load offers');
    }
    return data ?? [];
  },
  'freight.submitOffer': async (input: {
    quoteId: string; amount: number; currency?: string; transitDays?: number; validUntil?: string; note?: string;
  }) => {
    const { data, error } = await supabase.rpc('freight_submit_offer', {
      p_quote_id: input.quoteId,
      p_amount: input.amount,
      p_currency: input.currency ?? 'USD',
      p_transit_days: input.transitDays ?? 0,
      p_valid_until: input.validUntil ?? null,
      p_note: input.note ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Global Freight is not live yet — apply migration 0170.');
      throwErr(error, 'Unable to submit offer');
    }
    return { id: data as string };
  },
  'freight.withdrawOffer': async (input: { offerId: string }) => {
    const { error } = await supabase.rpc('freight_withdraw_offer', { p_offer_id: input.offerId });
    if (error) throwErr(error, 'Unable to withdraw offer');
    return { success: true };
  },
  // Accept + cancel + chat (0171)
  'freight.acceptOffer': async (input: { offerId: string }) => {
    const { error } = await supabase.rpc('freight_accept_offer', { p_offer_id: input.offerId });
    if (error) throwErr(error, 'Unable to accept offer');
    return { success: true };
  },
  'freight.cancel': async (input: { quoteId: string }) => {
    const { error } = await supabase.rpc('freight_cancel_quote', { p_quote_id: input.quoteId });
    if (error) throwErr(error, 'Unable to cancel request');
    return { success: true };
  },
  'freight.messages': async (input: { quoteId: string }) => {
    const { data, error } = await supabase
      .from('freight_quote_messages').select('*').eq('quote_id', input.quoteId)
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load messages');
    }
    return data ?? [];
  },
  'freight.sendMessage': async (input: { quoteId: string; body: string }) => {
    const { error } = await supabase.rpc('freight_send_message', { p_quote_id: input.quoteId, p_body: input.body });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Global Freight is not live yet — apply migration 0171.');
      throwErr(error, 'Unable to send message');
    }
    return { success: true };
  },

  // =========================================================================
  // AIR CARGO BOARD (0163) — personal & commercial air freight, bid + AI estimate
  // =========================================================================
  'air.create': async (input: {
    title: string; shipmentKind?: 'personal' | 'commercial';
    originCountry?: string; originCity?: string; originAirport?: string;
    destCountry?: string; destCity?: string; destAirport?: string;
    cargoType?: string; photos?: string[];
    lengthCm?: number; widthCm?: number; heightCm?: number; dimUnit?: 'cm' | 'in';
    weight?: number; weightUnit?: 'kg' | 'lb'; pieces?: number; readyDate?: string;
    commodity?: string; declaredValue?: number; hsCode?: string; currency?: string; notes?: string;
  }) => {
    const { data, error } = await supabase.rpc('air_create_request', {
      p_title: input.title,
      p_shipment_kind: input.shipmentKind ?? 'personal',
      p_origin_country: input.originCountry ?? '',
      p_origin_city: input.originCity ?? '',
      p_origin_airport: input.originAirport ?? '',
      p_dest_country: input.destCountry ?? '',
      p_dest_city: input.destCity ?? '',
      p_dest_airport: input.destAirport ?? '',
      p_cargo_type: input.cargoType ?? '',
      p_photos: input.photos ?? [],
      p_length_cm: input.lengthCm ?? 0,
      p_width_cm: input.widthCm ?? 0,
      p_height_cm: input.heightCm ?? 0,
      p_dim_unit: input.dimUnit ?? 'cm',
      p_weight: input.weight ?? 0,
      p_weight_unit: input.weightUnit ?? 'kg',
      p_pieces: input.pieces ?? 1,
      p_ready_date: input.readyDate ?? null,
      p_commodity: input.commodity ?? '',
      p_declared_value: input.declaredValue ?? 0,
      p_hs_code: input.hsCode ?? '',
      p_currency: input.currency ?? 'CAD',
      p_notes: input.notes ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Air cargo is not live yet — apply migration 0163.');
      throwErr(error, 'Unable to post air request');
    }
    return { id: data as string };
  },
  'air.setEstimate': async (input: {
    requestId: string; low: number; high: number; currency?: string; note?: string;
  }) => {
    const { error } = await supabase.rpc('air_set_estimate', {
      p_request_id: input.requestId,
      p_low: input.low,
      p_high: input.high,
      p_currency: input.currency ?? 'CAD',
      p_note: input.note ?? '',
    });
    if (error) throwErr(error, 'Unable to save estimate');
    return { success: true };
  },
  'air.mine': async () => {
    const { data, error } = await supabase.rpc('air_list_mine');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load air requests');
    }
    return data ?? [];
  },
  'air.offers': async (input: { requestId: string }) => {
    const { data, error } = await supabase.rpc('air_list_offers', { p_request_id: input.requestId });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load offers');
    }
    return data ?? [];
  },
  'air.acceptOffer': async (input: { offerId: string }) => {
    const { error } = await supabase.rpc('air_accept_offer', { p_offer_id: input.offerId });
    if (error) throwErr(error, 'Unable to accept offer');
    return { success: true };
  },
  'air.cancel': async (input: { requestId: string }) => {
    const { error } = await supabase.rpc('air_cancel_request', { p_request_id: input.requestId });
    if (error) throwErr(error, 'Unable to cancel request');
    return { success: true };
  },
  'air.setStatus': async (input: { requestId: string; status: 'InTransit' | 'Completed' }) => {
    const { error } = await supabase.rpc('air_set_status', {
      p_request_id: input.requestId,
      p_status: input.status,
    });
    if (error) throwErr(error, 'Unable to update status');
    return { success: true };
  },
  'air.messages': async (input: { requestId: string }) => {
    const { data, error } = await supabase
      .from('air_messages').select('*').eq('request_id', input.requestId)
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load messages');
    }
    return data ?? [];
  },
  'air.sendMessage': async (input: { requestId: string; body: string }) => {
    const { error } = await supabase.rpc('air_send_message', {
      p_request_id: input.requestId,
      p_body: input.body,
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Air cargo is not live yet — apply migration 0163.');
      throwErr(error, 'Unable to send message');
    }
    return { success: true };
  },
  // Forwarder side
  'air.board': async (input: { scope?: 'open' | 'mine' } | undefined) => {
    const { data, error } = await supabase.rpc('air_forwarder_board', { p_scope: input?.scope ?? 'open' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load board');
    }
    return data ?? [];
  },
  'air.submitOffer': async (input: {
    requestId: string; amount: number; currency?: string; transitDays?: number;
    departureDate?: string; note?: string;
  }) => {
    const { data, error } = await supabase.rpc('air_submit_offer', {
      p_request_id: input.requestId,
      p_amount: input.amount,
      p_currency: input.currency ?? 'CAD',
      p_transit_days: input.transitDays ?? 0,
      p_departure_date: input.departureDate ?? null,
      p_note: input.note ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Air cargo is not live yet — apply migration 0163.');
      throwErr(error, 'Unable to submit offer');
    }
    return { id: data as string };
  },
  'air.withdrawOffer': async (input: { offerId: string }) => {
    const { error } = await supabase.rpc('air_withdraw_offer', { p_offer_id: input.offerId });
    if (error) throwErr(error, 'Unable to withdraw offer');
    return { success: true };
  },

  // =========================================================================
  // PARCEL COUNTER (0164) — post-office style parcel shipping + label/barcode
  // =========================================================================
  'parcel.quote': async (input: {
    length?: number; width?: number; height?: number; dimUnit?: 'cm' | 'in';
    weight: number; weightUnit?: 'kg' | 'lb';
    service?: 'regular' | 'expedited' | 'xpresspost' | 'priority'; currency?: string;
  }) => {
    const { data, error } = await supabase.rpc('parcel_quote', {
      p_length: input.length ?? 0,
      p_width: input.width ?? 0,
      p_height: input.height ?? 0,
      p_dim_unit: input.dimUnit ?? 'cm',
      p_weight: input.weight,
      p_weight_unit: input.weightUnit ?? 'kg',
      p_service: input.service ?? 'regular',
      p_currency: input.currency ?? 'CAD',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Parcel counter is not live yet — apply migration 0164.');
      throwErr(error, 'Unable to get quote');
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row ?? null;
  },
  'parcel.create': async (input: {
    fromName?: string; fromLine1?: string; fromCity?: string; fromRegion?: string; fromPostal?: string; fromCountry?: string;
    toName: string; toLine1?: string; toCity: string; toRegion?: string; toPostal?: string; toCountry?: string;
    length?: number; width?: number; height?: number; dimUnit?: 'cm' | 'in';
    weight: number; weightUnit?: 'kg' | 'lb';
    service?: 'regular' | 'expedited' | 'xpresspost' | 'priority'; currency?: string; notes?: string;
  }) => {
    const { data, error } = await supabase.rpc('parcel_create', {
      p_from_name: input.fromName ?? '',
      p_from_line1: input.fromLine1 ?? '',
      p_from_city: input.fromCity ?? '',
      p_from_region: input.fromRegion ?? '',
      p_from_postal: input.fromPostal ?? '',
      p_from_country: input.fromCountry ?? 'CA',
      p_to_name: input.toName,
      p_to_line1: input.toLine1 ?? '',
      p_to_city: input.toCity,
      p_to_region: input.toRegion ?? '',
      p_to_postal: input.toPostal ?? '',
      p_to_country: input.toCountry ?? 'CA',
      p_length: input.length ?? 0,
      p_width: input.width ?? 0,
      p_height: input.height ?? 0,
      p_dim_unit: input.dimUnit ?? 'cm',
      p_weight: input.weight,
      p_weight_unit: input.weightUnit ?? 'kg',
      p_service: input.service ?? 'regular',
      p_currency: input.currency ?? 'CAD',
      p_notes: input.notes ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Parcel counter is not live yet — apply migration 0164.');
      throwErr(error, 'Unable to create parcel');
    }
    const id = data as string;
    const { data: row } = await supabase.rpc('parcel_get', { p_id: id });
    const parcel = Array.isArray(row) ? row[0] : row;
    return { id, parcel: parcel ?? null };
  },
  'parcel.mine': async () => {
    const { data, error } = await supabase.rpc('parcel_list_mine');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load parcels');
    }
    return data ?? [];
  },
  'parcel.get': async (input: { id: string }) => {
    const { data, error } = await supabase.rpc('parcel_get', { p_id: input.id });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return null;
      throwErr(error, 'Unable to load parcel');
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row ?? null;
  },
  'parcel.setStatus': async (input: {
    id: string; status: 'DroppedOff' | 'InTransit' | 'Delivered' | 'Cancelled';
  }) => {
    const { error } = await supabase.rpc('parcel_set_status', { p_id: input.id, p_status: input.status });
    if (error) throwErr(error, 'Unable to update parcel');
    return { success: true };
  },

  // =========================================================================
  // GUEST ACCESS (0156) — prepaid invoices with guest surcharge
  // =========================================================================
  'guest.invoices': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('invoices')
      .select('id,invoice_number,subtotal_amount,tax_amount,total_amount,currency,status,due_date,issued_at,paid_at,requires_prepayment,created_at')
      .eq('customer_company_id', ctx.user.companyId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load invoices');
    }
    return data ?? [];
  },
  'guest.payInvoice': async (input: { invoiceId: string }) => {
    const { error } = await supabase.rpc('guest_pay_invoice', { p_invoice_id: input.invoiceId });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Guest payments are not live yet — apply migration 0156.');
      throwErr(error, 'Unable to pay invoice');
    }
    return { success: true };
  },

  // =========================================================================
  // WAREHOUSE SHARED SPACE (0157) — rent by the square foot
  // =========================================================================
  // Browse all Active spaces across providers (with tiers + addons inline).
  'spaces.browse': async () => {
    const { data, error } = await supabase.rpc('space_browse');
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load spaces');
    }
    return data ?? [];
  },
  // Transparent server-side quote: tier rate + term discount + addons.
  'spaces.quote': async (input: { spaceId: string; sqft: number; termMonths: number; addonIds?: string[] }) => {
    const { data, error } = await supabase.rpc('warehouse_space_quote', {
      p_space_id: input.spaceId,
      p_sqft: input.sqft,
      p_term_months: input.termMonths,
      p_addon_ids: input.addonIds ?? [],
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Space rentals are not live yet — apply migration 0157.');
      throwErr(error, 'Unable to price this request');
    }
    return data as AnyRecord;
  },
  'spaces.requestBooking': async (input: { spaceId: string; sqft: number; termMonths: number; startDate: string; addonIds?: string[]; notes?: string }) => {
    const { data, error } = await supabase.rpc('space_request_booking', {
      p_space_id: input.spaceId,
      p_sqft: input.sqft,
      p_term_months: input.termMonths,
      p_start_date: input.startDate,
      p_addon_ids: input.addonIds ?? [],
      p_notes: input.notes ?? '',
    });
    if (error) {
      if (isMissingFunction(error)) throw new Error('Space rentals are not live yet — apply migration 0157.');
      throwErr(error, 'Unable to request this space');
    }
    return { id: data as string };
  },
  'spaces.bookings': async (input: { scope?: 'provider' | 'customer' }) => {
    const { data, error } = await supabase.rpc('space_list_bookings', { p_scope: input?.scope ?? 'customer' });
    if (error) {
      if (isMissingFunction(error) || isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load space bookings');
    }
    return data ?? [];
  },
  'spaces.respond': async (input: { bookingId: string; action: 'approve' | 'decline'; note?: string }) => {
    const { error } = await supabase.rpc('space_respond_booking', {
      p_booking_id: input.bookingId,
      p_action: input.action,
      p_note: input.note ?? '',
    });
    if (error) throwErr(error, 'Unable to respond to this request');
    return { success: true };
  },
  'spaces.billMonth': async (input: { bookingId: string }) => {
    const { data, error } = await supabase.rpc('space_bill_month', { p_booking_id: input.bookingId });
    if (error) throwErr(error, 'Unable to bill this month');
    return { invoiceId: data as string };
  },
  'spaces.endBooking': async (input: { bookingId: string; note?: string }) => {
    const { error } = await supabase.rpc('space_end_booking', { p_booking_id: input.bookingId, p_note: input.note ?? '' });
    if (error) throwErr(error, 'Unable to end this booking');
    return { success: true };
  },
  // Provider: my spaces with tiers + addons for management.
  'spaces.mySpaces': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('warehouse_spaces')
      .select('*, warehouse_space_tiers(*), warehouse_space_addons(*)')
      .eq('company_id', ctx.user.companyId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load your spaces');
    }
    return data ?? [];
  },
  'spaces.createSpace': async (input: AnyRecord, ctx) => {
    if (!ctx.user.companyId) throw new Error('No active company');
    const { data, error } = await supabase.from('warehouse_spaces').insert({
      company_id: ctx.user.companyId,
      name: input.name,
      space_kind: input.spaceKind ?? 'Floor',
      address: input.address ?? '',
      city: input.city ?? '',
      total_sqft: input.totalSqft ?? 0,
      min_sqft: input.minSqft ?? 100,
      max_sqft: input.maxSqft ?? null,
      base_rate_per_sqft_month: input.baseRate ?? 0,
      currency: input.currency ?? 'CAD',
      min_term_months: input.minTermMonths ?? 1,
      term_discount_3m_pct: input.discount3m ?? 0,
      term_discount_6m_pct: input.discount6m ?? 0,
      term_discount_12m_pct: input.discount12m ?? 0,
      ceiling_height_ft: input.ceilingHeightFt ?? null,
      features: input.features ?? [],
      notes: input.notes ?? '',
      status: input.status ?? 'Active',
    }).select().single();
    if (error) {
      if (isMissingRelation(error)) throw new Error('Space rentals are not live yet — apply migration 0157.');
      throwErr(error, 'Unable to create space');
    }
    return data as AnyRecord;
  },
  'spaces.updateSpace': async (input: AnyRecord) => {
    const map: Record<string, string> = {
      name: 'name', spaceKind: 'space_kind', address: 'address', city: 'city',
      totalSqft: 'total_sqft', minSqft: 'min_sqft', maxSqft: 'max_sqft',
      baseRate: 'base_rate_per_sqft_month', currency: 'currency',
      minTermMonths: 'min_term_months', discount3m: 'term_discount_3m_pct',
      discount6m: 'term_discount_6m_pct', discount12m: 'term_discount_12m_pct',
      ceilingHeightFt: 'ceiling_height_ft', features: 'features', notes: 'notes', status: 'status',
    };
    const db: AnyRecord = { updated_at: new Date().toISOString() };
    for (const [k, col] of Object.entries(map)) {
      if (input[k] !== undefined) db[col] = input[k];
    }
    const { error } = await supabase.from('warehouse_spaces').update(db).eq('id', input.id as string);
    if (error) throwErr(error, 'Unable to update space');
    return { success: true };
  },
  'spaces.addTier': async (input: { spaceId: string; minSqft: number; rate: number }) => {
    const { error } = await supabase.from('warehouse_space_tiers').insert({
      space_id: input.spaceId, min_sqft: input.minSqft, rate_per_sqft_month: input.rate,
    });
    if (error) throwErr(error, 'Unable to add tier');
    return { success: true };
  },
  'spaces.removeTier': async (input: { tierId: string }) => {
    const { error } = await supabase.from('warehouse_space_tiers').delete().eq('id', input.tierId);
    if (error) throwErr(error, 'Unable to remove tier');
    return { success: true };
  },
  'spaces.addAddon': async (input: { spaceId: string; name: string; pricingUnit: string; rate: number; required?: boolean }) => {
    const { error } = await supabase.from('warehouse_space_addons').insert({
      space_id: input.spaceId, name: input.name, pricing_unit: input.pricingUnit,
      rate: input.rate, is_required: input.required ?? false,
    });
    if (error) throwErr(error, 'Unable to add service');
    return { success: true };
  },
  'spaces.removeAddon': async (input: { addonId: string }) => {
    const { error } = await supabase.from('warehouse_space_addons').delete().eq('id', input.addonId);
    if (error) throwErr(error, 'Unable to remove service');
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
  // INVOICING — provider-authored invoices + light accounting
  // =========================================================================
  // Companies this provider can bill (approved companies, excluding self).
  'invoicing.customerCompanies': async (_input, ctx) => {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, type, city, status')
      .eq('status', 'Approved')
      .order('name', { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load companies');
    return (data ?? [])
      .filter((c) => String(c.id) !== String(ctx.user.companyId ?? ''))
      .map((c) => ({ id: String(c.id), name: String((c as AnyRecord).name ?? 'Company'), type: String((c as AnyRecord).type ?? ''), city: String((c as AnyRecord).city ?? '') }));
  },
  // Full invoice with its line items.
  'invoicing.getWithLines': async (input: { invoiceId: string }) => {
    if (!input.invoiceId) throw new Error('Invoice id required');
    const { data: inv, error } = await supabase.from('invoices').select('*').eq('id', input.invoiceId).maybeSingle();
    if (error || !inv) throw new Error('Invoice not found');
    const { data: lines } = await supabase.from('invoice_lines').select('*').eq('invoice_id', input.invoiceId).order('sort_order', { ascending: true });
    return { invoice: inv, lines: lines ?? [] };
  },
  // Create + optionally issue a custom invoice to a customer.
  'invoicing.create': async (input: {
    customerCompanyId?: string | null;
    customerName?: string;
    customerEmail?: string;
    currency?: string;
    taxRate?: number;
    dueDays?: number;
    notes?: string;
    status?: 'Draft' | 'Issued';
    lines: { description: string; quantity: number; unitPrice: number }[];
  }, ctx) => {
    if (!ctx.user.companyId) throw new Error('You must belong to a company to send invoices');
    const cleanLines = (input.lines ?? [])
      .filter((l) => (l.description ?? '').trim().length > 0)
      .map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity) || 0, unit_price: Number(l.unitPrice) || 0 }));
    if (cleanLines.length === 0) throw new Error('Add at least one line item');
    const { data, error } = await supabase.rpc('create_provider_invoice', {
      p_provider_company_id: ctx.user.companyId,
      p_customer_company_id: input.customerCompanyId ?? null,
      p_customer_name: input.customerName ?? '',
      p_customer_email: input.customerEmail ?? '',
      p_currency: input.currency ?? 'CAD',
      p_tax_rate: Number(input.taxRate) || 0,
      p_due_days: Number.isFinite(input.dueDays) ? Number(input.dueDays) : 14,
      p_notes: input.notes ?? '',
      p_lines: cleanLines,
      p_status: input.status ?? 'Issued',
    });
    if (error) throwErr(error, 'Unable to create invoice');
    return { id: data as string };
  },
  // Owner-side status change: Issue / Void / Paid (records payment when Paid).
  'invoicing.setStatus': async (input: { id: string; status: 'Issued' | 'Void' | 'Paid'; method?: string }) => {
    if (!input.id) throw new Error('Invoice id required');
    const { data, error } = await supabase.rpc('provider_set_invoice_status', {
      p_invoice_id: input.id,
      p_status: input.status,
      p_method: input.method ?? 'manual',
    });
    if (error) throwErr(error, 'Unable to update invoice');
    return { success: true, paymentId: (data as string) ?? null };
  },
  // =========================================================================
  // ACCOUNTING — company-level bookkeeping summary + expenses
  // =========================================================================
  'accounting.summary': async (_input, ctx) => {
    if (!ctx.user.companyId) {
      return { collected: 0, outstanding: 0, overdue: 0, draft: 0, expenses: 0, net: 0, invoiceCount: 0, aging: { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 } };
    }
    const { data, error } = await supabase.rpc('company_accounting_summary', { p_company_id: ctx.user.companyId });
    if (error) throwErr(error, 'Unable to load accounting summary');
    return data as AnyRecord;
  },
  'accounting.listExpenses': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data, error } = await supabase
      .from('company_expenses')
      .select('*')
      .eq('company_id', ctx.user.companyId)
      .order('incurred_on', { ascending: false });
    if (isMissingRelation(error)) return [];
    if (error) throwErr(error, 'Unable to load expenses');
    return data ?? [];
  },
  'accounting.addExpense': async (input: { category?: string; vendor?: string; description?: string; amount: number; currency?: string; incurredOn?: string; status?: string }, ctx) => {
    if (!ctx.user.companyId) throw new Error('You must belong to a company to record expenses');
    if (!(Number(input.amount) > 0)) throw new Error('Amount must be greater than 0');
    const { data, error } = await supabase.from('company_expenses').insert({
      company_id: ctx.user.companyId,
      category: input.category ?? 'general',
      vendor: input.vendor ?? '',
      description: input.description ?? '',
      amount: Number(input.amount),
      currency: input.currency ?? 'CAD',
      incurred_on: input.incurredOn ?? new Date().toISOString().slice(0, 10),
      status: input.status ?? 'Recorded',
    }).select('id').single();
    if (error) throwErr(error, 'Unable to record expense');
    return { id: data!.id as string };
  },
  'accounting.deleteExpense': async (input: { id: string }, ctx) => {
    if (!ctx.user.companyId) throw new Error('Not authorized');
    const { error } = await supabase.from('company_expenses').delete().eq('id', input.id).eq('company_id', ctx.user.companyId);
    if (error) throwErr(error, 'Unable to delete expense');
    return { success: true };
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
      { code: 'ARAMEX', name: 'Aramex', implemented: false, mode: 'direct', requires: ['account_number', 'account_pin', 'username', 'password'] },
      { code: 'PUROLATOR', name: 'Purolator', implemented: false, mode: 'direct', requires: ['api_key', 'account_number'] },
      { code: 'USPS', name: 'USPS', implemented: false, mode: 'direct', requires: ['api_key'] },
      { code: 'GLS', name: 'GLS', implemented: false, mode: 'direct', requires: ['api_key'] },
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
    const locs = data ?? [];
    // Attach how many pallet slots are occupied at each location.
    const ids = locs.map((l) => l.id as string);
    let occupancy: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: pallets } = await supabase
        .from('warehouse_pallets')
        .select('location_id')
        .eq('status', 'stored')
        .in('location_id', ids);
      occupancy = (pallets ?? []).reduce<Record<string, number>>((acc, p) => {
        const key = p.location_id as string;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
    }
    return locs.map((l) => ({
      ...l,
      pallet_capacity: Number(l.pallet_capacity ?? 1),
      accepts_oversize: Boolean(l.accepts_oversize),
      pallets_used: occupancy[l.id as string] ?? 0,
    }));
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
      pallet_capacity: input.palletCapacity ?? 1,
      accepts_oversize: input.acceptsOversize ?? false,
    }).select().single();
    if (error) throwErr(error, 'Unable to create location');
    return { id: data!.id };
  },
  // Auto-build a full racking layout from the listing's declared pallet capacity
  // so operators never hand-create shelves. Idempotent: tops up missing slots.
  'wms.generateLocations': async (input: { listingId: string; count?: number }, ctx) => {
    if (!ctx.user.companyId && !isAdmin(ctx.user.role)) throw new Error('Company context required');
    const { data, error } = await supabase.rpc('wms_generate_locations', {
      p_listing_id: input.listingId,
      p_count: input.count ?? null,
    });
    if (error) throwErr(error, 'Unable to generate locations');
    return { created: Number(data ?? 0) };
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
  'wms.putawayPallet': async (input: { variantId?: string; locationId: string; palletType?: 'standard' | 'oversize'; units?: number; receiptId?: string; lotCode?: string; reference?: string }) => {
    // wms_putaway_pallet(p_variant_id, p_location_id, p_pallet_type, p_units, p_receipt_id, p_lot_code, p_expiry, p_reference)
    const { data, error } = await supabase.rpc('wms_putaway_pallet', {
      p_variant_id: input.variantId ?? null,
      p_location_id: input.locationId,
      p_pallet_type: input.palletType ?? 'standard',
      p_units: input.units ?? 1,
      p_receipt_id: input.receiptId ?? null,
      p_lot_code: input.lotCode ?? null,
      p_expiry: null,
      p_reference: input.reference ?? null,
    });
    if (error) throwErr(error, 'Unable to put away pallet');
    return { palletId: data as string };
  },
  'wms.autoPutaway': async (
    input: { count: number; variantId?: string; palletType?: 'standard' | 'oversize'; unitsPerPallet?: number; receiptId?: string; lotCode?: string; reference?: string; startLocationId?: string },
    ctx,
  ) => {
    // Auto-distribute N identical pallets: one pallet per free slot. Real
    // racking is one-pallet-per-slot, so we walk empty slots and place a pallet
    // in each until the count is exhausted or we run out of room.
    const palletType = input.palletType ?? 'standard';
    const count = Math.max(Math.floor(input.count) || 0, 0);
    if (count <= 0) throw new Error('Enter how many pallets to put away.');
    if (!ctx.user.companyId && !isAdmin(ctx.user.role)) throw new Error('Company context required');

    // Load locations for this warehouse and their current pallet occupancy.
    const locQ = supabase.from('warehouse_locations').select('*').is('archived_at', null).order('zone').order('aisle');
    const { data: locData, error: locErr } = isAdmin(ctx.user.role)
      ? await locQ
      : await locQ.eq('warehouse_company_id', ctx.user.companyId!);
    if (locErr) throwErr(locErr, 'Unable to load locations');
    const locs = locData ?? [];
    const ids = locs.map((l) => l.id as string);
    let occupancy: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: pallets } = await supabase
        .from('warehouse_pallets')
        .select('location_id')
        .eq('status', 'stored')
        .in('location_id', ids);
      occupancy = (pallets ?? []).reduce<Record<string, number>>((acc, p) => {
        const key = p.location_id as string;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
    }

    // Compute a queue of empty slots (respecting capacity + oversize rules).
    // When the operator picks a starting location, fill its free slots first,
    // then spill over to the rest of the racking in zone/aisle order.
    const ordered = input.startLocationId
      ? [...locs].sort((a, b) => (a.id === input.startLocationId ? -1 : b.id === input.startLocationId ? 1 : 0))
      : locs;
    const slots: string[] = [];
    for (const l of ordered) {
      const capacity = Math.max(Number(l.pallet_capacity ?? 1), 1);
      const used = occupancy[l.id as string] ?? 0;
      const free = Math.max(capacity - used, 0);
      if (palletType === 'oversize' && !l.accepts_oversize) continue;
      for (let i = 0; i < free; i++) slots.push(l.id as string);
    }

    const toPlace = Math.min(count, slots.length);
    const placed: string[] = [];
    for (let i = 0; i < toPlace; i++) {
      const { data, error } = await supabase.rpc('wms_putaway_pallet', {
        p_variant_id: input.variantId ?? null,
        p_location_id: slots[i],
        p_pallet_type: palletType,
        p_units: input.unitsPerPallet ?? 1,
        p_receipt_id: input.receiptId ?? null,
        p_lot_code: input.lotCode ?? null,
        p_expiry: null,
        p_reference: input.reference ?? null,
      });
      if (error) {
        // Surface a partial result rather than losing what already placed.
        if (placed.length === 0) throwErr(error, 'Unable to auto put away pallets');
        break;
      }
      placed.push(data as string);
    }

    return { placed: placed.length, requested: count, remaining: count - placed.length, freeSlots: slots.length };
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

  // =========================================================================
  // SALES AGENT CRM — agents, leads, attributions, commission ledger, plans
  // =========================================================================
  // Current agent's own record (self-heals a missing agent row + code).
  'sales.myAgent': async (_input, ctx) => {
    let { data } = await supabase.from('sales_agents').select('*').eq('id', ctx.user.id).maybeSingle();
    if (!data) {
      const { data: gen } = await supabase.rpc('ensure_sales_agent', { p_user_id: ctx.user.id });
      const code = typeof gen === 'string' ? gen : null;
      const res = await supabase.from('sales_agents').select('*').eq('id', ctx.user.id).maybeSingle();
      data = res.data ?? (code ? { id: ctx.user.id, agent_code: code, status: 'Active' } : null);
    }
    if (!data) return null;
    let plan: AnyRecord | null = null;
    if (data.plan_id) {
      const { data: p } = await supabase.from('commission_plans').select('*').eq('id', data.plan_id as string).maybeSingle();
      plan = (p as AnyRecord | null) ?? null;
    }
    return { ...data, plan };
  },

  // Aggregated dashboard totals for the current agent.
  'sales.dashboard': async (_input, ctx) => {
    const [entries, attrs, leads] = await Promise.all([
      supabase.from('commission_entries').select('amount, status, kind').eq('agent_id', ctx.user.id),
      supabase.from('agent_attributions').select('id, vertical').eq('agent_id', ctx.user.id),
      supabase.from('agent_leads').select('id, status').eq('agent_id', ctx.user.id),
    ]);
    const rows = (entries.data as { amount: number; status: string }[] | null) ?? [];
    const sum = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + Number(r.amount || 0), 0);
    const leadRows = (leads.data as { status: string }[] | null) ?? [];
    return {
      pending: sum('Pending'),
      approved: sum('Approved'),
      paid: sum('Paid'),
      lifetime: sum('Pending') + sum('Approved') + sum('Paid'),
      accounts: (attrs.data ?? []).length,
      leads: leadRows.length,
      openLeads: leadRows.filter((l) => l.status !== 'Won' && l.status !== 'Lost').length,
    };
  },

  'sales.leads': async (_input, ctx) => {
    const { data, error } = await supabase.from('agent_leads').select('*').eq('agent_id', ctx.user.id).order('created_at', { ascending: false });
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load leads'); }
    return data ?? [];
  },

  'sales.upsertLead': async (input: AnyRecord) => {
    const { data, error } = await supabase.rpc('agent_save_lead', {
      p: {
        id: (input.id as string | undefined) ?? null,
        business_name: (input.businessName as string) ?? '',
        contact_name: (input.contactName as string) ?? '',
        contact_title: (input.contactTitle as string) ?? '',
        contact_email: (input.contactEmail as string) ?? '',
        contact_phone: (input.contactPhone as string) ?? '',
        company_website: (input.companyWebsite as string) ?? '',
        city: (input.city as string) ?? '',
        vertical: (input.vertical as string) ?? 'warehouse',
        status: (input.status as string) ?? 'New',
        priority: (input.priority as string) ?? 'Medium',
        source: (input.source as string) ?? '',
        estimated_value: Number(input.estimatedValue ?? 0) || 0,
        next_action: (input.nextAction as string) ?? '',
        next_action_at: (input.nextActionAt as string) ?? '',
        last_contact_at: (input.lastContactAt as string) ?? '',
        notes: (input.notes as string) ?? '',
      },
    });
    if (error) throwErr(error, 'Unable to save lead');
    return { id: data as string };
  },

  'sales.commissions': async (_input, ctx) => {
    const { data, error } = await supabase.from('commission_entries').select('*').eq('agent_id', ctx.user.id).order('created_at', { ascending: false });
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load commissions'); }
    return data ?? [];
  },

  'sales.accounts': async (_input, ctx) => {
    const { data, error } = await supabase.from('agent_attributions').select('*').eq('agent_id', ctx.user.id).order('created_at', { ascending: false });
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load accounts'); }
    return data ?? [];
  },

  // The agent's book of business: every onboarded account, enriched with its
  // name, type, onboarding status and commission earned from that client.
  'sales.clients': async (_input, ctx) => {
    const { data: attrs, error } = await supabase
      .from('agent_attributions').select('*').eq('agent_id', ctx.user.id)
      .order('created_at', { ascending: false });
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load clients'); }
    const rows = (attrs as AnyRecord[] | null) ?? [];
    if (rows.length === 0) return [];

    const companyIds = Array.from(new Set(rows.map((r) => r.account_company_id as string | null).filter(Boolean))) as string[];
    const userIds = Array.from(new Set(rows.map((r) => r.account_user_id as string | null).filter(Boolean))) as string[];
    const attrIds = rows.map((r) => r.id as string);

    const [companies, profiles, entries] = await Promise.all([
      companyIds.length ? supabase.from('companies').select('id, name, type, status, city').in('id', companyIds) : Promise.resolve({ data: [] }),
      userIds.length ? supabase.from('profiles').select('id, name, email').in('id', userIds) : Promise.resolve({ data: [] }),
      supabase.from('commission_entries').select('amount, status, source_id').eq('agent_id', ctx.user.id).in('source_id', attrIds),
    ]);
    const compMap = new Map(((companies.data as AnyRecord[] | null) ?? []).map((c) => [c.id as string, c]));
    const profMap = new Map(((profiles.data as AnyRecord[] | null) ?? []).map((p) => [p.id as string, p]));
    const entryRows = (entries.data as { amount: number; status: string; source_id: string }[] | null) ?? [];

    return rows.map((r) => {
      const comp = r.account_company_id ? compMap.get(r.account_company_id as string) : undefined;
      const prof = r.account_user_id ? profMap.get(r.account_user_id as string) : undefined;
      const compStatus = (comp?.status as string | undefined) ?? undefined;
      let onboardStatus: 'Signed up' | 'Setting up' | 'Active' = 'Signed up';
      if (comp) onboardStatus = compStatus === 'Approved' ? 'Active' : 'Setting up';
      else if (prof) onboardStatus = 'Active';
      const mine = entryRows.filter((e) => e.source_id === (r.id as string));
      const earned = mine.reduce((a, e) => a + Number(e.amount || 0), 0);
      return {
        id: r.id as string,
        name: (comp?.name as string | undefined) ?? (prof?.name as string | undefined) ?? 'Client',
        email: (prof?.email as string | undefined) ?? '',
        city: (comp?.city as string | undefined) ?? '',
        vertical: r.vertical as string,
        source: r.source as string,
        onboardStatus,
        companyStatus: compStatus ?? '',
        earned,
        createdAt: r.created_at as string,
      };
    });
  },

  // One client's full detail: contact, onboarding progress + its commissions.
  'sales.clientDetail': async (input: { id: string }, ctx) => {
    const { data: attr, error } = await supabase
      .from('agent_attributions').select('*').eq('id', input.id).eq('agent_id', ctx.user.id).maybeSingle();
    if (error) throwErr(error, 'Unable to load client');
    if (!attr) return null;
    const a = attr as AnyRecord;
    const [company, profile, entries] = await Promise.all([
      a.account_company_id ? supabase.from('companies').select('id, name, type, status, city, address').eq('id', a.account_company_id as string).maybeSingle() : Promise.resolve({ data: null }),
      a.account_user_id ? supabase.from('profiles').select('id, name, email, role').eq('id', a.account_user_id as string).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('commission_entries').select('*').eq('agent_id', ctx.user.id).eq('source_id', a.id as string).order('created_at', { ascending: false }),
    ]);
    const comp = company.data as AnyRecord | null;
    const prof = profile.data as AnyRecord | null;
    const compStatus = (comp?.status as string | undefined) ?? undefined;
    let onboardStatus: 'Signed up' | 'Setting up' | 'Active' = 'Signed up';
    if (comp) onboardStatus = compStatus === 'Approved' ? 'Active' : 'Setting up';
    else if (prof) onboardStatus = 'Active';
    return {
      id: a.id as string,
      name: (comp?.name as string | undefined) ?? (prof?.name as string | undefined) ?? 'Client',
      email: (prof?.email as string | undefined) ?? '',
      city: (comp?.city as string | undefined) ?? '',
      address: (comp?.address as string | undefined) ?? '',
      vertical: a.vertical as string,
      source: a.source as string,
      onboardStatus,
      companyStatus: compStatus ?? '',
      hasCompany: Boolean(comp),
      createdAt: a.created_at as string,
      commissions: (entries.data as AnyRecord[] | null) ?? [],
    };
  },

  // Self-service professional profile update (full details + payout).
  'sales.updateProfile': async (input: AnyRecord) => {
    const { error } = await supabase.rpc('agent_save_profile', {
      p: {
        legal_name: (input.legalName as string) ?? undefined,
        business_name: (input.businessName as string) ?? undefined,
        phone: (input.phone as string) ?? undefined,
        territory: (input.territory as string) ?? undefined,
        address_line1: (input.addressLine1 as string) ?? undefined,
        address_line2: (input.addressLine2 as string) ?? undefined,
        city: (input.city as string) ?? undefined,
        region: (input.region as string) ?? undefined,
        postal_code: (input.postalCode as string) ?? undefined,
        country: (input.country as string) ?? undefined,
        tax_id: (input.taxId as string) ?? undefined,
        website: (input.website as string) ?? undefined,
        linkedin: (input.linkedin as string) ?? undefined,
        bio: (input.bio as string) ?? undefined,
        id_type: (input.idType as string) ?? undefined,
        id_number: (input.idNumber as string) ?? undefined,
        date_of_birth: (input.dateOfBirth as string) ?? undefined,
        emergency_name: (input.emergencyName as string) ?? undefined,
        emergency_phone: (input.emergencyPhone as string) ?? undefined,
        payout_method: (input.payoutMethod as string) ?? undefined,
        payout_details: (input.payoutDetails as string) ?? undefined,
      },
    });
    if (error) throwErr(error, 'Unable to update profile');
    return { success: true };
  },

  // Legal acceptances for the current user (Terms, NDA).
  'sales.myLegal': async (_input, ctx) => {
    const { data, error } = await supabase.from('legal_acceptances').select('*').eq('user_id', ctx.user.id);
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load legal records'); }
    return data ?? [];
  },

  // Record an acceptance/signature from inside the app (post-signup).
  'sales.recordLegal': async (input: { docType: string; docVersion: string; signedName?: string; platform?: string }) => {
    const { error } = await supabase.rpc('record_legal_acceptance', {
      p_doc_type: input.docType,
      p_doc_version: input.docVersion ?? '1.0',
      p_signed_name: input.signedName ?? '',
      p_platform: input.platform ?? '',
    });
    if (error) throwErr(error, 'Unable to record acceptance');
    return { success: true };
  },

  // Admin: full detail for one agent (professional profile + legal records).
  'sales.adminAgentDetail': async (input: { agentId: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.rpc('admin_agent_detail', { p_agent_id: input.agentId });
    if (error) throwErr(error, 'Unable to load agent detail');
    return data ?? null;
  },

  // ---- Admin console ------------------------------------------------------
  'sales.adminAgents': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data: agents, error } = await supabase.from('sales_agents').select('*').order('created_at', { ascending: false });
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load agents'); }
    const list = (agents as AnyRecord[] | null) ?? [];
    if (list.length === 0) return [];
    const ids = list.map((a) => a.id as string);
    const [profiles, entries, attrs] = await Promise.all([
      supabase.from('profiles').select('id, name, email').in('id', ids),
      supabase.from('commission_entries').select('agent_id, amount, status').in('agent_id', ids),
      supabase.from('agent_attributions').select('agent_id').in('agent_id', ids),
    ]);
    const profMap = new Map((profiles.data ?? []).map((p) => [p.id as string, p]));
    const entryRows = (entries.data as { agent_id: string; amount: number; status: string }[] | null) ?? [];
    const attrRows = (attrs.data as { agent_id: string }[] | null) ?? [];
    return list.map((a) => {
      const id = a.id as string;
      const mine = entryRows.filter((e) => e.agent_id === id);
      const sum = (s: string) => mine.filter((e) => e.status === s).reduce((acc, e) => acc + Number(e.amount || 0), 0);
      const prof = profMap.get(id) as { name?: string; email?: string } | undefined;
      return {
        ...a,
        name: prof?.name ?? 'Agent',
        email: prof?.email ?? '',
        accounts: attrRows.filter((t) => t.agent_id === id).length,
        pending: sum('Pending'),
        approved: sum('Approved'),
        paid: sum('Paid'),
      };
    });
  },

  'sales.adminPlans': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.from('commission_plans').select('*').order('is_default', { ascending: false }).order('name');
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load plans'); }
    return data ?? [];
  },

  'sales.adminUpsertPlan': async (input: AnyRecord) => {
    const { data, error } = await supabase.rpc('admin_upsert_commission_plan', {
      p_id: (input.id as string | undefined) ?? null,
      p_name: (input.name as string) ?? 'Plan',
      p_description: (input.description as string) ?? '',
      p_config: (input.config as AnyRecord) ?? {},
      p_is_default: (input.isDefault as boolean) ?? false,
      p_active: (input.active as boolean) ?? true,
    });
    if (error) throwErr(error, 'Unable to save plan');
    return { id: data as string };
  },

  'sales.adminUpdateAgent': async (input: { agentId: string; planId?: string | null; status?: string }) => {
    const { error } = await supabase.rpc('admin_update_agent', {
      p_agent_id: input.agentId,
      p_plan_id: input.planId ?? null,
      p_status: input.status ?? null,
    });
    if (error) throwErr(error, 'Unable to update agent');
    return { success: true };
  },

  'sales.adminCommissions': async (input: { status?: string } | undefined, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    let q = supabase.from('commission_entries').select('*').order('created_at', { ascending: false }).limit(500);
    if (input?.status) q = q.eq('status', input.status);
    const { data, error } = await q;
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load commissions'); }
    const rows = (data as AnyRecord[] | null) ?? [];
    if (rows.length === 0) return [];
    const ids = Array.from(new Set(rows.map((r) => r.agent_id as string)));
    const { data: profiles } = await supabase.from('profiles').select('id, name, email').in('id', ids);
    const profMap = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    return rows.map((r) => {
      const prof = profMap.get(r.agent_id as string) as { name?: string; email?: string } | undefined;
      return { ...r, agentName: prof?.name ?? 'Agent', agentEmail: prof?.email ?? '' };
    });
  },

  'sales.adminSetCommissionStatus': async (input: { id: string; status: string }) => {
    const { error } = await supabase.rpc('admin_set_commission_status', { p_id: input.id, p_status: input.status });
    if (error) throwErr(error, 'Unable to update commission');
    return { success: true };
  },

  'sales.adminAwardCommission': async (input: { agentId: string; kind: string; vertical: string; amount: number; description: string }) => {
    const { data, error } = await supabase.rpc('admin_award_commission', {
      p_agent_id: input.agentId,
      p_kind: input.kind,
      p_vertical: input.vertical ?? '',
      p_amount: input.amount,
      p_description: input.description ?? '',
    });
    if (error) throwErr(error, 'Unable to award commission');
    return { id: data as string };
  },

  // =========================================================================
  // FINANCE — internal "sandbox" payment engine (fake Stripe). Simulates money
  // movement so the whole platform reconciles without a real gateway.
  // =========================================================================
  'finance.settings': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data } = await supabase.from('platform_settings').select('*').limit(1).maybeSingle();
    const row = (data ?? {}) as AnyRecord;
    return {
      paymentsMode: (row.payments_mode as string) ?? 'sandbox',
      drayageCommissionPercentage: Number(row.drayage_commission_percentage ?? 10),
      warehouseCommissionPercentage: Number(row.warehouse_commission_percentage ?? 8),
      serviceCommissionPercentage: Number(row.service_commission_percentage ?? 20),
      labourCommissionPercentage: Number(row.labour_commission_percentage ?? 15),
    };
  },

  'finance.setPaymentsMode': async (input: { mode: 'sandbox' | 'stripe' | 'off' }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.rpc('admin_set_payments_mode', { p_mode: input.mode });
    if (error) throwErr(error, 'Unable to change payments mode');
    return { success: true };
  },

  // Money overview across the sandbox: revenue (platform commission), collected
  // (gross), provider/worker/agent payouts owed vs paid, and how many completed
  // jobs still need settling.
  'finance.overview': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const [paymentsRes, payoutsRes, payablesRes, commissionsRes, invoicesRes] = await Promise.all([
      supabase.from('payments').select('gross_amount,commission_amount,net_amount,status,category'),
      supabase.from('payouts').select('net_amount,status').is('archived_at', null),
      supabase.from('worker_payables').select('gross_pay,status'),
      supabase.from('commission_entries').select('amount,status'),
      supabase.from('invoices').select('id,status'),
    ]);
    const settled = ['Paid', 'Captured'];
    const payments = (paymentsRes.data as AnyRecord[] | null) ?? [];
    const captured = payments.filter((p) => settled.includes(String(p.status)));
    const collected = captured.reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);
    const revenue = captured.reduce((s, p) => s + Number(p.commission_amount ?? 0), 0);
    const byCategory: Record<string, number> = {};
    for (const p of captured) {
      const key = String(p.category ?? 'other');
      byCategory[key] = (byCategory[key] ?? 0) + Number(p.commission_amount ?? 0);
    }
    const payouts = (payoutsRes.data as AnyRecord[] | null) ?? [];
    const payables = (payablesRes.data as AnyRecord[] | null) ?? [];
    const commissions = (commissionsRes.data as AnyRecord[] | null) ?? [];
    const invoices = (invoicesRes.data as AnyRecord[] | null) ?? [];
    const sum = (rows: AnyRecord[], field: string, statuses: string[]) =>
      rows.filter((r) => statuses.includes(String(r.status))).reduce((s, r) => s + Number(r[field] ?? 0), 0);
    return {
      collected: Math.round(collected),
      revenue: Math.round(revenue),
      revenueByCategory: byCategory,
      providerPayoutsPending: Math.round(sum(payouts, 'net_amount', ['Pending', 'Processing'])),
      providerPayoutsPaid: Math.round(sum(payouts, 'net_amount', ['Paid'])),
      workerPayoutsPending: Math.round(sum(payables, 'gross_pay', ['Pending', 'Approved'])),
      workerPayoutsPaid: Math.round(sum(payables, 'gross_pay', ['Paid'])),
      agentCommissionsPending: Math.round(sum(commissions, 'amount', ['Pending', 'Approved'])),
      agentCommissionsPaid: Math.round(sum(commissions, 'amount', ['Paid'])),
      invoiceCount: invoices.length,
      paidInvoiceCount: invoices.filter((i) => String(i.status) === 'Paid').length,
    };
  },

  // Completed operational jobs that have no invoice yet — the settle queue.
  'finance.unsettled': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const [orders, bookings, jobs, invoices] = await Promise.all([
      supabase.from('drayage_orders').select('id,status,total_price,currency,created_at').in('status', ['Delivered', 'EmptyReturned']),
      supabase.from('warehouse_bookings').select('id,status,final_price,counter_offer_price,proposed_price,created_at').in('status', ['Completed', 'InProgress']),
      supabase.from('service_jobs').select('id,status,total_price,created_at').eq('status', 'Completed'),
      supabase.from('invoices').select('drayage_order_id,booking_id,service_job_id'),
    ]);
    const inv = (invoices.data as AnyRecord[] | null) ?? [];
    const invDray = new Set(inv.map((i) => String(i.drayage_order_id)).filter((x) => x !== 'null'));
    const invBook = new Set(inv.map((i) => String(i.booking_id)).filter((x) => x !== 'null'));
    const invJob = new Set(inv.map((i) => String(i.service_job_id)).filter((x) => x !== 'null'));
    const dray = ((orders.data as AnyRecord[] | null) ?? [])
      .filter((o) => Number(o.total_price ?? 0) > 0 && !invDray.has(String(o.id)))
      .map((o) => ({ id: String(o.id), kind: 'drayage' as const, amount: Number(o.total_price ?? 0), createdAt: String(o.created_at) }));
    const book = ((bookings.data as AnyRecord[] | null) ?? [])
      .map((b) => ({ id: String(b.id), amount: Number(b.final_price ?? b.counter_offer_price ?? b.proposed_price ?? 0), createdAt: String(b.created_at) }))
      .filter((b) => b.amount > 0 && !invBook.has(b.id))
      .map((b) => ({ id: b.id, kind: 'warehouse' as const, amount: b.amount, createdAt: b.createdAt }));
    const job = ((jobs.data as AnyRecord[] | null) ?? [])
      .filter((j) => Number(j.total_price ?? 0) > 0 && !invJob.has(String(j.id)))
      .map((j) => ({ id: String(j.id), kind: 'service' as const, amount: Number(j.total_price ?? 0), createdAt: String(j.created_at) }));
    return [...dray, ...book, ...job].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  'finance.settleDrayageOrder': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.rpc('settle_drayage_order', { p_order_id: input.id });
    if (error) throwErr(error, 'Unable to settle drayage order');
    return { success: true };
  },
  'finance.settleBooking': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.rpc('settle_booking_invoice', { p_booking_id: input.id });
    if (error) throwErr(error, 'Unable to settle booking');
    return { success: true };
  },
  'finance.settleServiceJob': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.rpc('settle_service_job_invoice', { p_job_id: input.id });
    if (error) throwErr(error, 'Unable to settle service job');
    return { success: true };
  },
  'finance.settleAdvertisement': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.rpc('admin_settle_advertisement', { p_id: input.id });
    if (error) throwErr(error, 'Unable to settle advertisement');
    return { success: true };
  },

  // One-tap: settle every completed-but-unbilled job through the sandbox engine.
  'finance.settleAllCompleted': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const [orders, bookings, jobs, invoices] = await Promise.all([
      supabase.from('drayage_orders').select('id,total_price').in('status', ['Delivered', 'EmptyReturned']),
      supabase.from('warehouse_bookings').select('id,final_price,counter_offer_price,proposed_price').in('status', ['Completed', 'InProgress']),
      supabase.from('service_jobs').select('id,total_price').eq('status', 'Completed'),
      supabase.from('invoices').select('drayage_order_id,booking_id,service_job_id'),
    ]);
    const inv = (invoices.data as AnyRecord[] | null) ?? [];
    const invDray = new Set(inv.map((i) => String(i.drayage_order_id)).filter((x) => x !== 'null'));
    const invBook = new Set(inv.map((i) => String(i.booking_id)).filter((x) => x !== 'null'));
    const invJob = new Set(inv.map((i) => String(i.service_job_id)).filter((x) => x !== 'null'));
    let settled = 0;
    for (const o of (orders.data as AnyRecord[] | null) ?? []) {
      if (Number(o.total_price ?? 0) <= 0 || invDray.has(String(o.id))) continue;
      const { error } = await supabase.rpc('settle_drayage_order', { p_order_id: String(o.id) });
      if (!error) settled += 1;
    }
    for (const b of (bookings.data as AnyRecord[] | null) ?? []) {
      const amount = Number(b.final_price ?? b.counter_offer_price ?? b.proposed_price ?? 0);
      if (amount <= 0 || invBook.has(String(b.id))) continue;
      const { error } = await supabase.rpc('settle_booking_invoice', { p_booking_id: String(b.id) });
      if (!error) settled += 1;
    }
    for (const j of (jobs.data as AnyRecord[] | null) ?? []) {
      if (Number(j.total_price ?? 0) <= 0 || invJob.has(String(j.id))) continue;
      const { error } = await supabase.rpc('settle_service_job_invoice', { p_job_id: String(j.id) });
      if (!error) settled += 1;
    }
    return { settled };
  },

  // Payout rails (sandbox transfers).
  'finance.payouts': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.from('payouts').select('*').is('archived_at', null).order('created_at', { ascending: false }).limit(200);
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load payouts'); }
    const rows = (data as AnyRecord[] | null) ?? [];
    const ids = Array.from(new Set(rows.map((r) => r.company_id as string).filter(Boolean)));
    const { data: companies } = ids.length ? await supabase.from('companies').select('id,name').in('id', ids) : { data: [] as AnyRecord[] };
    const nameMap = new Map(((companies as AnyRecord[] | null) ?? []).map((c) => [c.id as string, c.name as string]));
    return rows.map((r) => ({ ...r, companyName: nameMap.get(r.company_id as string) ?? 'Provider' }));
  },
  'finance.runPayout': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.rpc('sandbox_pay_payout', { p_payout_id: input.id });
    if (error) throwErr(error, 'Unable to run payout');
    return { success: true };
  },
  'finance.runAllPayouts': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data } = await supabase.from('payouts').select('id').in('status', ['Pending', 'Processing']).is('archived_at', null);
    let paid = 0;
    for (const p of (data as AnyRecord[] | null) ?? []) {
      const { error } = await supabase.rpc('sandbox_pay_payout', { p_payout_id: String(p.id) });
      if (!error) paid += 1;
    }
    return { paid };
  },
  'finance.workerPayables': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.from('worker_payables').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) { if (isMissingRelation(error)) return []; throwErr(error, 'Unable to load worker payables'); }
    const rows = (data as AnyRecord[] | null) ?? [];
    const ids = Array.from(new Set(rows.map((r) => r.worker_user_id as string).filter(Boolean)));
    const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,name').in('id', ids) : { data: [] as AnyRecord[] };
    const nameMap = new Map(((profiles as AnyRecord[] | null) ?? []).map((p) => [p.id as string, p.name as string]));
    return rows.map((r) => ({ ...r, workerName: nameMap.get(r.worker_user_id as string) ?? 'Worker' }));
  },
  'finance.payWorker': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.rpc('sandbox_pay_worker', { p_payable_id: input.id });
    if (error) throwErr(error, 'Unable to pay worker');
    return { success: true };
  },
};

// ---------------------------------------------------------------------------
// Proxy factory
// ---------------------------------------------------------------------------
function procKey(ns: string, proc: string): string {
  return `${ns}.${proc}`;
}

// Best-effort AI error journal: failed procedures land in the copilot alerts
// feed (ai_events) so nothing gets lost. Throttled per procedure, never for
// ai.* itself (avoids loops), fire-and-forget so it can't mask the real error.
const recentAiErrorLog = new Map<string, number>();
function maybeLogAiError(key: string, err: unknown): void {
  try {
    if (key.startsWith('ai.')) return;
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg || msg === 'Not authenticated' || msg.startsWith('Unknown procedure')) return;
    const now = Date.now();
    const last = recentAiErrorLog.get(key) ?? 0;
    if (now - last < 5 * 60 * 1000) return;
    recentAiErrorLog.set(key, now);
    void supabase
      .rpc('ai_log_event', {
        p_kind: 'error',
        p_severity: 'medium',
        p_title: `App error in ${key}`,
        p_body: msg.slice(0, 500),
        p_entity_type: 'procedure',
        p_entity_id: key,
        p_dedupe_key: `apperr:${key}:${new Date().toISOString().slice(0, 10)}`,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    // never let error logging break the app
  }
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
      maybeLogAiError(key, err);
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
