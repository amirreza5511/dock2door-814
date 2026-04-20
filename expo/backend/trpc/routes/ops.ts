import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser, type SessionUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';

async function assertWarehouseOwner(user: SessionUser, warehouseListingId: string): Promise<string> {
  const row = await queryRow<{ company_id: string }>(
    `SELECT company_id FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`,
    [warehouseListingId],
  );
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
  if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && user.companyId !== row.company_id) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant access denied' });
  }
  return row.company_id;
}

export const opsRouter = createTRPCRouter({
  listYardLocations: protectedProcedure.input(z.object({ warehouseListingId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await assertWarehouseOwner(user, input.warehouseListingId);
    return queryRows(
      `SELECT id, warehouse_listing_id, code, kind, is_active, notes, created_at
       FROM yard_locations WHERE warehouse_listing_id = $1 ORDER BY code ASC`,
      [input.warehouseListingId],
    );
  }),
  createYardLocation: protectedProcedure.input(z.object({
    warehouseListingId: z.string(),
    code: z.string().min(1).max(40),
    kind: z.enum(['Parking', 'Staging', 'Inbound', 'Outbound']).default('Parking'),
    notes: z.string().max(500).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const companyId = await assertWarehouseOwner(user, input.warehouseListingId);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO yard_locations (id, warehouse_listing_id, code, kind, notes) VALUES ($1, $2, $3, $4, $5)`,
        [id, input.warehouseListingId, input.code, input.kind, input.notes ?? null],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId,
        entityName: 'yard_locations', entityId: id, action: 'create',
        newValue: { code: input.code, kind: input.kind }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),
  recordYardMove: protectedProcedure.input(z.object({
    warehouseListingId: z.string(),
    appointmentId: z.string().nullable().optional(),
    trailerNumber: z.string().max(40).nullable().optional(),
    truckPlate: z.string().max(40).nullable().optional(),
    fromLocationId: z.string().nullable().optional(),
    toLocationId: z.string().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const companyId = await assertWarehouseOwner(user, input.warehouseListingId);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO yard_moves (id, warehouse_listing_id, appointment_id, trailer_number, truck_plate, from_location_id, to_location_id, actor_user_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, input.warehouseListingId, input.appointmentId ?? null, input.trailerNumber ?? null, input.truckPlate ?? null, input.fromLocationId ?? null, input.toLocationId ?? null, user.id, input.notes ?? null],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId,
        entityName: 'yard_moves', entityId: id, action: 'create',
        newValue: { trailerNumber: input.trailerNumber, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),
  listYardMoves: protectedProcedure.input(z.object({ warehouseListingId: z.string(), limit: z.number().int().positive().max(200).default(100) })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await assertWarehouseOwner(user, input.warehouseListingId);
    return queryRows(
      `SELECT id, warehouse_listing_id, appointment_id, trailer_number, truck_plate, from_location_id, to_location_id, notes, moved_at
       FROM yard_moves WHERE warehouse_listing_id = $1 ORDER BY moved_at DESC LIMIT $2`,
      [input.warehouseListingId, input.limit],
    );
  }),
  recordAppointmentDelay: protectedProcedure.input(z.object({
    appointmentId: z.string(),
    reason: z.string().min(1).max(200),
    delayMinutes: z.number().int().nonnegative(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const appt = await queryRow<{ company_id: string; warehouse_listing_id: string }>(
      `SELECT company_id, warehouse_listing_id FROM dock_appointments WHERE id = $1 AND deleted_at IS NULL`,
      [input.appointmentId],
    );
    if (!appt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Appointment not found' });
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO appointment_delays (id, appointment_id, reason, delay_minutes, actor_user_id) VALUES ($1, $2, $3, $4, $5)`,
        [id, input.appointmentId, input.reason, input.delayMinutes, user.id],
      );
      await client.query(`UPDATE dock_appointments SET status = 'Delayed', updated_at = NOW() WHERE id = $1`, [input.appointmentId]);
      await createAuditLog(client, {
        actorUserId: user.id, companyId: appt.company_id,
        entityName: 'appointment_delays', entityId: id, action: 'create',
        newValue: { reason: input.reason, delayMinutes: input.delayMinutes }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),
  listAppointmentDelays: protectedProcedure.input(z.object({ appointmentId: z.string() })).query(async ({ ctx, input }) => {
    requireAuthUser(ctx.user);
    return queryRows(
      `SELECT id, appointment_id, reason, delay_minutes, actor_user_id, created_at
       FROM appointment_delays WHERE appointment_id = $1 ORDER BY created_at DESC`,
      [input.appointmentId],
    );
  }),
  generatePackingSlip: protectedProcedure.input(z.object({
    orderId: z.string(),
    lineQuantities: z.array(z.object({ orderItemId: z.string(), quantity: z.number().int().positive() })).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const order = await queryRow<{ provider_company_id: string; status: string }>(
      `SELECT provider_company_id, status FROM orders WHERE id = $1 AND deleted_at IS NULL`, [input.orderId],
    );
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && user.companyId !== order.provider_company_id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only provider can generate packing slips' });
    }
    const items = input.lineQuantities ?? (await queryRows<{ id: string; quantity: number }>(
      `SELECT id, quantity FROM order_items WHERE order_id = $1`, [input.orderId],
    )).map((row) => ({ orderItemId: row.id, quantity: row.quantity }));
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(`INSERT INTO packing_slips (id, order_id) VALUES ($1, $2)`, [id, input.orderId]);
      for (const it of items) {
        await client.query(
          `INSERT INTO packing_slip_items (id, packing_slip_id, order_item_id, quantity) VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), id, it.orderItemId, it.quantity],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: order.provider_company_id,
        entityName: 'packing_slips', entityId: id, action: 'create',
        newValue: { orderId: input.orderId, items: items.length }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),
  getPackingSlip: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    requireAuthUser(ctx.user);
    const slip = await queryRow(
      `SELECT ps.id, ps.order_id, ps.file_id, ps.created_at,
              (SELECT json_agg(row_to_json(psi)) FROM packing_slip_items psi WHERE psi.packing_slip_id = ps.id) AS items
       FROM packing_slips ps WHERE ps.id = $1`,
      [input.id],
    );
    if (!slip) throw new TRPCError({ code: 'NOT_FOUND', message: 'Packing slip not found' });
    return slip;
  }),
  splitOrder: protectedProcedure.input(z.object({
    orderId: z.string(),
    items: z.array(z.object({ orderItemId: z.string(), quantity: z.number().int().positive() })).min(1),
    reference: z.string().min(1).max(80),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const order = await queryRow<{ id: string; booking_id: string; customer_company_id: string; provider_company_id: string; status: string; ship_to: string; notes: string }>(
      `SELECT id, booking_id, customer_company_id, provider_company_id, status, ship_to, notes FROM orders WHERE id = $1 AND deleted_at IS NULL`,
      [input.orderId],
    );
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && user.companyId !== order.provider_company_id && user.companyId !== order.customer_company_id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    if (order.status !== 'Pending') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Order can only be split while Pending' });
    const newOrderId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO orders (id, booking_id, customer_company_id, provider_company_id, reference, status, ship_to, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'Pending', $6, $7, $8)`,
        [newOrderId, order.booking_id, order.customer_company_id, order.provider_company_id, input.reference, order.ship_to, order.notes, user.id],
      );
      for (const it of input.items) {
        const oi = await client.query<{ id: string; inventory_item_id: string; sku: string; description: string; quantity: number }>(
          `SELECT id, inventory_item_id, sku, description, quantity FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE`,
          [it.orderItemId, input.orderId],
        );
        const row = oi.rows[0];
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Order item ${it.orderItemId} not found` });
        if (row.quantity < it.quantity) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Split quantity exceeds line for ${row.sku}` });
        await client.query(
          `INSERT INTO order_items (id, order_id, inventory_item_id, sku, description, quantity) VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), newOrderId, row.inventory_item_id, row.sku, row.description, it.quantity],
        );
        const remaining = row.quantity - it.quantity;
        if (remaining === 0) {
          await client.query(`DELETE FROM order_items WHERE id = $1`, [row.id]);
        } else {
          await client.query(`UPDATE order_items SET quantity = $1 WHERE id = $2`, [remaining, row.id]);
        }
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: order.provider_company_id,
        entityName: 'orders', entityId: newOrderId, action: 'split',
        newValue: { sourceOrderId: input.orderId, reference: input.reference }, requestId: ctx.requestId,
      });
    });
    return { id: newOrderId };
  }),

  generateBackorder: protectedProcedure.input(z.object({
    orderId: z.string(),
    shortages: z.array(z.object({ orderItemId: z.string(), shortQuantity: z.number().int().positive() })).min(1),
    reference: z.string().max(80).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const order = await queryRow<{ id: string; booking_id: string; customer_company_id: string; provider_company_id: string; reference: string; ship_to: string; notes: string }>(
      `SELECT id, booking_id, customer_company_id, provider_company_id, reference, ship_to, notes FROM orders WHERE id = $1 AND deleted_at IS NULL`,
      [input.orderId],
    );
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && user.companyId !== order.provider_company_id && user.companyId !== order.customer_company_id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    const backorderId = crypto.randomUUID();
    const reference = input.reference ?? `${order.reference}-BO`;
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO orders (id, booking_id, customer_company_id, provider_company_id, reference, status, ship_to, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'Pending', $6, $7, $8)`,
        [backorderId, order.booking_id, order.customer_company_id, order.provider_company_id, reference, order.ship_to, `Backorder of ${order.reference}. ${order.notes}`.trim(), user.id],
      );
      for (const s of input.shortages) {
        const src = await client.query<{ inventory_item_id: string; sku: string; description: string }>(
          `SELECT inventory_item_id, sku, description FROM order_items WHERE id = $1 AND order_id = $2`,
          [s.orderItemId, input.orderId],
        );
        const row = src.rows[0];
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Order item ${s.orderItemId} not found` });
        await client.query(
          `INSERT INTO order_items (id, order_id, inventory_item_id, sku, description, quantity) VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), backorderId, row.inventory_item_id, row.sku, row.description, s.shortQuantity],
        );
      }
      await client.query(
        `INSERT INTO order_status_history (id, order_id, actor_user_id, previous_status, new_status, note)
         VALUES ($1, $2, $3, NULL, 'Pending', $4)`,
        [crypto.randomUUID(), backorderId, user.id, `Backorder generated from ${order.reference}`],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: order.provider_company_id,
        entityName: 'orders', entityId: backorderId, action: 'backorder',
        newValue: { sourceOrderId: input.orderId, reference, shortages: input.shortages.length }, requestId: ctx.requestId,
      });
    });
    return { id: backorderId, reference };
  }),
});
