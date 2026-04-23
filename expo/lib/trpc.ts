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
  type UseQueryOptions,
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
      // fallback: snake_case-ify keys
      for (const k of Object.keys(payload)) {
        db[k.replace(/([A-Z])/g, '_$1').toLowerCase()] = payload[k];
      }
    }
    const { error } = await supabase.from(table).update(db).eq('id', id);
    if (error) throwErr(error, 'Unable to update record');
    return { success: true };
  },

  // dock.updateCompany
  'dock.updateCompany': async (input: { id: string; payload: AnyRecord }) => {
    const { error } = await supabase.from('companies').update(input.payload).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update company');
    return { success: true };
  },

  // dock.updateUser
  'dock.updateUser': async (input: { id: string; payload: AnyRecord }) => {
    const db: AnyRecord = {};
    if ('name' in input.payload) db.name = input.payload.name;
    if ('status' in input.payload) db.status = input.payload.status;
    if ('role' in input.payload) db.role = input.payload.role;
    if ('profileImage' in input.payload) db.profile_image = input.payload.profileImage;
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
    return { id: input.id };
  },

  'bookings.respondToCounterOffer': async (input: { counterOfferId: string; action: 'accept' | 'reject'; note?: string }) => {
    const next = input.action === 'accept' ? 'Accepted' : 'Requested';
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

  'warehouses.setListingStatus': async (input: { id: string; status: string }) => {
    const { error } = await supabase.from('warehouse_listings').update({ status: input.status }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update status');
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

  'services.setListingStatus': async (input: { id: string; status: string }) => {
    const { error } = await supabase.from('service_listings').update({ status: input.status }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update status');
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

  'fulfillment.getBooking': async (input: { bookingId: string }) => {
    const { data: booking, error } = await supabase
      .from('warehouse_bookings').select('*').eq('id', input.bookingId).maybeSingle();
    if (error || !booking) throw new Error('Booking not found');
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
      role: 'customer' as const,
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
      .select('customer_company_id,listing_id')
      .eq('id', input.bookingId).single();
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

  'fulfillment.pickOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.from('fulfillment_orders').update({ status: 'Picking' }).eq('id', input.orderId);
    if (error) throwErr(error, 'Unable to update order');
    return { success: true, status: 'Picking' };
  },
  'fulfillment.packOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.from('fulfillment_orders').update({ status: 'Packed' }).eq('id', input.orderId);
    if (error) throwErr(error, 'Unable to update order');
    return { success: true, status: 'Packed' };
  },
  'fulfillment.shipOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.from('fulfillment_orders').update({ status: 'Shipped' }).eq('id', input.orderId);
    if (error) throwErr(error, 'Unable to update order');
    return { success: true, status: 'Shipped' };
  },
  'fulfillment.completeOrder': async (input: { orderId: string }) => {
    const { error } = await supabase.from('fulfillment_orders').update({ status: 'Completed' }).eq('id', input.orderId);
    if (error) throwErr(error, 'Unable to update order');
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
      row = { ...row, name: p.name ?? '', license_number: p.licenseNumber ?? '', phone: p.phone ?? '' };
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
      row = { ...row, name: p.name ?? '', license_number: p.licenseNumber ?? '', phone: p.phone ?? '' };
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

  'operations.driverJobs': async (_input, ctx) => {
    const { data } = await supabase
      .from('dock_appointments')
      .select('*')
      .or(`driver_name.eq.${ctx.user.name}`)
      .is('archived_at', null)
      .order('scheduled_start');
    return data ?? [];
  },

  'operations.uploadPodReference': async (input: { appointmentId: string; fileId: string }) => {
    const { error } = await supabase.from('dock_appointments').update({ pod_file: input.fileId }).eq('id', input.appointmentId);
    if (error) throwErr(error, 'Unable to upload POD');
    return { success: true };
  },

  'operations.gatePanel': async (_input, ctx) => {
    if (!ctx.user.companyId) return [];
    const { data: myListings } = await supabase.from('warehouse_listings').select('id').eq('company_id', ctx.user.companyId);
    const ids = (myListings ?? []).map((x) => x.id);
    if (ids.length === 0) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setDate(end.getDate() + 1);
    const { data } = await supabase
      .from('dock_appointments').select('*')
      .in('warehouse_listing_id', ids)
      .gte('scheduled_start', today.toISOString())
      .lt('scheduled_start', end.toISOString())
      .order('scheduled_start');
    return data ?? [];
  },

  'operations.checkInAppointment': async (input: { appointmentId: string; status: string; driverName?: string | null; truckPlate?: string | null }) => {
    const patch: AnyRecord = { status: input.status };
    if (input.status === 'CheckedIn') patch.check_in_ts = new Date().toISOString();
    if (input.status === 'Completed') patch.check_out_ts = new Date().toISOString();
    if (input.driverName) patch.driver_name = input.driverName;
    if (input.truckPlate) patch.truck_plate = input.truckPlate;
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
      appointment_type: input.appointmentType,
      pallet_count: input.palletCount,
      status: 'Requested',
    }).select().single();
    if (error) throwErr(error, 'Unable to create appointment');
    return { id: data!.id };
  },

  // =========================================================================
  // PAYMENTS
  // =========================================================================
  'payments.list': async (_input, ctx) => {
    const q = supabase.from('payments').select('*').order('created_at', { ascending: false });
    const { data, error } = isAdmin(ctx.user.role) ? await q : await q;
    if (error) throwErr(error, 'Unable to load payments');
    return data ?? [];
  },
  'payments.getPayment': async (input: { id: string }) => {
    const { data, error } = await supabase.from('payments').select('*').eq('id', input.id).maybeSingle();
    if (error || !data) throw new Error('Payment not found');
    return data;
  },
  'payments.listInvoices': async () => {
    const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
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
  'payments.updateInvoiceStatus': async () => ({ success: true }),
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
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to mark notification');
    return { success: true };
  },

  // =========================================================================
  // ADMIN
  // =========================================================================
  'admin.dashboard': async () => {
    const [users, companies, bookings, disputes] = await Promise.all([
      supabase.from('profiles').select('id,email,name,role,status,company_id,created_at').limit(200),
      supabase.from('companies').select('*').limit(200),
      supabase.from('warehouse_bookings').select('*').limit(200),
      supabase.from('disputes').select('*').limit(200),
    ]);
    return {
      users: users.data ?? [], companies: companies.data ?? [],
      bookings: bookings.data ?? [], disputes: disputes.data ?? [], audits: [],
    };
  },

  'admin.listEntity': async (input: { entity: string }) => {
    const entity = input.entity;
    const table = entity === 'users' ? 'profiles' : entity === 'message_threads' ? 'chat_threads' : entity;
    const q = supabase.from(table).select('*').order('created_at', { ascending: false }).limit(200);
    const { data, error } = await q;
    if (error) return [];
    return data ?? [];
  },

  'admin.getEntityRecord': async (input: { entity: string; id: string }) => {
    if (!input.id) return null;
    const table = input.entity === 'users' ? 'profiles' : input.entity === 'message_threads' ? 'chat_threads' : input.entity;
    const { data } = await supabase.from(table).select('*').eq('id', input.id).maybeSingle();
    return data;
  },

  'admin.updateEntityStatus': async (input: { entity: string; id: string; status: string }) => {
    const table = input.entity === 'users' ? 'profiles' : input.entity === 'message_threads' ? 'chat_threads' : input.entity;
    const { error } = await supabase.from(table).update({ status: input.status }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update status');
    return { success: true };
  },

  'admin.archiveEntity': async (input: { entity: string; id: string }) => {
    const table = input.entity === 'users' ? 'profiles' : input.entity === 'message_threads' ? 'chat_threads' : input.entity;
    // try soft-delete via archived_at, fallback to status = 'Archived'
    let { error } = await supabase.from(table).update({ archived_at: new Date().toISOString() }).eq('id', input.id);
    if (error) {
      await supabase.from(table).update({ status: 'Archived' }).eq('id', input.id);
    }
    return { success: true };
  },

  'admin.setCompanyStatus': async (input: { companyId: string; status: string }) => {
    const { error } = await supabase.from('companies').update({ status: input.status }).eq('id', input.companyId);
    if (error) throwErr(error, 'Unable to update company');
    return { success: true };
  },

  'admin.setUserStatus': async (input: { userId: string; status: string }) => {
    const { error } = await supabase.from('profiles').update({ status: input.status }).eq('id', input.userId);
    if (error) throwErr(error, 'Unable to update user');
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
  'admin.updatePlatformSettings': async (input: { data: AnyRecord }, ctx) => {
    const { data: existing } = await supabase.from('platform_settings').select('id').limit(1).maybeSingle();
    if (existing) {
      await supabase.from('platform_settings').update({
        warehouse_commission_percentage: input.data.warehouseCommissionPercentage ?? 8,
        service_commission_percentage: input.data.serviceCommissionPercentage ?? 20,
        labour_commission_percentage: input.data.labourCommissionPercentage ?? 15,
        handling_fee_per_pallet_default: input.data.handlingFeePerPalletDefault ?? 12,
        tax_mode: input.data.taxMode ?? 'GST+PST',
        updated_at: new Date().toISOString(),
        updated_by: ctx.user.id,
      }).eq('id', existing.id);
      return { id: existing.id };
    }
    const { data } = await supabase.from('platform_settings').insert({
      warehouse_commission_percentage: input.data.warehouseCommissionPercentage ?? 8,
      service_commission_percentage: input.data.serviceCommissionPercentage ?? 20,
      labour_commission_percentage: input.data.labourCommissionPercentage ?? 15,
      handling_fee_per_pallet_default: input.data.handlingFeePerPalletDefault ?? 12,
      tax_mode: input.data.taxMode ?? 'GST+PST',
      updated_by: ctx.user.id,
    }).select().single();
    return { id: data?.id ?? null };
  },

  // =========================================================================
  // ANALYTICS
  // =========================================================================
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
  'shifts.setStatus': async (input: { id: string; status: string }) => {
    const { error } = await supabase.from('shift_posts').update({ status: input.status }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to update shift');
    return { success: true };
  },
  'shifts.apply': async (input: { shiftId: string }) => {
    const { data, error } = await supabase.rpc('worker_apply_shift', { p_shift_id: input.shiftId });
    if (error) throwErr(error, 'Unable to apply');
    return { id: data as string };
  },
  'shifts.withdraw': async (input: { applicationId: string }) => {
    const { error } = await supabase.from('shift_applications').update({ status: 'Withdrawn' }).eq('id', input.applicationId);
    if (error) throwErr(error, 'Unable to withdraw');
    return { success: true };
  },
  'shifts.acceptApplicant': async (input: { applicationId: string; rate?: number }) => {
    const { data, error } = await supabase.rpc('employer_accept_applicant', {
      p_application_id: input.applicationId, p_rate: input.rate ?? null,
    });
    if (error) throwErr(error, 'Unable to accept applicant');
    return { assignmentId: data as string };
  },
  'shifts.rejectApplicant': async (input: { applicationId: string; reason?: string }) => {
    const { error } = await supabase.rpc('employer_reject_applicant', {
      p_application_id: input.applicationId, p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to reject');
    return { success: true };
  },
  'shifts.clockIn': async (input: { assignmentId: string }) => {
    const { data, error } = await supabase.rpc('worker_clock_in', { p_assignment_id: input.assignmentId });
    if (error) throwErr(error, 'Unable to clock in');
    return { timeEntryId: data as string };
  },
  'shifts.clockOut': async (input: { assignmentId: string }) => {
    const { error } = await supabase.rpc('worker_clock_out', { p_assignment_id: input.assignmentId });
    if (error) throwErr(error, 'Unable to clock out');
    return { success: true };
  },
  'shifts.confirmHours': async (input: { timeEntryId: string; hours: number; notes?: string }) => {
    const { error } = await supabase.rpc('employer_confirm_hours', {
      p_time_entry_id: input.timeEntryId, p_hours: input.hours, p_notes: input.notes ?? '',
    });
    if (error) throwErr(error, 'Unable to confirm hours');
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
  'company.addMember': async (input: { companyId: string; userId: string; role?: 'Owner' | 'Staff' }) => {
    const { error } = await supabase.rpc('company_add_member', {
      p_company_id: input.companyId, p_user_id: input.userId, p_role: input.role ?? 'Staff',
    });
    if (error) throwErr(error, 'Unable to add member');
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
    const { error } = await supabase.rpc('admin_approve_certification', {
      p_cert_id: input.id,
      p_reason: input.reason ?? null,
    });
    if (error) throwErr(error, 'Unable to approve certification');
    return { success: true };
  },

  'certifications.adminReject': async (input: { id: string; reason: string }) => {
    const { error } = await supabase.rpc('admin_reject_certification', {
      p_cert_id: input.id,
      p_reason: input.reason,
    });
    if (error) throwErr(error, 'Unable to reject certification');
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
  'shipping.purchaseLabel': async (input: { shipmentId: string }) => {
    const { data, error } = await supabase.functions.invoke('purchase-shipping-label', {
      body: { shipment_id: input.shipmentId },
    });
    if (error) throwErr(error, 'Unable to purchase label');
    return data as { tracking_code: string; label_url: string; carrier: string; rate: number; currency: string };
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

  // =========================================================================
  // WMS — locations, stock levels, receipts, cycle counts
  // =========================================================================
  'wms.listLocations': async (_input, ctx) => {
    if (!ctx.user.companyId && !isAdmin(ctx.user.role)) return [];
    const q = supabase.from('warehouse_locations').select('*').is('archived_at', null).order('zone').order('aisle');
    const { data, error } = isAdmin(ctx.user.role) ? await q : await q.eq('company_id', ctx.user.companyId!);
    if (error) throwErr(error, 'Unable to load locations');
    return data ?? [];
  },
  'wms.createLocation': async (input: AnyRecord, ctx) => {
    if (!ctx.user.companyId) throw new Error('Company context required');
    const { data, error } = await supabase.from('warehouse_locations').insert({
      company_id: ctx.user.companyId,
      listing_id: input.listingId ?? null,
      zone: input.zone ?? '',
      aisle: input.aisle ?? '',
      rack: input.rack ?? '',
      level: input.level ?? '',
      bin: input.bin ?? '',
      label: input.label ?? '',
    }).select().single();
    if (error) throwErr(error, 'Unable to create location');
    return { id: data!.id };
  },
  'wms.listStockLevels': async (input: { variantId?: string; locationId?: string } | undefined, ctx) => {
    let q = supabase.from('stock_levels').select('*, product_variants(sku,name), warehouse_locations(label,zone,aisle,bin)').order('updated_at', { ascending: false }).limit(500);
    if (input?.variantId) q = q.eq('variant_id', input.variantId);
    if (input?.locationId) q = q.eq('location_id', input.locationId);
    if (!isAdmin(ctx.user.role) && ctx.user.companyId) q = q.eq('company_id', ctx.user.companyId);
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
    const { data, error } = await supabase.rpc('wms_receive', {
      p_receipt_id: input.receiptId ?? null,
      p_variant_id: input.variantId,
      p_location_id: input.locationId,
      p_quantity: input.quantity,
      p_lot_code: input.lotCode ?? null,
      p_reference: input.reference ?? '',
    });
    if (error) throwErr(error, 'Unable to record receipt');
    return { movementId: data as string };
  },
  'wms.adjust': async (input: { variantId: string; locationId: string; delta: number; reason: string }) => {
    const { error } = await supabase.rpc('wms_adjust', {
      p_variant_id: input.variantId,
      p_location_id: input.locationId,
      p_delta: input.delta,
      p_reason: input.reason,
    });
    if (error) throwErr(error, 'Unable to adjust stock');
    return { success: true };
  },
  'wms.listCycleCounts': async (_input, ctx) => {
    const q = supabase.from('cycle_counts').select('*').order('created_at', { ascending: false }).limit(200);
    const { data, error } = isAdmin(ctx.user.role)
      ? await q
      : ctx.user.companyId ? await q.eq('company_id', ctx.user.companyId) : { data: [], error: null };
    if (error) throwErr(error, 'Unable to load cycle counts');
    return data ?? [];
  },

  // =========================================================================
  // YARD / GATE / POD
  // =========================================================================
  'yard.listEvents': async (input: { appointmentId?: string } | undefined, ctx) => {
    let q = supabase.from('gate_events').select('*').order('occurred_at', { ascending: false }).limit(200);
    if (input?.appointmentId) q = q.eq('appointment_id', input.appointmentId);
    else if (!isAdmin(ctx.user.role) && ctx.user.companyId) q = q.eq('warehouse_company_id', ctx.user.companyId);
    const { data, error } = await q;
    if (error) throwErr(error, 'Unable to load gate events');
    return data ?? [];
  },
  'yard.recordEvent': async (input: { appointmentId: string; kind: string; notes?: string; meta?: AnyRecord }) => {
    const { data, error } = await supabase.rpc('gate_record_event', {
      p_appointment_id: input.appointmentId,
      p_kind: input.kind,
      p_notes: input.notes ?? '',
      p_meta: input.meta ?? {},
    });
    if (error) throwErr(error, 'Unable to record gate event');
    return { id: data as string };
  },
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
    console.log('[trpc-shim] unknown procedure', key);
    return Promise.reject(new Error(`Unknown procedure: ${key}`));
  }
  return requireCtx().then((ctx) => fn(input, ctx));
}

type QueryHookInput<T> = [T] | [T, Partial<UseQueryOptions<unknown, Error>>] | [];
type MutationHook = (options?: UseMutationOptions<unknown, Error, any>) => ReturnType<typeof useMutation>;

function makeProcedureHandlers(ns: string, proc: string) {
  return {
    useQuery: (...args: QueryHookInput<unknown>) => {
      const input = args[0];
      const options = (args[1] ?? {}) as Partial<UseQueryOptions<unknown, Error>>;
      return useQuery({
        queryKey: ['trpc', ns, proc, input ?? null],
        queryFn: () => callProcedure(ns, proc, input),
        ...options,
      });
    },
    useMutation: ((options?: UseMutationOptions<unknown, Error, any>) =>
      useMutation<unknown, Error, any>({
        mutationFn: (input: unknown) => callProcedure(ns, proc, input),
        ...options,
      })) as MutationHook,
  };
}

type ProcProxy = {
  useQuery: (input?: unknown, options?: Partial<UseQueryOptions<unknown, Error>>) => ReturnType<typeof useQuery>;
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
