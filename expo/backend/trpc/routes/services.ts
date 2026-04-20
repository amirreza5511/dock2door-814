import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, publicProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser, type SessionUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';

interface ServiceListingRow {
  id: string;
  company_id: string;
  owner_user_id: string | null;
  category: string;
  city: string;
  hourly_rate: string;
  status: string;
  data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface ServiceAreaRow {
  id: string;
  service_listing_id: string;
  city: string;
  province: string | null;
  radius_km: number | null;
}

interface ServicePricingRow {
  id: string;
  service_listing_id: string;
  unit: string;
  amount: string;
  currency: string;
  minimum_charge: string;
}

function assertProviderAccess(user: SessionUser, listing: ServiceListingRow): void {
  if (user.role === 'Admin' || user.role === 'SuperAdmin') return;
  if (user.companyId !== listing.company_id) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant access denied' });
  }
}

export const servicesRouter = createTRPCRouter({
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId && user.role !== 'Admin' && user.role !== 'SuperAdmin') return [];
    const rows = await queryRows<ServiceListingRow>(
      user.role === 'Admin' || user.role === 'SuperAdmin'
        ? `SELECT id, company_id, owner_user_id, category, city,
                  hourly_rate::text AS hourly_rate, status::text AS status,
                  data, created_at, updated_at
           FROM service_listings WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`
        : `SELECT id, company_id, owner_user_id, category, city,
                  hourly_rate::text AS hourly_rate, status::text AS status,
                  data, created_at, updated_at
           FROM service_listings WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      user.role === 'Admin' || user.role === 'SuperAdmin' ? [] : [user.companyId],
    );
    return rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      category: r.category,
      city: r.city,
      hourlyRate: Number(r.hourly_rate),
      status: r.status,
      data: r.data ?? {},
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }),

  createListing: protectedProcedure.input(z.object({
    category: z.string().min(1).max(80),
    city: z.string().min(1).max(80),
    hourlyRate: z.number().nonnegative(),
    perJobRate: z.number().nonnegative().nullable().optional(),
    minimumHours: z.number().int().nonnegative().default(1),
    certifications: z.string().max(2000).default(''),
    coverageArea: z.array(z.string().min(1).max(80)).default([]),
    description: z.string().max(2000).default(''),
    status: z.enum(['Draft', 'PendingApproval', 'Available', 'Hidden']).default('Draft'),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Company context required' });
    if (input.status === 'Available' && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can publish directly' });
    }
    const id = crypto.randomUUID();
    const data = {
      perJobRate: input.perJobRate ?? null,
      minimumHours: input.minimumHours,
      certifications: input.certifications,
      coverageArea: input.coverageArea,
      description: input.description,
    };
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO service_listings (id, company_id, owner_user_id, category, city, hourly_rate, status, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7::listing_status, $8::jsonb)`,
        [id, user.companyId, user.id, input.category, input.city, input.hourlyRate, input.status, JSON.stringify(data)],
      );
      for (const city of input.coverageArea) {
        await client.query(
          `INSERT INTO service_areas (id, service_listing_id, city, province, radius_km) VALUES ($1, $2, $3, NULL, NULL)`,
          [crypto.randomUUID(), id, city],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'service_listings', entityId: id, action: 'create',
        newValue: { category: input.category, city: input.city, status: input.status },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  updateListing: protectedProcedure.input(z.object({
    id: z.string(),
    category: z.string().min(1).max(80).optional(),
    city: z.string().min(1).max(80).optional(),
    hourlyRate: z.number().nonnegative().optional(),
    perJobRate: z.number().nonnegative().nullable().optional(),
    minimumHours: z.number().int().nonnegative().optional(),
    certifications: z.string().max(2000).optional(),
    coverageArea: z.array(z.string().min(1).max(80)).optional(),
    description: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<ServiceListingRow>(`SELECT * FROM service_listings WHERE id = $1 AND deleted_at IS NULL`, [input.id]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service listing not found' });
    assertProviderAccess(user, listing);
    const prevData = (listing.data ?? {}) as Record<string, unknown>;
    const nextData = {
      ...prevData,
      ...(input.perJobRate !== undefined ? { perJobRate: input.perJobRate } : {}),
      ...(input.minimumHours !== undefined ? { minimumHours: input.minimumHours } : {}),
      ...(input.certifications !== undefined ? { certifications: input.certifications } : {}),
      ...(input.coverageArea !== undefined ? { coverageArea: input.coverageArea } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    };
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE service_listings SET
           category = COALESCE($1, category),
           city = COALESCE($2, city),
           hourly_rate = COALESCE($3, hourly_rate),
           data = $4::jsonb,
           updated_at = NOW()
         WHERE id = $5`,
        [input.category ?? null, input.city ?? null, input.hourlyRate ?? null, JSON.stringify(nextData), input.id],
      );
      if (input.coverageArea) {
        await client.query(`DELETE FROM service_areas WHERE service_listing_id = $1`, [input.id]);
        for (const city of input.coverageArea) {
          await client.query(
            `INSERT INTO service_areas (id, service_listing_id, city, province, radius_km) VALUES ($1, $2, $3, NULL, NULL)`,
            [crypto.randomUUID(), input.id, city],
          );
        }
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'service_listings', entityId: input.id, action: 'update',
        newValue: { changed: Object.keys(input).filter((k) => k !== 'id') },
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  search: publicProcedure.input(z.object({
    query: z.string().max(200).optional(),
    city: z.string().max(80).optional(),
    category: z.string().max(80).optional(),
    maxHourlyRate: z.number().positive().optional(),
    verifiedOnly: z.boolean().optional(),
    limit: z.number().int().positive().max(100).default(50),
  })).query(async ({ input }) => {
    const clauses: string[] = [`sl.status = 'Available'`, `sl.deleted_at IS NULL`];
    const params: unknown[] = [];
    if (input.query) { params.push(`%${input.query}%`); clauses.push(`(sl.category ILIKE $${params.length} OR sl.city ILIKE $${params.length})`); }
    if (input.city) { params.push(input.city); clauses.push(`(sl.city ILIKE $${params.length} OR EXISTS (SELECT 1 FROM service_areas sa WHERE sa.service_listing_id = sl.id AND sa.city ILIKE $${params.length}))`); }
    if (input.category) { params.push(input.category); clauses.push(`sl.category = $${params.length}`); }
    if (input.maxHourlyRate) { params.push(input.maxHourlyRate); clauses.push(`sl.hourly_rate <= $${params.length}`); }
    if (input.verifiedOnly) { clauses.push(`c.status = 'Approved'`); }
    params.push(input.limit);
    return queryRows(
      `SELECT sl.id, sl.company_id, sl.category, sl.city,
              sl.hourly_rate::text AS hourly_rate, sl.status::text AS status,
              c.name AS company_name, c.status::text AS company_status
       FROM service_listings sl
       INNER JOIN companies c ON c.id = sl.company_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY sl.hourly_rate ASC LIMIT $${params.length}`,
      params,
    );
  }),

  getDetail: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const listing = await queryRow<ServiceListingRow>(
      `SELECT id, company_id, owner_user_id, category, city,
              hourly_rate::text AS hourly_rate, status::text AS status,
              data, created_at, updated_at
       FROM service_listings WHERE id = $1 AND deleted_at IS NULL`, [input.id],
    );
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service listing not found' });
    const [areas, pricing] = await Promise.all([
      queryRows<ServiceAreaRow>(`SELECT id, service_listing_id, city, province, radius_km FROM service_areas WHERE service_listing_id = $1`, [input.id]),
      queryRows<ServicePricingRow>(`SELECT id, service_listing_id, unit, amount::text AS amount, currency, minimum_charge::text AS minimum_charge FROM service_pricing WHERE service_listing_id = $1`, [input.id]),
    ]);
    return { listing, areas, pricing };
  }),

  setAreas: protectedProcedure.input(z.object({
    serviceListingId: z.string(),
    areas: z.array(z.object({
      city: z.string().min(1).max(80),
      province: z.string().max(40).nullable().optional(),
      radiusKm: z.number().int().positive().nullable().optional(),
    })),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<ServiceListingRow>(`SELECT * FROM service_listings WHERE id = $1 AND deleted_at IS NULL`, [input.serviceListingId]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service listing not found' });
    assertProviderAccess(user, listing);
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM service_areas WHERE service_listing_id = $1`, [input.serviceListingId]);
      for (const a of input.areas) {
        await client.query(
          `INSERT INTO service_areas (id, service_listing_id, city, province, radius_km)
           VALUES ($1, $2, $3, $4, $5)`,
          [crypto.randomUUID(), input.serviceListingId, a.city, a.province ?? null, a.radiusKm ?? null],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'service_areas', entityId: input.serviceListingId, action: 'update',
        newValue: { count: input.areas.length }, requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  upsertPricing: protectedProcedure.input(z.object({
    serviceListingId: z.string(),
    tiers: z.array(z.object({
      unit: z.string().min(1).max(40),
      amount: z.number().positive(),
      currency: z.string().default('cad'),
      minimumCharge: z.number().nonnegative().default(0),
    })).min(1),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<ServiceListingRow>(`SELECT * FROM service_listings WHERE id = $1 AND deleted_at IS NULL`, [input.serviceListingId]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service listing not found' });
    assertProviderAccess(user, listing);
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM service_pricing WHERE service_listing_id = $1`, [input.serviceListingId]);
      for (const t of input.tiers) {
        await client.query(
          `INSERT INTO service_pricing (id, service_listing_id, unit, amount, currency, minimum_charge)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), input.serviceListingId, t.unit, t.amount, t.currency, t.minimumCharge],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'service_pricing', entityId: input.serviceListingId, action: 'upsert',
        newValue: { tiers: input.tiers.length }, requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  setListingStatus: protectedProcedure.input(z.object({
    id: z.string(),
    status: z.enum(['Draft', 'PendingApproval', 'Available', 'Hidden', 'Suspended', 'Archived']),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const listing = await queryRow<ServiceListingRow>(`SELECT * FROM service_listings WHERE id = $1 AND deleted_at IS NULL`, [input.id]);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service listing not found' });
    assertProviderAccess(user, listing);
    if ((input.status === 'Suspended' || input.status === 'PendingApproval') && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can use that status' });
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE service_listings SET status = $1::listing_status, updated_at = NOW() WHERE id = $2`, [input.status, input.id]);
      await createAuditLog(client, {
        actorUserId: user.id, companyId: listing.company_id,
        entityName: 'service_listings', entityId: input.id, action: 'set_status',
        previousValue: { status: listing.status }, newValue: { status: input.status },
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),
});
