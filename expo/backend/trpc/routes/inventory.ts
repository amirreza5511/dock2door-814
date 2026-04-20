import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser, type SessionUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';

interface ProductRow {
  id: string;
  company_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface VariantRow {
  id: string;
  product_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  weight_grams: number | null;
  length_cm: string | null;
  width_cm: string | null;
  height_cm: string | null;
}

interface BinRow {
  id: string;
  warehouse_listing_id: string;
  code: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
}

interface StockLevelRow {
  id: string;
  inventory_item_id: string;
  bin_location_id: string | null;
  on_hand: number;
  allocated: number;
  damaged: number;
  quarantined: number;
  updated_at: string;
}

interface StockMovementRow {
  id: string;
  inventory_item_id: string;
  kind: string;
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  actor_user_id: string | null;
  note: string | null;
  created_at: string;
}

function assertCompanyAccess(user: SessionUser, companyId: string): void {
  if (user.role === 'Admin' || user.role === 'SuperAdmin') return;
  if (user.companyId !== companyId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant access denied' });
  }
}

async function assertWarehouseAccess(user: SessionUser, warehouseListingId: string): Promise<void> {
  if (user.role === 'Admin' || user.role === 'SuperAdmin') return;
  const row = await queryRow<{ company_id: string }>(
    `SELECT company_id FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`,
    [warehouseListingId],
  );
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
  if (row.company_id !== user.companyId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant access denied' });
  }
}

export const inventoryRouter = createTRPCRouter({
  listProducts: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId && user.role !== 'Admin' && user.role !== 'SuperAdmin') return [];
    if (user.role === 'Admin' || user.role === 'SuperAdmin') {
      return queryRows<ProductRow>(
        `SELECT id, company_id, name, description, created_at, updated_at
         FROM products WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`, [],
      );
    }
    return queryRows<ProductRow>(
      `SELECT id, company_id, name, description, created_at, updated_at
       FROM products WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [user.companyId],
    );
  }),

  createProduct: protectedProcedure.input(z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).default(''),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Company context required' });
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO products (id, company_id, name, description) VALUES ($1, $2, $3, $4)`,
        [id, user.companyId, input.name, input.description],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'products', entityId: id, action: 'create',
        newValue: { name: input.name }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  updateProduct: protectedProcedure.input(z.object({
    id: z.string(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const product = await queryRow<ProductRow>(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [input.id]);
    if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    assertCompanyAccess(user, product.company_id);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE products SET name = COALESCE($1, name), description = COALESCE($2, description), updated_at = NOW() WHERE id = $3`,
        [input.name ?? null, input.description ?? null, input.id],
      );
    });
    return { success: true };
  }),

  archiveProduct: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const product = await queryRow<ProductRow>(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [input.id]);
    if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    assertCompanyAccess(user, product.company_id);
    await withTransaction(async (client) => {
      await client.query(`UPDATE products SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [input.id]);
    });
    return { success: true };
  }),

  listVariants: protectedProcedure.input(z.object({ productId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const product = await queryRow<ProductRow>(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [input.productId]);
    if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    assertCompanyAccess(user, product.company_id);
    return queryRows<VariantRow>(
      `SELECT id, product_id, sku, barcode, name, weight_grams,
              length_cm::text AS length_cm, width_cm::text AS width_cm, height_cm::text AS height_cm
       FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL ORDER BY sku ASC`,
      [input.productId],
    );
  }),

  upsertVariant: protectedProcedure.input(z.object({
    id: z.string().optional(),
    productId: z.string(),
    sku: z.string().min(1).max(80),
    barcode: z.string().max(80).nullable().optional(),
    name: z.string().max(200).default(''),
    weightGrams: z.number().int().nonnegative().nullable().optional(),
    lengthCm: z.number().nonnegative().nullable().optional(),
    widthCm: z.number().nonnegative().nullable().optional(),
    heightCm: z.number().nonnegative().nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const product = await queryRow<ProductRow>(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [input.productId]);
    if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    assertCompanyAccess(user, product.company_id);
    const id = input.id ?? crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO product_variants (id, product_id, sku, barcode, name, weight_grams, length_cm, width_cm, height_cm)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (product_id, sku) DO UPDATE SET
           barcode = EXCLUDED.barcode, name = EXCLUDED.name,
           weight_grams = EXCLUDED.weight_grams, length_cm = EXCLUDED.length_cm,
           width_cm = EXCLUDED.width_cm, height_cm = EXCLUDED.height_cm,
           updated_at = NOW()`,
        [id, input.productId, input.sku, input.barcode ?? null, input.name, input.weightGrams ?? null, input.lengthCm ?? null, input.widthCm ?? null, input.heightCm ?? null],
      );
    });
    return { id };
  }),

  listBinLocations: protectedProcedure.input(z.object({ warehouseListingId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await assertWarehouseAccess(user, input.warehouseListingId);
    return queryRows<BinRow>(
      `SELECT id, warehouse_listing_id, code, zone, aisle, rack, shelf, bin
       FROM bin_locations WHERE warehouse_listing_id = $1 AND deleted_at IS NULL ORDER BY code ASC`,
      [input.warehouseListingId],
    );
  }),

  createBinLocation: protectedProcedure.input(z.object({
    warehouseListingId: z.string(),
    code: z.string().min(1).max(40),
    zone: z.string().max(40).nullable().optional(),
    aisle: z.string().max(40).nullable().optional(),
    rack: z.string().max(40).nullable().optional(),
    shelf: z.string().max(40).nullable().optional(),
    bin: z.string().max(40).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await assertWarehouseAccess(user, input.warehouseListingId);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO bin_locations (id, warehouse_listing_id, code, zone, aisle, rack, shelf, bin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, input.warehouseListingId, input.code, input.zone ?? null, input.aisle ?? null, input.rack ?? null, input.shelf ?? null, input.bin ?? null],
      );
    });
    return { id };
  }),

  getStockLevel: protectedProcedure.input(z.object({ inventoryItemId: z.string() })).query(async ({ ctx, input }) => {
    requireAuthUser(ctx.user);
    const rows = await queryRows<StockLevelRow>(
      `SELECT id, inventory_item_id, bin_location_id, on_hand, allocated, damaged, quarantined, updated_at
       FROM stock_levels WHERE inventory_item_id = $1`,
      [input.inventoryItemId],
    );
    const totals = rows.reduce(
      (acc, r) => ({
        onHand: acc.onHand + r.on_hand,
        allocated: acc.allocated + r.allocated,
        damaged: acc.damaged + r.damaged,
        quarantined: acc.quarantined + r.quarantined,
      }),
      { onHand: 0, allocated: 0, damaged: 0, quarantined: 0 },
    );
    return { rows, totals, available: totals.onHand - totals.allocated - totals.damaged - totals.quarantined };
  }),

  recordMovement: protectedProcedure.input(z.object({
    inventoryItemId: z.string(),
    kind: z.enum(['Receipt', 'Adjustment', 'Pick', 'Pack', 'Ship', 'Return', 'Transfer', 'Hold', 'Release', 'CycleCount']),
    quantity: z.number().int(),
    binLocationId: z.string().nullable().optional(),
    referenceType: z.string().max(40).nullable().optional(),
    referenceId: z.string().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const inventory = await queryRow<{ customer_company_id: string }>(
      `SELECT customer_company_id FROM inventory_items WHERE id = $1 AND deleted_at IS NULL`,
      [input.inventoryItemId],
    );
    if (!inventory) throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory item not found' });
    assertCompanyAccess(user, inventory.customer_company_id);

    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO stock_movements (id, inventory_item_id, kind, quantity, reference_type, reference_id, actor_user_id, note)
         VALUES ($1, $2, $3::stock_movement_kind, $4, $5, $6, $7, $8)`,
        [id, input.inventoryItemId, input.kind, input.quantity, input.referenceType ?? null, input.referenceId ?? null, user.id, input.note ?? null],
      );

      const levelResult = await client.query<{ id: string; on_hand: number; allocated: number }>(
        `SELECT id, on_hand, allocated FROM stock_levels
         WHERE inventory_item_id = $1 AND (bin_location_id IS NOT DISTINCT FROM $2)
         FOR UPDATE`,
        [input.inventoryItemId, input.binLocationId ?? null],
      );
      const existing = levelResult.rows[0];
      const onHandDelta = ['Receipt', 'Return', 'Release'].includes(input.kind)
        ? input.quantity
        : ['Adjustment', 'Transfer', 'CycleCount'].includes(input.kind)
          ? input.quantity
          : ['Pick', 'Pack', 'Ship', 'Hold'].includes(input.kind)
            ? -input.quantity
            : 0;
      if (existing) {
        await client.query(
          `UPDATE stock_levels SET on_hand = GREATEST(on_hand + $1, 0), updated_at = NOW() WHERE id = $2`,
          [onHandDelta, existing.id],
        );
      } else {
        await client.query(
          `INSERT INTO stock_levels (id, inventory_item_id, bin_location_id, on_hand) VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), input.inventoryItemId, input.binLocationId ?? null, Math.max(onHandDelta, 0)],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: inventory.customer_company_id,
        entityName: 'stock_movements', entityId: id, action: input.kind,
        newValue: { quantity: input.quantity, binLocationId: input.binLocationId ?? null },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  listMovements: protectedProcedure.input(z.object({ inventoryItemId: z.string(), limit: z.number().int().positive().max(200).default(50) })).query(async ({ ctx, input }) => {
    requireAuthUser(ctx.user);
    return queryRows<StockMovementRow>(
      `SELECT id, inventory_item_id, kind::text AS kind, quantity, reference_type, reference_id, actor_user_id, note, created_at
       FROM stock_movements WHERE inventory_item_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [input.inventoryItemId, input.limit],
    );
  }),

  adjustQuantity: protectedProcedure.input(z.object({
    inventoryItemId: z.string(),
    deltaQuantity: z.number().int(),
    reason: z.string().min(1).max(200),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const inventory = await queryRow<{ customer_company_id: string; quantity: number }>(
      `SELECT customer_company_id, quantity FROM inventory_items WHERE id = $1 AND deleted_at IS NULL`,
      [input.inventoryItemId],
    );
    if (!inventory) throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory item not found' });
    assertCompanyAccess(user, inventory.customer_company_id);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO inventory_adjustments (id, inventory_item_id, actor_user_id, delta_quantity, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, input.inventoryItemId, user.id, input.deltaQuantity, input.reason],
      );
      await client.query(
        `UPDATE inventory_items SET quantity = GREATEST(quantity + $1, 0), updated_at = NOW() WHERE id = $2`,
        [input.deltaQuantity, input.inventoryItemId],
      );
      await client.query(
        `INSERT INTO stock_movements (id, inventory_item_id, kind, quantity, reference_type, reference_id, actor_user_id, note)
         VALUES ($1, $2, 'Adjustment'::stock_movement_kind, $3, 'inventory_adjustments', $1, $4, $5)`,
        [crypto.randomUUID(), input.inventoryItemId, input.deltaQuantity, user.id, input.reason],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: inventory.customer_company_id,
        entityName: 'inventory_adjustments', entityId: id, action: 'adjust',
        newValue: { delta: input.deltaQuantity, reason: input.reason }, requestId: ctx.requestId,
      });
    });
    return { id };
  }),
});
