import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser, type SessionUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';

interface InventoryItemRow {
  id: string;
  booking_id: string;
  customer_company_id: string;
  sku: string;
  quantity: number;
}

async function loadInventoryItem(id: string): Promise<InventoryItemRow> {
  const row = await queryRow<InventoryItemRow>(
    `SELECT id, booking_id, customer_company_id, sku, quantity FROM inventory_items WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory item not found' });
  return row;
}

function assertOwner(user: SessionUser, companyId: string): void {
  if (user.role === 'Admin' || user.role === 'SuperAdmin') return;
  if (user.companyId !== companyId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant access denied' });
  }
}

export const wmsRouter = createTRPCRouter({
  // Lots
  listLots: protectedProcedure.input(z.object({ inventoryItemId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const item = await loadInventoryItem(input.inventoryItemId);
    assertOwner(user, item.customer_company_id);
    return queryRows(
      `SELECT id, inventory_item_id, lot_number, expires_at::text AS expires_at, received_at, quantity
       FROM lots WHERE inventory_item_id = $1 ORDER BY received_at DESC`,
      [input.inventoryItemId],
    );
  }),
  createLot: protectedProcedure.input(z.object({
    inventoryItemId: z.string(),
    lotNumber: z.string().min(1).max(80),
    expiresAt: z.string().nullable().optional(),
    quantity: z.number().int().nonnegative(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const item = await loadInventoryItem(input.inventoryItemId);
    assertOwner(user, item.customer_company_id);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO lots (id, inventory_item_id, lot_number, expires_at, quantity)
         VALUES ($1, $2, $3, $4::date, $5)`,
        [id, input.inventoryItemId, input.lotNumber, input.expiresAt ?? null, input.quantity],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: item.customer_company_id,
        entityName: 'lots', entityId: id, action: 'create',
        newValue: { lotNumber: input.lotNumber, quantity: input.quantity }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  // Serials
  listSerials: protectedProcedure.input(z.object({ inventoryItemId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const item = await loadInventoryItem(input.inventoryItemId);
    assertOwner(user, item.customer_company_id);
    return queryRows(
      `SELECT id, inventory_item_id, serial_number, status, created_at
       FROM serials WHERE inventory_item_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [input.inventoryItemId],
    );
  }),
  addSerials: protectedProcedure.input(z.object({
    inventoryItemId: z.string(),
    serials: z.array(z.string().min(1).max(120)).min(1).max(500),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const item = await loadInventoryItem(input.inventoryItemId);
    assertOwner(user, item.customer_company_id);
    await withTransaction(async (client) => {
      for (const s of input.serials) {
        await client.query(
          `INSERT INTO serials (id, inventory_item_id, serial_number) VALUES ($1, $2, $3)
           ON CONFLICT (inventory_item_id, serial_number) DO NOTHING`,
          [crypto.randomUUID(), input.inventoryItemId, s],
        );
      }
    });
    return { success: true };
  }),

  // Holds / Quarantines
  listHolds: protectedProcedure.input(z.object({ inventoryItemId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const item = await loadInventoryItem(input.inventoryItemId);
    assertOwner(user, item.customer_company_id);
    return queryRows(
      `SELECT id, inventory_item_id, quantity, reason, status, actor_user_id, released_at, created_at
       FROM holds WHERE inventory_item_id = $1 ORDER BY created_at DESC`,
      [input.inventoryItemId],
    );
  }),
  placeHold: protectedProcedure.input(z.object({
    inventoryItemId: z.string(),
    quantity: z.number().int().positive(),
    reason: z.string().min(1).max(200),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const item = await loadInventoryItem(input.inventoryItemId);
    assertOwner(user, item.customer_company_id);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO holds (id, inventory_item_id, quantity, reason, actor_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, input.inventoryItemId, input.quantity, input.reason, user.id],
      );
      await client.query(
        `INSERT INTO stock_movements (id, inventory_item_id, kind, quantity, reference_type, reference_id, actor_user_id, note)
         VALUES ($1, $2, 'Hold'::stock_movement_kind, $3, 'holds', $1, $4, $5)`,
        [crypto.randomUUID(), input.inventoryItemId, input.quantity, user.id, input.reason],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: item.customer_company_id,
        entityName: 'holds', entityId: id, action: 'create',
        newValue: { quantity: input.quantity, reason: input.reason }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),
  releaseHold: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const hold = await queryRow<{ id: string; inventory_item_id: string; quantity: number; status: string }>(
      `SELECT id, inventory_item_id, quantity, status FROM holds WHERE id = $1`, [input.id],
    );
    if (!hold) throw new TRPCError({ code: 'NOT_FOUND', message: 'Hold not found' });
    if (hold.status !== 'Active') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Hold is not active' });
    const item = await loadInventoryItem(hold.inventory_item_id);
    assertOwner(user, item.customer_company_id);
    await withTransaction(async (client) => {
      await client.query(`UPDATE holds SET status = 'Released', released_at = NOW() WHERE id = $1`, [input.id]);
      await client.query(
        `INSERT INTO stock_movements (id, inventory_item_id, kind, quantity, reference_type, reference_id, actor_user_id)
         VALUES ($1, $2, 'Release'::stock_movement_kind, $3, 'holds', $4, $5)`,
        [crypto.randomUUID(), hold.inventory_item_id, hold.quantity, input.id, user.id],
      );
    });
    return { success: true };
  }),

  // ASNs
  createAsn: protectedProcedure.input(z.object({
    bookingId: z.string(),
    reference: z.string().min(1).max(120),
    expectedAt: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    items: z.array(z.object({
      sku: z.string().min(1).max(80),
      description: z.string().max(200).default(''),
      expectedQuantity: z.number().int().positive(),
    })).min(1),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await queryRow<{ company_id: string; provider_company_id: string | null }>(
      `SELECT company_id, provider_company_id FROM bookings WHERE id = $1 AND deleted_at IS NULL`,
      [input.bookingId],
    );
    if (!booking) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' });
    const isParticipant = user.companyId === booking.company_id || user.companyId === booking.provider_company_id || user.role === 'Admin' || user.role === 'SuperAdmin';
    if (!isParticipant) throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    if (!booking.provider_company_id) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Booking has no provider' });
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO asns (id, booking_id, customer_company_id, provider_company_id, reference, expected_at, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, input.bookingId, booking.company_id, booking.provider_company_id, input.reference, input.expectedAt ?? null, input.notes ?? null, user.id],
      );
      for (const it of input.items) {
        await client.query(
          `INSERT INTO asn_items (id, asn_id, sku, description, expected_quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [crypto.randomUUID(), id, it.sku, it.description, it.expectedQuantity],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: booking.company_id,
        entityName: 'asns', entityId: id, action: 'create',
        newValue: { reference: input.reference, items: input.items.length }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),
  listAsns: protectedProcedure.input(z.object({ bookingId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await queryRow<{ company_id: string; provider_company_id: string | null }>(
      `SELECT company_id, provider_company_id FROM bookings WHERE id = $1 AND deleted_at IS NULL`, [input.bookingId],
    );
    if (!booking) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' });
    const isParticipant = user.companyId === booking.company_id || user.companyId === booking.provider_company_id || user.role === 'Admin' || user.role === 'SuperAdmin';
    if (!isParticipant) throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    return queryRows(
      `SELECT a.id, a.reference, a.expected_at, a.status, a.notes, a.created_at,
              (SELECT json_agg(row_to_json(ai)) FROM asn_items ai WHERE ai.asn_id = a.id) AS items
       FROM asns a WHERE a.booking_id = $1 ORDER BY a.created_at DESC`,
      [input.bookingId],
    );
  }),

  // Receipts (receiving against ASN + auto stock movement)
  recordReceipt: protectedProcedure.input(z.object({
    bookingId: z.string(),
    asnId: z.string().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    items: z.array(z.object({
      inventoryItemId: z.string(),
      quantity: z.number().int().positive(),
      binLocationId: z.string().nullable().optional(),
      lotId: z.string().nullable().optional(),
    })).min(1),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await queryRow<{ company_id: string; provider_company_id: string | null }>(
      `SELECT company_id, provider_company_id FROM bookings WHERE id = $1 AND deleted_at IS NULL`, [input.bookingId],
    );
    if (!booking) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' });
    if (user.companyId !== booking.provider_company_id && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the warehouse provider can record receipts' });
    }
    const receiptId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO receipts (id, asn_id, booking_id, actor_user_id, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [receiptId, input.asnId ?? null, input.bookingId, user.id, input.notes ?? null],
      );
      for (const it of input.items) {
        await client.query(
          `INSERT INTO receipt_items (id, receipt_id, inventory_item_id, quantity, bin_location_id, lot_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), receiptId, it.inventoryItemId, it.quantity, it.binLocationId ?? null, it.lotId ?? null],
        );
        await client.query(
          `UPDATE inventory_items SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2`,
          [it.quantity, it.inventoryItemId],
        );
        await client.query(
          `INSERT INTO stock_movements (id, inventory_item_id, kind, quantity, reference_type, reference_id, actor_user_id)
           VALUES ($1, $2, 'Receipt'::stock_movement_kind, $3, 'receipts', $4, $5)`,
          [crypto.randomUUID(), it.inventoryItemId, it.quantity, receiptId, user.id],
        );
      }
      if (input.asnId) {
        await client.query(`UPDATE asns SET status = 'Received', updated_at = NOW() WHERE id = $1`, [input.asnId]);
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: booking.provider_company_id,
        entityName: 'receipts', entityId: receiptId, action: 'create',
        newValue: { items: input.items.length }, requestId: ctx.requestId,
      });
    });
    return { id: receiptId };
  }),

  // Cycle counts
  createCycleCount: protectedProcedure.input(z.object({
    warehouseListingId: z.string(),
    notes: z.string().max(2000).nullable().optional(),
    lines: z.array(z.object({
      inventoryItemId: z.string(),
      expectedQuantity: z.number().int().nonnegative(),
      countedQuantity: z.number().int().nonnegative(),
    })).min(1),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const warehouse = await queryRow<{ company_id: string }>(
      `SELECT company_id FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`,
      [input.warehouseListingId],
    );
    if (!warehouse) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    assertOwner(user, warehouse.company_id);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO cycle_counts (id, warehouse_listing_id, actor_user_id, status, notes, completed_at)
         VALUES ($1, $2, $3, 'Completed', $4, NOW())`,
        [id, input.warehouseListingId, user.id, input.notes ?? null],
      );
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO cycle_count_lines (id, cycle_count_id, inventory_item_id, expected_quantity, counted_quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [crypto.randomUUID(), id, line.inventoryItemId, line.expectedQuantity, line.countedQuantity],
        );
        const variance = line.countedQuantity - line.expectedQuantity;
        if (variance !== 0) {
          await client.query(
            `INSERT INTO inventory_adjustments (id, inventory_item_id, actor_user_id, delta_quantity, reason)
             VALUES ($1, $2, $3, $4, 'cycle_count')`,
            [crypto.randomUUID(), line.inventoryItemId, user.id, variance],
          );
          await client.query(
            `UPDATE inventory_items SET quantity = GREATEST(quantity + $1, 0), updated_at = NOW() WHERE id = $2`,
            [variance, line.inventoryItemId],
          );
          await client.query(
            `INSERT INTO stock_movements (id, inventory_item_id, kind, quantity, reference_type, reference_id, actor_user_id)
             VALUES ($1, $2, 'CycleCount'::stock_movement_kind, $3, 'cycle_counts', $4, $5)`,
            [crypto.randomUUID(), line.inventoryItemId, variance, id, user.id],
          );
        }
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: warehouse.company_id,
        entityName: 'cycle_counts', entityId: id, action: 'create',
        newValue: { lines: input.lines.length }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  // Kitting
  listKits: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId && user.role !== 'Admin' && user.role !== 'SuperAdmin') return [];
    const params = user.role === 'Admin' || user.role === 'SuperAdmin' ? [] : [user.companyId];
    const whereClause = user.role === 'Admin' || user.role === 'SuperAdmin' ? '' : 'WHERE k.company_id = $1';
    return queryRows(
      `SELECT k.id, k.company_id, k.sku, k.name, k.created_at,
              (SELECT json_agg(row_to_json(kc)) FROM kit_components kc WHERE kc.kit_id = k.id) AS components
       FROM kits k ${whereClause} ORDER BY k.created_at DESC`,
      params,
    );
  }),
  createKit: protectedProcedure.input(z.object({
    sku: z.string().min(1).max(80),
    name: z.string().min(1).max(200),
    components: z.array(z.object({
      componentSku: z.string().min(1).max(80),
      quantity: z.number().int().positive(),
    })).min(1),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Company context required' });
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO kits (id, company_id, sku, name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, sku) DO UPDATE SET name = EXCLUDED.name`,
        [id, user.companyId, input.sku, input.name],
      );
      await client.query(`DELETE FROM kit_components WHERE kit_id = $1`, [id]);
      for (const c of input.components) {
        await client.query(
          `INSERT INTO kit_components (id, kit_id, component_sku, quantity) VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), id, c.componentSku, c.quantity],
        );
      }
    });
    return { id };
  }),
});
