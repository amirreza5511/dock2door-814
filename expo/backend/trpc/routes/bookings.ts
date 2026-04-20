import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser, type SessionUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { notifyCompanyMembers } from '@/backend/events';
import type { PoolClient } from 'pg';

type BookingStatus =
  | 'Draft' | 'Requested' | 'PendingReview' | 'Quoted' | 'CounterOffered'
  | 'Approved' | 'Rejected' | 'Confirmed' | 'Scheduled' | 'InProgress'
  | 'Completed' | 'Cancelled' | 'Disputed' | 'Refunded' | 'Closed';

interface BookingRow {
  id: string;
  company_id: string;
  provider_company_id: string | null;
  listing_id: string | null;
  customer_user_id: string | null;
  status: BookingStatus;
  total_amount: string;
  currency: string;
  scheduled_at: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface CounterOfferRow {
  id: string;
  booking_id: string;
  quote_version_id: string | null;
  proposed_by_user_id: string | null;
  proposed_by_role: 'customer' | 'provider';
  amount: string;
  currency: string;
  message: string | null;
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Superseded';
  created_at: string;
  resolved_at: string | null;
}

interface WarehouseListingRow {
  id: string;
  company_id: string;
  name: string;
  city: string;
  available_pallet_capacity: number;
  storage_rate_per_pallet: string;
  status: string;
}

async function loadBooking(id: string): Promise<BookingRow> {
  const row = await queryRow<BookingRow>(
    `SELECT id, company_id, provider_company_id, listing_id, customer_user_id,
            status::text AS status, total_amount::text AS total_amount, currency,
            scheduled_at, data, created_at, updated_at
     FROM bookings WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' });
  return row;
}

function assertParticipant(user: SessionUser, booking: BookingRow): 'customer' | 'provider' | 'admin' {
  if (user.role === 'Admin' || user.role === 'SuperAdmin') return 'admin';
  if (user.companyId === booking.company_id) return 'customer';
  if (user.companyId === booking.provider_company_id) return 'provider';
  throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this booking' });
}

async function recordStatusHistory(
  client: PoolClient,
  booking: BookingRow,
  nextStatus: BookingStatus,
  actorUserId: string,
  note: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO booking_status_history (id, booking_id, actor_user_id, previous_status, new_status, note)
     VALUES ($1, $2, $3, $4::booking_status, $5::booking_status, $6)`,
    [crypto.randomUUID(), booking.id, actorUserId, booking.status, nextStatus, note],
  );
}

const createSchema = z.object({
  listingId: z.string(),
  palletsRequested: z.number().int().positive(),
  startDate: z.string(),
  endDate: z.string(),
  handlingRequired: z.boolean().default(false),
  customerNotes: z.string().max(2000).default(''),
  proposedPrice: z.number().nonnegative(),
});

export const bookingsRouter = createTRPCRouter({
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    if (user.role === 'Admin' || user.role === 'SuperAdmin') {
      return queryRows<BookingRow>(
        `SELECT id, company_id, provider_company_id, listing_id, customer_user_id,
                status::text AS status, total_amount::text AS total_amount, currency,
                scheduled_at, data, created_at, updated_at
         FROM bookings WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`, [],
      );
    }
    if (!user.companyId) return [];
    return queryRows<BookingRow>(
      `SELECT id, company_id, provider_company_id, listing_id, customer_user_id,
              status::text AS status, total_amount::text AS total_amount, currency,
              scheduled_at, data, created_at, updated_at
       FROM bookings
       WHERE (company_id = $1 OR provider_company_id = $1) AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [user.companyId],
    );
  }),

  getDetail: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBooking(input.id);
    assertParticipant(user, booking);
    const history = await queryRows(
      `SELECT id, actor_user_id, previous_status::text AS previous_status,
              new_status::text AS new_status, note, created_at
       FROM booking_status_history WHERE booking_id = $1 ORDER BY created_at ASC`,
      [input.id],
    );
    const counterOffers = await queryRows<CounterOfferRow>(
      `SELECT id, booking_id, quote_version_id, proposed_by_user_id, proposed_by_role,
              amount::text AS amount, currency, message, status, created_at, resolved_at
       FROM counter_offers WHERE booking_id = $1 ORDER BY created_at ASC`,
      [input.id],
    );
    return { booking, history, counterOffers };
  }),

  create: protectedProcedure.input(createSchema).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (user.role !== 'Customer' || !user.companyId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only customers can create bookings' });
    }
    const listing = await queryRow<WarehouseListingRow>(
      `SELECT id, company_id, name, city, available_pallet_capacity,
              storage_rate_per_pallet::text AS storage_rate_per_pallet, status::text AS status
       FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`,
      [input.listingId],
    );
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse listing not found' });
    if (listing.status !== 'Available') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Warehouse is not available' });
    }
    if (input.palletsRequested > listing.available_pallet_capacity) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Requested capacity exceeds available pallets' });
    }

    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO bookings (id, company_id, provider_company_id, listing_id, customer_user_id,
                               status, total_amount, currency, data)
         VALUES ($1, $2, $3, $4, $5, 'Requested', $6, 'cad', $7::jsonb)`,
        [
          id, user.companyId, listing.company_id, listing.id, user.id,
          input.proposedPrice,
          JSON.stringify({
            palletsRequested: input.palletsRequested,
            startDate: input.startDate,
            endDate: input.endDate,
            handlingRequired: input.handlingRequired,
            customerNotes: input.customerNotes,
            proposedPrice: input.proposedPrice,
            bookingType: 'Warehouse',
          }),
        ],
      );
      await client.query(
        `INSERT INTO booking_status_history (id, booking_id, actor_user_id, previous_status, new_status, note)
         VALUES ($1, $2, $3, NULL, 'Requested', $4)`,
        [crypto.randomUUID(), id, user.id, input.customerNotes || null],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'bookings', entityId: id, action: 'create',
        newValue: { listingId: listing.id, palletsRequested: input.palletsRequested, price: input.proposedPrice },
        requestId: ctx.requestId,
      });
      await notifyCompanyMembers(client, {
        companyId: listing.company_id,
        eventKey: 'booking.requested',
        title: 'New booking request',
        body: `${user.name} requested ${input.palletsRequested} pallets at ${listing.name}.`,
        metadata: { bookingId: id, listingId: listing.id },
      });
    });
    return { id };
  }),

  accept: protectedProcedure.input(z.object({ id: z.string(), note: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBooking(input.id);
    const role = assertParticipant(user, booking);
    if (role !== 'provider' && role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the warehouse provider can accept a booking' });
    }
    if (!['Requested', 'CounterOffered'].includes(booking.status)) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Cannot accept booking in status ${booking.status}` });
    }
    if (booking.listing_id) {
      const pallets = Number((booking.data as Record<string, unknown> | null)?.palletsRequested ?? 0);
      const listing = await queryRow<{ available_pallet_capacity: number }>(
        `SELECT available_pallet_capacity FROM warehouse_listings WHERE id = $1`, [booking.listing_id],
      );
      if (listing && pallets > listing.available_pallet_capacity) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Capacity no longer available on this warehouse' });
      }
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE bookings SET status = 'Confirmed', updated_at = NOW() WHERE id = $1`, [booking.id]);
      await recordStatusHistory(client, booking, 'Confirmed', user.id, input.note ?? null);
      await client.query(
        `UPDATE counter_offers SET status = 'Superseded', resolved_at = NOW()
         WHERE booking_id = $1 AND status = 'Pending'`, [booking.id],
      );
      if (booking.listing_id) {
        const pallets = Number((booking.data as Record<string, unknown> | null)?.palletsRequested ?? 0);
        if (pallets > 0) {
          await client.query(
            `UPDATE warehouse_listings
             SET available_pallet_capacity = GREATEST(available_pallet_capacity - $1, 0), updated_at = NOW()
             WHERE id = $2`,
            [pallets, booking.listing_id],
          );
        }
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: booking.provider_company_id,
        entityName: 'bookings', entityId: booking.id, action: 'accept',
        previousValue: { status: booking.status }, newValue: { status: 'Confirmed' },
        requestId: ctx.requestId,
      });
      await notifyCompanyMembers(client, {
        companyId: booking.company_id,
        eventKey: 'booking.confirmed',
        title: 'Booking confirmed',
        body: 'The warehouse provider confirmed your booking.',
        metadata: { bookingId: booking.id },
      });
    });
    return { success: true, status: 'Confirmed' as const };
  }),

  decline: protectedProcedure.input(z.object({ id: z.string(), note: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBooking(input.id);
    const role = assertParticipant(user, booking);
    if (role === 'customer') {
      if (!['Requested', 'CounterOffered', 'Quoted'].includes(booking.status)) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Cannot cancel booking in status ${booking.status}` });
      }
    } else if (role === 'provider' || role === 'admin') {
      if (!['Requested', 'CounterOffered'].includes(booking.status)) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Cannot decline booking in status ${booking.status}` });
      }
    }
    const nextStatus: BookingStatus = role === 'customer' ? 'Cancelled' : 'Rejected';
    await withTransaction(async (client) => {
      await client.query(`UPDATE bookings SET status = $1::booking_status, updated_at = NOW() WHERE id = $2`, [nextStatus, booking.id]);
      await recordStatusHistory(client, booking, nextStatus, user.id, input.note ?? null);
      await client.query(
        `UPDATE counter_offers SET status = 'Superseded', resolved_at = NOW()
         WHERE booking_id = $1 AND status = 'Pending'`, [booking.id],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'bookings', entityId: booking.id, action: nextStatus === 'Cancelled' ? 'cancel' : 'decline',
        previousValue: { status: booking.status }, newValue: { status: nextStatus },
        requestId: ctx.requestId,
      });
      await notifyCompanyMembers(client, {
        companyId: role === 'customer' ? booking.provider_company_id : booking.company_id,
        eventKey: nextStatus === 'Cancelled' ? 'booking.cancelled' : 'booking.declined',
        title: nextStatus === 'Cancelled' ? 'Booking cancelled' : 'Booking declined',
        body: nextStatus === 'Cancelled' ? 'The customer cancelled this booking.' : 'The warehouse provider declined this booking.',
        metadata: { bookingId: booking.id },
      });
    });
    return { success: true, status: nextStatus };
  }),

  submitCounterOffer: protectedProcedure.input(z.object({
    id: z.string(),
    amount: z.number().positive(),
    message: z.string().max(1000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBooking(input.id);
    const role = assertParticipant(user, booking);
    if (role === 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin cannot submit counter-offers' });
    if (!['Requested', 'CounterOffered', 'Quoted'].includes(booking.status)) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Cannot counter in status ${booking.status}` });
    }
    const counterId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE counter_offers SET status = 'Superseded', resolved_at = NOW()
         WHERE booking_id = $1 AND status = 'Pending'`, [booking.id],
      );
      await client.query(
        `INSERT INTO counter_offers (id, booking_id, proposed_by_user_id, proposed_by_role, amount, currency, message, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')`,
        [counterId, booking.id, user.id, role, input.amount, booking.currency, input.message ?? null],
      );
      await client.query(
        `UPDATE bookings SET status = 'CounterOffered', total_amount = $1, updated_at = NOW() WHERE id = $2`,
        [input.amount, booking.id],
      );
      await recordStatusHistory(client, booking, 'CounterOffered', user.id, input.message ?? null);
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'counter_offers', entityId: counterId, action: 'create',
        newValue: { amount: input.amount, proposedByRole: role },
        requestId: ctx.requestId,
      });
      await notifyCompanyMembers(client, {
        companyId: role === 'customer' ? booking.provider_company_id : booking.company_id,
        eventKey: 'booking.counter_offered',
        title: 'Counter offer received',
        body: `New counter offer: ${input.amount}.`,
        metadata: { bookingId: booking.id, counterOfferId: counterId },
      });
    });
    return { id: counterId };
  }),

  respondToCounterOffer: protectedProcedure.input(z.object({
    counterOfferId: z.string(),
    action: z.enum(['accept', 'reject']),
    note: z.string().max(1000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const offer = await queryRow<CounterOfferRow>(
      `SELECT id, booking_id, quote_version_id, proposed_by_user_id, proposed_by_role,
              amount::text AS amount, currency, message, status, created_at, resolved_at
       FROM counter_offers WHERE id = $1`, [input.counterOfferId],
    );
    if (!offer) throw new TRPCError({ code: 'NOT_FOUND', message: 'Counter-offer not found' });
    if (offer.status !== 'Pending') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Counter-offer is no longer pending' });
    }
    const booking = await loadBooking(offer.booking_id);
    const role = assertParticipant(user, booking);
    if (role === 'admin') throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin cannot respond to counter-offers' });
    if (role === offer.proposed_by_role) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'The party who proposed cannot respond to their own counter-offer' });
    }

    const nextOfferStatus: CounterOfferRow['status'] = input.action === 'accept' ? 'Accepted' : 'Rejected';
    const nextBookingStatus: BookingStatus = input.action === 'accept' ? 'Confirmed' : 'Requested';

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE counter_offers SET status = $1, resolved_at = NOW() WHERE id = $2`,
        [nextOfferStatus, offer.id],
      );
      if (input.action === 'accept') {
        await client.query(
          `UPDATE bookings SET status = 'Confirmed', total_amount = $1, updated_at = NOW() WHERE id = $2`,
          [Number(offer.amount), booking.id],
        );
        if (booking.listing_id) {
          const pallets = Number((booking.data as Record<string, unknown> | null)?.palletsRequested ?? 0);
          if (pallets > 0) {
            await client.query(
              `UPDATE warehouse_listings
               SET available_pallet_capacity = GREATEST(available_pallet_capacity - $1, 0), updated_at = NOW()
               WHERE id = $2`,
              [pallets, booking.listing_id],
            );
          }
        }
      } else {
        await client.query(`UPDATE bookings SET status = 'Requested', updated_at = NOW() WHERE id = $1`, [booking.id]);
      }
      await recordStatusHistory(client, booking, nextBookingStatus, user.id, input.note ?? null);
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'counter_offers', entityId: offer.id, action: input.action,
        previousValue: { status: 'Pending' }, newValue: { status: nextOfferStatus, bookingStatus: nextBookingStatus },
        requestId: ctx.requestId,
      });
      await notifyCompanyMembers(client, {
        companyId: role === 'customer' ? booking.provider_company_id : booking.company_id,
        eventKey: `booking.counter_${input.action}ed`,
        title: input.action === 'accept' ? 'Counter offer accepted' : 'Counter offer rejected',
        body: input.action === 'accept' ? 'Booking is now confirmed.' : 'The counter offer was rejected.',
        metadata: { bookingId: booking.id, counterOfferId: offer.id },
      });
    });
    return { success: true, bookingStatus: nextBookingStatus, counterOfferStatus: nextOfferStatus };
  }),

  markInProgress: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBooking(input.id);
    const role = assertParticipant(user, booking);
    if (role === 'customer') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only provider can start a booking' });
    if (!['Confirmed', 'Scheduled'].includes(booking.status)) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Cannot start booking in status ${booking.status}` });
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE bookings SET status = 'InProgress', updated_at = NOW() WHERE id = $1`, [booking.id]);
      await recordStatusHistory(client, booking, 'InProgress', user.id, null);
    });
    return { success: true };
  }),

  complete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBooking(input.id);
    const role = assertParticipant(user, booking);
    if (role === 'customer') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only provider can complete a booking' });
    if (!['Confirmed', 'Scheduled', 'InProgress'].includes(booking.status)) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Cannot complete booking in status ${booking.status}` });
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE bookings SET status = 'Completed', updated_at = NOW() WHERE id = $1`, [booking.id]);
      await recordStatusHistory(client, booking, 'Completed', user.id, null);
      if (booking.listing_id) {
        const pallets = Number((booking.data as Record<string, unknown> | null)?.palletsRequested ?? 0);
        if (pallets > 0) {
          await client.query(
            `UPDATE warehouse_listings SET available_pallet_capacity = available_pallet_capacity + $1, updated_at = NOW() WHERE id = $2`,
            [pallets, booking.listing_id],
          );
        }
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'bookings', entityId: booking.id, action: 'complete',
        previousValue: { status: booking.status }, newValue: { status: 'Completed' },
        requestId: ctx.requestId,
      });
      await notifyCompanyMembers(client, {
        companyId: booking.company_id,
        eventKey: 'booking.completed',
        title: 'Booking completed',
        body: 'Your booking has been marked completed.',
        metadata: { bookingId: booking.id },
      });
    });
    return { success: true };
  }),
});
