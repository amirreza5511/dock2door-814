import { z } from 'zod';
import { requireAdmin } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';

const entityEnum = z.enum(['companies', 'users', 'bookings', 'disputes', 'drivers', 'trucks', 'trailers', 'containers', 'payments', 'invoices', 'payouts', 'message_threads', 'dock_appointments']);

const entityQueryMap: Record<z.infer<typeof entityEnum>, string> = {
  companies: 'SELECT * FROM companies WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  users: 'SELECT id, email, name, role, status, company_id, created_at, updated_at, deleted_at FROM users WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  bookings: 'SELECT * FROM bookings WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  disputes: 'SELECT * FROM disputes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  drivers: 'SELECT * FROM drivers WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  trucks: 'SELECT * FROM trucks WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  trailers: 'SELECT * FROM trailers WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  containers: 'SELECT * FROM containers WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  payments: 'SELECT * FROM payments WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  invoices: 'SELECT * FROM invoices WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  payouts: 'SELECT * FROM payouts WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  message_threads: 'SELECT * FROM message_threads WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
  dock_appointments: 'SELECT * FROM dock_appointments WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200',
};

export const adminRouter = createTRPCRouter({
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user);
    const [users, companies, bookings, disputes, audits] = await Promise.all([
      queryRows('SELECT id, email, name, role, status, company_id, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100', []),
      queryRows('SELECT * FROM companies WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100', []),
      queryRows('SELECT * FROM bookings WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100', []),
      queryRows('SELECT * FROM disputes WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100', []),
      queryRows('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200', []),
    ]);
    return { users, companies, bookings, disputes, audits };
  }),
  listEntity: protectedProcedure.input(z.object({ entity: entityEnum })).query(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    return queryRows(entityQueryMap[input.entity], []);
  }),
  getEntityRecord: protectedProcedure.input(z.object({ entity: entityEnum, id: z.string() })).query(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    return queryRow(`SELECT * FROM ${input.entity} WHERE id = $1 AND deleted_at IS NULL`, [input.id]);
  }),
  updateEntityStatus: protectedProcedure.input(z.object({ entity: entityEnum, id: z.string(), status: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    await withTransaction(async (client) => {
      await client.query(`UPDATE ${input.entity} SET status = $1, updated_at = NOW() WHERE id = $2`, [input.status, input.id]);
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: input.entity, entityId: input.id, action: 'status_update', newValue: { status: input.status }, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  archiveEntity: protectedProcedure.input(z.object({ entity: entityEnum, id: z.string() })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    await withTransaction(async (client) => {
      await client.query(`UPDATE ${input.entity} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [input.id]);
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: input.entity, entityId: input.id, action: 'archive', requestId: ctx.requestId });
    });
    return { success: true };
  }),
  setCompanyStatus: protectedProcedure.input(z.object({ companyId: z.string(), status: z.enum(['PendingApproval', 'Approved', 'Suspended']) })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    await withTransaction(async (client) => {
      await client.query('UPDATE companies SET status = $1, updated_at = NOW() WHERE id = $2', [input.status, input.companyId]);
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: 'companies', entityId: input.companyId, action: 'status_update', newValue: { status: input.status }, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  setUserStatus: protectedProcedure.input(z.object({ userId: z.string(), status: z.enum(['PendingVerification', 'Active', 'Suspended']) })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', [input.status, input.userId]);
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: 'users', entityId: input.userId, action: 'status_update', newValue: { status: input.status }, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  auditLogs: protectedProcedure.input(z.object({
    entity: z.string().optional(),
    entityId: z.string().optional(),
    companyId: z.string().optional(),
    actorUserId: z.string().optional(),
    limit: z.number().int().positive().max(500).default(200),
  })).query(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (input.entity) { params.push(input.entity); clauses.push(`entity_name = ${params.length}`); }
    if (input.entityId) { params.push(input.entityId); clauses.push(`entity_id = ${params.length}`); }
    if (input.companyId) { params.push(input.companyId); clauses.push(`company_id = ${params.length}`); }
    if (input.actorUserId) { params.push(input.actorUserId); clauses.push(`actor_user_id = ${params.length}`); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(input.limit);
    return queryRows(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ${params.length}`, params);
  }),
  listCommissionRules: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user);
    return queryRows(`SELECT id, module, percentage::text AS percentage, minimum_amount::text AS minimum_amount, currency, active, created_at, updated_at FROM commission_rules ORDER BY module ASC`, []);
  }),
  upsertCommissionRule: protectedProcedure.input(z.object({
    id: z.string().optional(),
    module: z.string().min(1).max(40),
    percentage: z.number().min(0).max(100),
    minimumAmount: z.number().min(0).default(0),
    currency: z.string().default('cad'),
    active: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    const id = input.id ?? crypto.randomUUID();
    await withTransaction(async (client) => {
      if (input.id) {
        await client.query(`UPDATE commission_rules SET module = $1, percentage = $2, minimum_amount = $3, currency = $4, active = $5, updated_at = NOW() WHERE id = $6`, [input.module, input.percentage, input.minimumAmount, input.currency, input.active, input.id]);
      } else {
        await client.query(`INSERT INTO commission_rules (id, module, percentage, minimum_amount, currency, active) VALUES ($1, $2, $3, $4, $5, $6)`, [id, input.module, input.percentage, input.minimumAmount, input.currency, input.active]);
      }
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: 'commission_rules', entityId: id, action: input.id ? 'update' : 'create', newValue: input, requestId: ctx.requestId });
    });
    return { id };
  }),
  listTaxRules: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user);
    return queryRows(`SELECT id, jurisdiction, rate::text AS rate, applies_to, active, created_at FROM tax_rules ORDER BY jurisdiction ASC`, []);
  }),
  upsertTaxRule: protectedProcedure.input(z.object({
    id: z.string().optional(),
    jurisdiction: z.string().min(1).max(40),
    rate: z.number().min(0).max(100),
    appliesTo: z.string().min(1).max(40),
    active: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    const id = input.id ?? crypto.randomUUID();
    await withTransaction(async (client) => {
      if (input.id) {
        await client.query(`UPDATE tax_rules SET jurisdiction = $1, rate = $2, applies_to = $3, active = $4 WHERE id = $5`, [input.jurisdiction, input.rate, input.appliesTo, input.active, input.id]);
      } else {
        await client.query(`INSERT INTO tax_rules (id, jurisdiction, rate, applies_to, active) VALUES ($1, $2, $3, $4, $5)`, [id, input.jurisdiction, input.rate, input.appliesTo, input.active]);
      }
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: 'tax_rules', entityId: id, action: input.id ? 'update' : 'create', newValue: input, requestId: ctx.requestId });
    });
    return { id };
  }),
  listFeatureFlags: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user);
    return queryRows(`SELECT id, key, description, enabled, rollout, updated_at FROM feature_flags ORDER BY key ASC`, []);
  }),
  upsertFeatureFlag: protectedProcedure.input(z.object({
    key: z.string().min(1).max(80),
    description: z.string().max(500).nullable().optional(),
    enabled: z.boolean().default(false),
    rollout: z.record(z.string(), z.any()).default({}),
  })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(`INSERT INTO feature_flags (id, key, description, enabled, rollout) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, enabled = EXCLUDED.enabled, rollout = EXCLUDED.rollout, updated_at = NOW()`, [id, input.key, input.description ?? null, input.enabled, JSON.stringify(input.rollout)]);
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: 'feature_flags', entityId: input.key, action: 'upsert', newValue: input, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  getPlatformSettings: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user);
    const row = await queryRow<{ id: string; data: Record<string, unknown> | null; updated_at: string }>(`SELECT id, data, updated_at FROM platform_settings ORDER BY updated_at DESC LIMIT 1`, []);
    return row ?? { id: null, data: {}, updated_at: null };
  }),
  updatePlatformSettings: protectedProcedure.input(z.object({ data: z.record(z.string(), z.any()) })).mutation(async ({ ctx, input }) => {
    const admin = requireAdmin(ctx.user);
    const existing = await queryRow<{ id: string }>(`SELECT id FROM platform_settings ORDER BY updated_at DESC LIMIT 1`, []);
    const id = existing?.id ?? crypto.randomUUID();
    await withTransaction(async (client) => {
      if (existing) {
        await client.query(`UPDATE platform_settings SET data = $1::jsonb, owner_user_id = $2, updated_at = NOW() WHERE id = $3`, [JSON.stringify(input.data), admin.id, existing.id]);
      } else {
        await client.query(`INSERT INTO platform_settings (id, owner_user_id, status, data) VALUES ($1, $2, 'Active', $3::jsonb)`, [id, admin.id, JSON.stringify(input.data)]);
      }
      await createAuditLog(client, { actorUserId: admin.id, companyId: null, entityName: 'platform_settings', entityId: id, action: 'update', newValue: input.data, requestId: ctx.requestId });
    });
    return { id };
  }),
  platformMetrics: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user);
    const [bookings, gmv, activeCompanies, openDisputes, pendingPayouts, notifications] = await Promise.all([
      queryRow<{ count: string }>(`SELECT COUNT(*)::text AS count FROM bookings WHERE deleted_at IS NULL`, []),
      queryRow<{ total: string }>(`SELECT COALESCE(SUM(gross_amount), 0)::text AS total FROM payments WHERE status = 'Paid' AND deleted_at IS NULL`, []),
      queryRow<{ count: string }>(`SELECT COUNT(*)::text AS count FROM companies WHERE status = 'Approved' AND deleted_at IS NULL`, []),
      queryRow<{ count: string }>(`SELECT COUNT(*)::text AS count FROM disputes WHERE status IN ('Open', 'UnderReview') AND deleted_at IS NULL`, []),
      queryRow<{ total: string }>(`SELECT COALESCE(SUM(amount), 0)::text AS total FROM provider_earnings WHERE status = 'Pending'`, []),
      queryRow<{ count: string }>(`SELECT COUNT(*)::text AS count FROM notifications WHERE read_at IS NULL AND deleted_at IS NULL`, []),
    ]);
    return {
      totalBookings: Number(bookings?.count ?? '0'),
      grossBookingValue: Number(gmv?.total ?? '0'),
      activeCompanies: Number(activeCompanies?.count ?? '0'),
      openDisputes: Number(openDisputes?.count ?? '0'),
      pendingPayouts: Number(pendingPayouts?.total ?? '0'),
      unreadNotifications: Number(notifications?.count ?? '0'),
    };
  }),
});
