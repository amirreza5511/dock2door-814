import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, publicProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser, type SessionUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';

interface WarehouseListingRow {
  id: string;
  company_id: string;
  owner_user_id: string | null;
  name: string;
  address: string;
  city: string;
  warehouse_type: string;
  available_pallet_capacity: number;
  storage_rate_per_pallet: string;
  status: string;
  data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface MediaRow {
  id: string;
  warehouse_listing_id: string;
  url: string;
  kind: string;
  position: number;
}

interface PricingRow {
  id: string;
  warehouse_listing_id: string;
  unit: string;
  period: string;
  amount: string;
  currency: string;
  min_units: number;
  max_units: number | null;
}

interface OperatingHoursRow {
  id: string;
  warehouse_listing_id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

interface FeatureRow {
  id: string;
  warehouse_listing_id: string;
  feature_key: string;
  value: string | null;
}

function assertProviderAccess(user: SessionUser, listing: WarehouseListingRow): void {
  if (user.role === 'Admin' || user.role === 'SuperAdmin') return;
  if (user.companyId !== listing.company_id) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant access denied' });
  }
}

const searchSchema = z.object({
  query: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  warehouseType: z.enum(['Dry', 'Chill', 'Frozen']).optional(),
  minPallets: z.number().int().positive().optional(),
  maxRatePerPallet: z.number().positive().optional(),
  verifiedOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(100).default(50),
});

const listingStatusEnum = z.enum(['Draft', 'PendingApproval', 'Available', 'Hidden', 'Suspended', 'Archived']);

export const warehousesRouter = createTRPCRouter({
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId && user.role !== 'Admin' && user.role !== 'SuperAdmin') return [];
    const rows = await queryRows<WarehouseListingRow>(
      user.role === 'Admin' || user.role === 'SuperAdmin'
        ? `SELECT id, company_id, owner_user_id, name, address, city, warehouse_type,
                  available_pallet_capacity,
                  storage_rate_per_pallet::text AS storage_rate_per_pallet,
                  status::text AS status, data, created_at, updated_at
           FROM warehouse_listings WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`
        : `SELECT id, company_id, owner_user_id, name, address, city, warehouse_type,
                  available_pallet_capacity,
                  storage_rate_per_pallet::text AS storage_rate_per_pallet,
                  status::text AS status, data, created_at, updated_at
           FROM warehouse_listings WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      user.role === 'Admin' || user.role === 'SuperAdmin' ? [] : [user.companyId],
    );
    return rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      ownerUserId: r.owner_user_id,
      name: r.name,
      address: r.address,
      city: r.city,
      warehouseType: r.warehouse_type,
      availablePalletCapacity: r.available_pallet_capacity,
      storageRatePerPallet: Number(r.storage_rate_per_pallet),
      status: r.status,
      data: r.data ?? {},
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }),

  createListing: protectedProcedure.input(z.object({
    name: z.string().min(1).max(200),
    address: z.string().min(1).max(400),
    city: z.string().min(1).max(80),
    warehouseType: z.enum(['Dry', 'Chill', 'Frozen']),
    availablePalletCapacity: z.number().int().nonnegative(),
    storageRatePerPallet: z.number().nonnegative(),
    minPallets: z.number().int().nonnegative().optional(),
    maxPallets: z.number().int().positive().optional(),
    storageTerm: z.enum(['Daily', 'Weekly', 'Monthly']).default('Monthly'),
    inboundHandlingFeePerPallet: z.number().nonnegative().default(0),
    outboundHandlingFeePerPallet: z.number().nonnegative().default(0),
    receivingHours: z.string().max(200).default(''),
    accessRestrictions: z.string().max(400).default(''),
    insuranceRequirements: z.string().max(400).default(''),
    notes: z.string().max(2000).default(''),
    status: listingStatusEnum.default('Draft'),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Company context required' });
    if (input.status === 'Available' && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can publish directly' });
    }
    const id = crypto.randomUUID();
    const data = {
      minPallets: input.minPallets ?? 0,
      maxPallets: input.maxPallets ?? input.availablePalletCapacity,
      storageTerm: input.storageTerm,
      inboundHandlingFeePerPallet: input.inboundHandlingFeePerPallet,
      outboundHandlingFeePerPallet: input.outboundHandlingFeePerPallet,
      receivingHours: input.receivingHours,
      accessRestrictions: input.accessRestrictions,
      insuranceRequirements: input.insuranceRequirements,
      notes: input.notes,
    };
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO warehouse_listings (id, company_id, owner_user_id, name, address, city, warehouse_type, available_pallet_capacity, storage_rate_per_pallet, status, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::listing_status, $11::jsonb)`,
        [id, user.companyId, user.id, input.name, input.address, input.city, input.warehouseType, input.availablePalletCapacity, input.storageRatePerPallet, input.status, JSON.stringify(data)],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'warehouse_listings', entityId: id, action: 'create',
        newValue: { name: input.name, city: input.city, status: input.status },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  updateListing: protectedProcedure.input(z.object({
    id: z.string(),
    name: z.string().min(1).max(200).optional(),
    address: z.string().min(1).max(400).optional(),
    city: z.string().min(1).max(80).optional(),
    warehouseType: z.enum(['Dry', 'Chill', 'Frozen']).optional(),
    availablePalletCapacity: z.number().int().nonnegative().optional(),
    storageRatePerPallet: z.number().nonnegative().optional(),
    minPallets: z.number().int().nonnegative().optional(),
    maxPallets: z.number().int().positive().optional(),
    inboundHandlingFeePerPallet: z.number().nonnegative().optional(),
    outboundHandlingFeePerPallet: z.number().nonnegative().optional(),
    receivingHours: z.string().max(200).optional(),
    accessRestrictions: z.string().max(400).optional(),
    insuranceRequirements: z.string().max(400).optional(),
    notes: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<WarehouseListingRow>(`SELECT * FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`, [input.id]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    assertProviderAccess(user, listing);
    const prevData = (listing.data ?? {}) as Record<string, unknown>;
    const nextData = {
      ...prevData,
      ...(input.minPallets !== undefined ? { minPallets: input.minPallets } : {}),
      ...(input.maxPallets !== undefined ? { maxPallets: input.maxPallets } : {}),
      ...(input.inboundHandlingFeePerPallet !== undefined ? { inboundHandlingFeePerPallet: input.inboundHandlingFeePerPallet } : {}),
      ...(input.outboundHandlingFeePerPallet !== undefined ? { outboundHandlingFeePerPallet: input.outboundHandlingFeePerPallet } : {}),
      ...(input.receivingHours !== undefined ? { receivingHours: input.receivingHours } : {}),
      ...(input.accessRestrictions !== undefined ? { accessRestrictions: input.accessRestrictions } : {}),
      ...(input.insuranceRequirements !== undefined ? { insuranceRequirements: input.insuranceRequirements } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE warehouse_listings SET
           name = COALESCE($1, name),
           address = COALESCE($2, address),
           city = COALESCE($3, city),
           warehouse_type = COALESCE($4, warehouse_type),
           available_pallet_capacity = COALESCE($5, available_pallet_capacity),
           storage_rate_per_pallet = COALESCE($6, storage_rate_per_pallet),
           data = $7::jsonb,
           updated_at = NOW()
         WHERE id = $8`,
        [
          input.name ?? null,
          input.address ?? null,
          input.city ?? null,
          input.warehouseType ?? null,
          input.availablePalletCapacity ?? null,
          input.storageRatePerPallet ?? null,
          JSON.stringify(nextData),
          input.id,
        ],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'warehouse_listings', entityId: input.id, action: 'update',
        newValue: { changed: Object.keys(input).filter((k) => k !== 'id') },
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  search: publicProcedure.input(searchSchema).query(async ({ input }) => {
    const clauses: string[] = [`wl.status = 'Available'`, `wl.deleted_at IS NULL`];
    const params: unknown[] = [];
    if (input.query) {
      params.push(`%${input.query}%`);
      clauses.push(`(wl.name ILIKE $${params.length} OR wl.city ILIKE $${params.length} OR wl.address ILIKE $${params.length})`);
    }
    if (input.city) { params.push(input.city); clauses.push(`wl.city ILIKE $${params.length}`); }
    if (input.warehouseType) { params.push(input.warehouseType); clauses.push(`wl.warehouse_type = $${params.length}`); }
    if (input.minPallets) { params.push(input.minPallets); clauses.push(`wl.available_pallet_capacity >= $${params.length}`); }
    if (input.maxRatePerPallet) { params.push(input.maxRatePerPallet); clauses.push(`wl.storage_rate_per_pallet <= $${params.length}`); }
    if (input.verifiedOnly) { clauses.push(`c.status = 'Approved'`); }
    params.push(input.limit);
    const rows = await queryRows<WarehouseListingRow & { company_name: string; company_status: string }>(
      `SELECT wl.id, wl.company_id, wl.owner_user_id, wl.name, wl.address, wl.city,
              wl.warehouse_type, wl.available_pallet_capacity,
              wl.storage_rate_per_pallet::text AS storage_rate_per_pallet,
              wl.status::text AS status, wl.data, wl.created_at, wl.updated_at,
              c.name AS company_name, c.status::text AS company_status
       FROM warehouse_listings wl
       INNER JOIN companies c ON c.id = wl.company_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY wl.storage_rate_per_pallet ASC
       LIMIT $${params.length}`,
      params,
    );
    const listingIds = rows.map((r) => r.id);
    const mediaMap = new Map<string, MediaRow[]>();
    if (listingIds.length > 0) {
      const media = await queryRows<MediaRow>(
        `SELECT id, warehouse_listing_id, url, kind, position
         FROM warehouse_media
         WHERE warehouse_listing_id = ANY($1::text[]) AND deleted_at IS NULL
         ORDER BY position ASC`,
        [listingIds],
      );
      for (const m of media) {
        const arr = mediaMap.get(m.warehouse_listing_id) ?? [];
        arr.push(m);
        mediaMap.set(m.warehouse_listing_id, arr);
      }
    }
    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      companyVerified: row.company_status === 'Approved',
      name: row.name,
      address: row.address,
      city: row.city,
      warehouseType: row.warehouse_type,
      availablePalletCapacity: row.available_pallet_capacity,
      storageRatePerPallet: Number(row.storage_rate_per_pallet),
      status: row.status,
      media: mediaMap.get(row.id) ?? [],
    }));
  }),

  getDetail: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const listing = await queryRow<WarehouseListingRow>(
      `SELECT id, company_id, owner_user_id, name, address, city,
              warehouse_type, available_pallet_capacity,
              storage_rate_per_pallet::text AS storage_rate_per_pallet,
              status::text AS status, data, created_at, updated_at
       FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`,
      [input.id],
    );
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    const [media, pricing, hours, features, capacity] = await Promise.all([
      queryRows<MediaRow>(`SELECT id, warehouse_listing_id, url, kind, position FROM warehouse_media WHERE warehouse_listing_id = $1 AND deleted_at IS NULL ORDER BY position ASC`, [input.id]),
      queryRows<PricingRow>(`SELECT id, warehouse_listing_id, unit, period, amount::text AS amount, currency, min_units, max_units FROM warehouse_pricing WHERE warehouse_listing_id = $1 AND deleted_at IS NULL ORDER BY min_units ASC`, [input.id]),
      queryRows<OperatingHoursRow>(`SELECT id, warehouse_listing_id, day_of_week, open_time::text AS open_time, close_time::text AS close_time, is_closed FROM warehouse_operating_hours WHERE warehouse_listing_id = $1 ORDER BY day_of_week ASC`, [input.id]),
      queryRows<FeatureRow>(`SELECT id, warehouse_listing_id, feature_key, value FROM warehouse_features WHERE warehouse_listing_id = $1`, [input.id]),
      queryRows(`SELECT id, segment_type, total_capacity, used_capacity, data, updated_at FROM warehouse_capacity_segments WHERE warehouse_listing_id = $1`, [input.id]),
    ]);
    return { listing, media, pricing, hours, features, capacity };
  }),

  addMedia: protectedProcedure.input(z.object({
    warehouseListingId: z.string(),
    url: z.string().url(),
    kind: z.enum(['image', 'document']).default('image'),
    position: z.number().int().nonnegative().default(0),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<WarehouseListingRow>(`SELECT * FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`, [input.warehouseListingId]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    assertProviderAccess(user, listing);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO warehouse_media (id, warehouse_listing_id, url, kind, position) VALUES ($1, $2, $3, $4, $5)`,
        [id, input.warehouseListingId, input.url, input.kind, input.position],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'warehouse_media', entityId: id, action: 'create',
        newValue: { url: input.url, kind: input.kind },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  removeMedia: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const media = await queryRow<{ id: string; warehouse_listing_id: string; company_id: string }>(
      `SELECT wm.id, wm.warehouse_listing_id, wl.company_id
       FROM warehouse_media wm INNER JOIN warehouse_listings wl ON wl.id = wm.warehouse_listing_id
       WHERE wm.id = $1 AND wm.deleted_at IS NULL`, [input.id],
    );
    if (!media) throw new TRPCError({ code: 'NOT_FOUND', message: 'Media not found' });
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && user.companyId !== media.company_id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant access denied' });
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE warehouse_media SET deleted_at = NOW() WHERE id = $1`, [input.id]);
      await createAuditLog(client, {
        actorUserId: user.id, companyId: media.company_id,
        entityName: 'warehouse_media', entityId: input.id, action: 'remove',
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  upsertPricing: protectedProcedure.input(z.object({
    warehouseListingId: z.string(),
    tiers: z.array(z.object({
      id: z.string().optional(),
      unit: z.string().min(1).max(40),
      period: z.string().min(1).max(40),
      amount: z.number().positive(),
      currency: z.string().default('cad'),
      minUnits: z.number().int().nonnegative().default(0),
      maxUnits: z.number().int().positive().nullable().optional(),
    })).min(1),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<WarehouseListingRow>(`SELECT * FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`, [input.warehouseListingId]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    assertProviderAccess(user, listing);
    await withTransaction(async (client) => {
      await client.query(`UPDATE warehouse_pricing SET deleted_at = NOW() WHERE warehouse_listing_id = $1 AND deleted_at IS NULL`, [input.warehouseListingId]);
      for (const tier of input.tiers) {
        await client.query(
          `INSERT INTO warehouse_pricing (id, warehouse_listing_id, unit, period, amount, currency, min_units, max_units)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [crypto.randomUUID(), input.warehouseListingId, tier.unit, tier.period, tier.amount, tier.currency, tier.minUnits, tier.maxUnits ?? null],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'warehouse_pricing', entityId: input.warehouseListingId, action: 'upsert',
        newValue: { tiers: input.tiers.length },
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  setOperatingHours: protectedProcedure.input(z.object({
    warehouseListingId: z.string(),
    hours: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      openTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      closeTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      isClosed: z.boolean().default(false),
    })).length(7),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<WarehouseListingRow>(`SELECT * FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`, [input.warehouseListingId]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    assertProviderAccess(user, listing);
    await withTransaction(async (client) => {
      for (const h of input.hours) {
        await client.query(
          `INSERT INTO warehouse_operating_hours (id, warehouse_listing_id, day_of_week, open_time, close_time, is_closed)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (warehouse_listing_id, day_of_week) DO UPDATE SET
             open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time, is_closed = EXCLUDED.is_closed`,
          [crypto.randomUUID(), input.warehouseListingId, h.dayOfWeek, h.openTime, h.closeTime, h.isClosed],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'warehouse_operating_hours', entityId: input.warehouseListingId, action: 'update',
        newValue: { hours: input.hours },
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  setFeatures: protectedProcedure.input(z.object({
    warehouseListingId: z.string(),
    features: z.array(z.object({ key: z.string().min(1).max(40), value: z.string().max(200).nullable() })),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<WarehouseListingRow>(`SELECT * FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`, [input.warehouseListingId]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    assertProviderAccess(user, listing);
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM warehouse_features WHERE warehouse_listing_id = $1`, [input.warehouseListingId]);
      for (const f of input.features) {
        await client.query(
          `INSERT INTO warehouse_features (id, warehouse_listing_id, feature_key, value) VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), input.warehouseListingId, f.key, f.value],
        );
      }
    });
    return { success: true };
  }),

  setListingStatus: protectedProcedure.input(z.object({
    id: z.string(),
    status: z.enum(['Draft', 'PendingApproval', 'Available', 'Hidden', 'Suspended', 'Archived']),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<WarehouseListingRow>(`SELECT * FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`, [input.id]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    assertProviderAccess(user, listing);
    if ((input.status === 'Suspended' || input.status === 'PendingApproval') && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can use that status' });
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE warehouse_listings SET status = $1::listing_status, updated_at = NOW() WHERE id = $2`, [input.status, input.id]);
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'warehouse_listings', entityId: input.id, action: 'set_status',
        previousValue: { status: listing.status }, newValue: { status: input.status },
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  duplicate: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<WarehouseListingRow>(`SELECT * FROM warehouse_listings WHERE id = $1 AND deleted_at IS NULL`, [input.id]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    assertProviderAccess(user, listing);
    const newId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO warehouse_listings (id, company_id, owner_user_id, name, address, city, warehouse_type, available_pallet_capacity, storage_rate_per_pallet, status, data)
         SELECT $1, company_id, owner_user_id, name || ' (Copy)', address, city, warehouse_type, available_pallet_capacity, storage_rate_per_pallet, 'Draft'::listing_status, data
         FROM warehouse_listings WHERE id = $2`,
        [newId, input.id],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'warehouse_listings', entityId: newId, action: 'duplicate',
        newValue: { source: input.id },
        requestId: ctx.requestId,
      });
    });
    return { id: newId };
  }),
});
