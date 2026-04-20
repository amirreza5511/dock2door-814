import Stripe from 'stripe';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { isAdmin, requireAdmin, requireAuthUser, type SessionUser } from '@/backend/auth';
import { queryRow, queryRows, withTransaction } from '@/backend/db';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

const tableSchema = z.enum([
  'companies',
  'company_members',
  'warehouse_listings',
  'service_listings',
  'service_jobs',
  'bookings',
  'messages',
  'notifications',
  'payments',
  'invoices',
  'payouts',
  'reviews',
  'disputes',
  'audit_logs',
  'platform_settings',
  'worker_profiles',
  'worker_certifications',
  'shift_posts',
  'shift_applications',
  'shift_assignments',
  'time_entries',
  'drivers',
  'trucks',
  'trailers',
  'containers',
  'dock_appointments',
]);

type EntityTable = z.infer<typeof tableSchema>;

type EntityRow = {
  id: string;
  company_id: string | null;
  owner_user_id: string | null;
  status: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type CompanyRow = {
  id: string;
  name: string;
  type: string;
  address: string;
  city: string;
  status: string;
  created_at: string;
};

type CompanyMemberRow = {
  id: string;
  company_id: string;
  user_id: string;
  company_role: string;
  status: string;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  company_id: string | null;
  status: 'Active' | 'Suspended';
  email_verified: boolean;
  two_factor_enabled: boolean;
  profile_image: string | null;
  last_login_at: string | null;
  created_at: string;
};

function mapEntityRow<T extends Record<string, unknown>>(row: EntityRow): T {
  const mapped = {
    id: row.id,
    ...(row.data ?? {}),
    createdAt: row.created_at,
  };

  return mapped as unknown as T;
}

function mapCompany(row: CompanyRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address,
    city: row.city,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapCompanyMember(row: CompanyMemberRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    companyRole: row.company_role,
    status: row.status,
  };
}

function mapUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    password: '',
    name: row.name,
    role: row.role,
    companyId: row.company_id,
    status: row.status,
    emailVerified: row.email_verified,
    twoFactorEnabled: row.two_factor_enabled,
    profileImage: row.profile_image,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

async function fetchEntities<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  const rows = await queryRows<EntityRow>(sql, params);
  return rows.map((row) => mapEntityRow<T>(row));
}

async function getBootstrapData(user: SessionUser) {
  const admin = isAdmin(user);
  const companyId = user.companyId;
  const userId = user.id;

  const companies = admin
    ? await queryRows<CompanyRow>(`SELECT * FROM companies ORDER BY created_at DESC`, [])
    : companyId
      ? await queryRows<CompanyRow>(`SELECT * FROM companies WHERE id = $1`, [companyId])
      : [];

  const companyUsers = admin
    ? await queryRows<CompanyMemberRow>(`SELECT * FROM company_members ORDER BY created_at DESC`, [])
    : companyId
      ? await queryRows<CompanyMemberRow>(`SELECT * FROM company_members WHERE company_id = $1 ORDER BY created_at DESC`, [companyId])
      : [];

  const users = admin
    ? await queryRows<UserRow>(`SELECT id, email, name, role, company_id, status, email_verified, two_factor_enabled, profile_image, last_login_at, created_at FROM users ORDER BY created_at DESC`, [])
    : companyId
      ? await queryRows<UserRow>(`SELECT id, email, name, role, company_id, status, email_verified, two_factor_enabled, profile_image, last_login_at, created_at FROM users WHERE company_id = $1 ORDER BY created_at DESC`, [companyId])
      : await queryRows<UserRow>(`SELECT id, email, name, role, company_id, status, email_verified, two_factor_enabled, profile_image, last_login_at, created_at FROM users WHERE id = $1`, [userId]);

  const warehouseListings = admin
    ? await fetchEntities(`SELECT * FROM warehouse_listings ORDER BY created_at DESC`, [])
    : user.role === 'Customer'
      ? await fetchEntities(`SELECT * FROM warehouse_listings WHERE status = 'Available' ORDER BY created_at DESC`, [])
      : companyId
        ? await fetchEntities(`SELECT * FROM warehouse_listings WHERE company_id = $1 ORDER BY created_at DESC`, [companyId])
        : [];

  const serviceListings = admin
    ? await fetchEntities(`SELECT * FROM service_listings ORDER BY created_at DESC`, [])
    : user.role === 'Customer'
      ? await fetchEntities(`SELECT * FROM service_listings WHERE status IN ('Active', 'Available') ORDER BY created_at DESC`, [])
      : companyId
        ? await fetchEntities(`SELECT * FROM service_listings WHERE company_id = $1 ORDER BY created_at DESC`, [companyId])
        : [];

  const warehouseBookings = admin
    ? await fetchEntities(`SELECT * FROM bookings WHERE COALESCE(data->>'bookingType', 'Warehouse') = 'Warehouse' ORDER BY created_at DESC`, [])
    : user.role === 'Customer'
      ? await fetchEntities(`SELECT * FROM bookings WHERE data->>'customerCompanyId' = $1 AND COALESCE(data->>'bookingType', 'Warehouse') = 'Warehouse' ORDER BY created_at DESC`, [companyId ?? ''])
      : companyId
        ? await fetchEntities(`SELECT b.* FROM bookings b INNER JOIN warehouse_listings wl ON wl.id = b.data->>'listingId' WHERE wl.company_id = $1 AND COALESCE(b.data->>'bookingType', 'Warehouse') = 'Warehouse' ORDER BY b.created_at DESC`, [companyId])
        : [];

  const serviceJobs = admin
    ? await fetchEntities(`SELECT * FROM service_jobs ORDER BY created_at DESC`, [])
    : user.role === 'Customer'
      ? await fetchEntities(`SELECT * FROM service_jobs WHERE data->>'customerCompanyId' = $1 ORDER BY created_at DESC`, [companyId ?? ''])
      : companyId
        ? await fetchEntities(`SELECT sj.* FROM service_jobs sj INNER JOIN service_listings sl ON sl.id = sj.data->>'serviceId' WHERE sl.company_id = $1 ORDER BY sj.created_at DESC`, [companyId])
        : [];

  const workerProfiles = admin
    ? await fetchEntities(`SELECT * FROM worker_profiles ORDER BY created_at DESC`, [])
    : user.role === 'Worker'
      ? await fetchEntities(`SELECT * FROM worker_profiles WHERE owner_user_id = $1 ORDER BY created_at DESC`, [userId])
      : await fetchEntities(`SELECT * FROM worker_profiles ORDER BY created_at DESC`, []);

  const workerCertifications = admin
    ? await fetchEntities(`SELECT * FROM worker_certifications ORDER BY created_at DESC`, [])
    : user.role === 'Worker'
      ? await fetchEntities(`SELECT * FROM worker_certifications WHERE owner_user_id = $1 ORDER BY created_at DESC`, [userId])
      : [];

  const shiftPosts = admin
    ? await fetchEntities(`SELECT * FROM shift_posts ORDER BY created_at DESC`, [])
    : user.role === 'Worker'
      ? await fetchEntities(`SELECT * FROM shift_posts WHERE status IN ('Posted', 'Filled', 'InProgress') ORDER BY created_at DESC`, [])
      : companyId
        ? await fetchEntities(`SELECT * FROM shift_posts WHERE company_id = $1 ORDER BY created_at DESC`, [companyId])
        : [];

  const shiftApplications = admin
    ? await fetchEntities(`SELECT * FROM shift_applications ORDER BY created_at DESC`, [])
    : user.role === 'Worker'
      ? await fetchEntities(`SELECT * FROM shift_applications WHERE owner_user_id = $1 ORDER BY created_at DESC`, [userId])
      : companyId
        ? await fetchEntities(`SELECT sa.* FROM shift_applications sa INNER JOIN shift_posts sp ON sp.id = sa.data->>'shiftId' WHERE sp.company_id = $1 ORDER BY sa.created_at DESC`, [companyId])
        : [];

  const shiftAssignments = admin
    ? await fetchEntities(`SELECT * FROM shift_assignments ORDER BY created_at DESC`, [])
    : user.role === 'Worker'
      ? await fetchEntities(`SELECT * FROM shift_assignments WHERE owner_user_id = $1 ORDER BY created_at DESC`, [userId])
      : companyId
        ? await fetchEntities(`SELECT sa.* FROM shift_assignments sa INNER JOIN shift_posts sp ON sp.id = sa.data->>'shiftId' WHERE sp.company_id = $1 ORDER BY sa.created_at DESC`, [companyId])
        : [];

  const timeEntries = admin
    ? await fetchEntities(`SELECT * FROM time_entries ORDER BY created_at DESC`, [])
    : user.role === 'Worker'
      ? await fetchEntities(`SELECT * FROM time_entries WHERE owner_user_id = $1 ORDER BY created_at DESC`, [userId])
      : companyId
        ? await fetchEntities(`SELECT te.* FROM time_entries te INNER JOIN shift_assignments sa ON sa.id = te.data->>'assignmentId' INNER JOIN shift_posts sp ON sp.id = sa.data->>'shiftId' WHERE sp.company_id = $1 ORDER BY te.created_at DESC`, [companyId])
        : [];

  const payments = admin
    ? await fetchEntities(`SELECT * FROM payments ORDER BY created_at DESC`, [])
    : companyId
      ? await fetchEntities(`SELECT * FROM payments WHERE company_id = $1 ORDER BY created_at DESC`, [companyId])
      : [];

  const reviews = admin
    ? await fetchEntities(`SELECT * FROM reviews ORDER BY created_at DESC`, [])
    : companyId
      ? await fetchEntities(`SELECT * FROM reviews WHERE company_id = $1 OR owner_user_id = $2 ORDER BY created_at DESC`, [companyId, userId])
      : [];

  const disputes = admin
    ? await fetchEntities(`SELECT * FROM disputes ORDER BY created_at DESC`, [])
    : companyId
      ? await fetchEntities(`SELECT * FROM disputes WHERE company_id = $1 OR owner_user_id = $2 ORDER BY created_at DESC`, [companyId, userId])
      : [];

  const messages = admin
    ? await fetchEntities(`SELECT * FROM messages ORDER BY created_at DESC`, [])
    : await fetchEntities(`SELECT * FROM messages WHERE owner_user_id = $1 OR company_id = $2 ORDER BY created_at DESC`, [userId, companyId ?? '']);

  const notifications = admin
    ? await fetchEntities(`SELECT * FROM notifications ORDER BY created_at DESC`, [])
    : await fetchEntities(`SELECT * FROM notifications WHERE owner_user_id = $1 ORDER BY created_at DESC`, [userId]);

  const auditLogs = admin
    ? await fetchEntities(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200`, [])
    : await fetchEntities(`SELECT * FROM audit_logs WHERE owner_user_id = $1 OR company_id = $2 ORDER BY created_at DESC LIMIT 100`, [userId, companyId ?? '']);

  const platformSettingsRows = admin
    ? await fetchEntities(`SELECT * FROM platform_settings ORDER BY created_at DESC LIMIT 1`, [])
    : [];

  return {
    users: users.map(mapUser),
    companies: companies.map(mapCompany),
    companyUsers: companyUsers.map(mapCompanyMember),
    platformSettings: platformSettingsRows[0] ?? {
      id: 'platform-default',
      warehouseCommissionPercentage: 8,
      serviceCommissionPercentage: 20,
      labourCommissionPercentage: 15,
      handlingFeePerPalletDefault: 0,
      taxMode: 'exclusive',
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    },
    warehouseListings,
    warehouseBookings,
    serviceListings,
    serviceJobs,
    workerProfiles,
    workerCertifications,
    shiftPosts,
    shiftApplications,
    shiftAssignments,
    timeEntries,
    payments,
    reviews,
    disputes,
    messages,
    notifications,
    auditLogs,
  };
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function resolveOwnership(table: EntityTable, payload: Record<string, unknown>, user: SessionUser) {
  const payloadStatus = getStringValue(payload.status);
  const payloadCompanyId = getStringValue(payload.companyId);
  const payloadCustomerCompanyId = getStringValue(payload.customerCompanyId);

  switch (table) {
    case 'warehouse_listings':
    case 'service_listings':
    case 'shift_posts':
    case 'payments':
    case 'disputes':
    case 'reviews':
    case 'dock_appointments':
    case 'drivers':
    case 'trucks':
    case 'trailers':
    case 'containers':
    case 'payouts':
      return { companyId: payloadCompanyId ?? user.companyId ?? '', ownerUserId: user.id, status: payloadStatus };
    case 'bookings':
      return { companyId: payloadCustomerCompanyId ?? user.companyId ?? '', ownerUserId: user.id, status: payloadStatus };
    case 'service_jobs':
      return { companyId: payloadCustomerCompanyId ?? user.companyId ?? '', ownerUserId: user.id, status: payloadStatus };
    case 'messages':
    case 'notifications':
    case 'worker_profiles':
    case 'worker_certifications':
    case 'shift_applications':
    case 'shift_assignments':
    case 'time_entries':
    case 'audit_logs':
      return { companyId: user.companyId, ownerUserId: user.id, status: payloadStatus };
    case 'platform_settings':
      return { companyId: null, ownerUserId: user.id, status: payloadStatus };
    default:
      return { companyId: user.companyId, ownerUserId: user.id, status: payloadStatus };
  }
}

async function assertMutationAllowed(table: EntityTable, user: SessionUser, recordId?: string) {
  if (isAdmin(user)) {
    return;
  }

  if (table === 'platform_settings' || table === 'companies' || table === 'company_members') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }

  if (!recordId) {
    return;
  }

  const record = await queryRow<{ company_id: string | null; owner_user_id: string | null }>(`SELECT company_id, owner_user_id FROM ${table} WHERE id = $1`, [recordId]);
  if (!record) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
  }

  if (record.owner_user_id && record.owner_user_id === user.id) {
    return;
  }

  if (record.company_id && user.companyId && record.company_id === user.companyId) {
    return;
  }

  throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant access denied' });
}

export const dockRouter = createTRPCRouter({
  bootstrap: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    return getBootstrapData(user);
  }),

  createRecord: protectedProcedure.input(z.object({ table: tableSchema, payload: z.record(z.string(), z.any()) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (input.table === 'platform_settings') {
      requireAdmin(user);
    }

    const id = typeof input.payload.id === 'string' ? input.payload.id : crypto.randomUUID();
    const ownership = resolveOwnership(input.table, input.payload, user);

    if (!isAdmin(user) && ownership.companyId && user.companyId && ownership.companyId !== user.companyId && ownership.ownerUserId !== user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-tenant create denied' });
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO ${input.table} (id, company_id, owner_user_id, status, data) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [id, ownership.companyId, ownership.ownerUserId, ownership.status, JSON.stringify({ ...input.payload, id })],
      );

      await client.query(
        `INSERT INTO audit_logs (id, company_id, owner_user_id, status, data) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [crypto.randomUUID(), user.companyId, user.id, 'created', JSON.stringify({ entity: input.table, entityId: id, action: 'create' })],
      );
      return null;
    });

    return { id };
  }),

  updateRecord: protectedProcedure.input(z.object({ table: tableSchema, id: z.string(), payload: z.record(z.string(), z.any()) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await assertMutationAllowed(input.table, user, input.id);

    if (input.table === 'platform_settings') {
      requireAdmin(user);
    }

    const current = await queryRow<EntityRow>(`SELECT * FROM ${input.table} WHERE id = $1`, [input.id]);
    if (!current) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
    }

    const nextPayload = { ...(current.data ?? {}), ...input.payload, id: input.id };
    const nextStatus = typeof input.payload.status === 'string' ? input.payload.status : current.status;

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE ${input.table} SET status = $1, data = $2::jsonb, updated_at = NOW() WHERE id = $3`,
        [nextStatus, JSON.stringify(nextPayload), input.id],
      );
      await client.query(
        `INSERT INTO audit_logs (id, company_id, owner_user_id, status, data) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [crypto.randomUUID(), user.companyId, user.id, 'updated', JSON.stringify({ entity: input.table, entityId: input.id, action: 'update' })],
      );
      return null;
    });

    return { success: true };
  }),

  updateCompany: protectedProcedure.input(z.object({ id: z.string(), payload: z.object({ name: z.string().optional(), address: z.string().optional(), city: z.string().optional(), status: z.string().optional() }) })).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    await withTransaction(async (client) => {
      const current = await client.query<CompanyRow>(`SELECT * FROM companies WHERE id = $1`, [input.id]);
      const row = current.rows[0];
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Company not found' });
      }

      await client.query(
        `UPDATE companies SET name = $1, address = $2, city = $3, status = $4, updated_at = NOW() WHERE id = $5`,
        [input.payload.name ?? row.name, input.payload.address ?? row.address, input.payload.city ?? row.city, input.payload.status ?? row.status, input.id],
      );
      return null;
    });

    return { success: true };
  }),

  updateUser: protectedProcedure.input(z.object({ id: z.string(), payload: z.object({ name: z.string().optional(), status: z.enum(['Active', 'Suspended']).optional(), role: z.string().optional(), profileImage: z.string().nullable().optional() }) })).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET name = COALESCE($1, name), status = COALESCE($2, status), role = COALESCE($3::user_role, role), profile_image = COALESCE($4, profile_image), updated_at = NOW() WHERE id = $5`,
        [input.payload.name ?? null, input.payload.status ?? null, input.payload.role ?? null, input.payload.profileImage ?? null, input.id],
      );
      return null;
    });
    return { success: true };
  }),

  createPaymentIntent: protectedProcedure.input(z.object({ paymentId: z.string(), amount: z.number().positive(), currency: z.string().default('cad'), referenceType: z.string(), referenceId: z.string(), companyId: z.string().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!stripe) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Missing STRIPE_SECRET_KEY' });
    }

    const commissionAmount = Number((input.amount * 0.08).toFixed(2));
    const netAmount = Number((input.amount - commissionAmount).toFixed(2));

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(input.amount * 100),
      currency: input.currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        paymentId: input.paymentId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        companyId: input.companyId ?? user.companyId ?? '',
      },
    });

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO payments (id, company_id, owner_user_id, status, data)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = NOW()`,
        [
          input.paymentId,
          input.companyId ?? user.companyId,
          user.id,
          'Pending',
          JSON.stringify({
            id: input.paymentId,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            grossAmount: input.amount,
            commissionAmount,
            netAmount,
            status: 'Pending',
            stripePaymentIntentId: paymentIntent.id,
          }),
        ],
      );
      return null;
    });

    return { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id };
  }),

  confirmPayment: protectedProcedure.input(z.object({ paymentId: z.string(), stripePaymentIntentId: z.string() })).mutation(async ({ ctx, input }) => {
    requireAuthUser(ctx.user);
    await withTransaction(async (client) => {
      const current = await client.query<EntityRow>(`SELECT * FROM payments WHERE id = $1`, [input.paymentId]);
      const row = current.rows[0];
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Payment not found' });
      }

      const updatedData = {
        ...(row.data ?? {}),
        status: 'Paid',
        stripePaymentIntentId: input.stripePaymentIntentId,
      };

      await client.query(`UPDATE payments SET status = 'Paid', data = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(updatedData), input.paymentId]);
      await client.query(
        `INSERT INTO invoices (id, company_id, owner_user_id, status, data) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [crypto.randomUUID(), row.company_id, row.owner_user_id, 'Issued', JSON.stringify({ paymentId: input.paymentId, invoiceNumber: `INV-${Date.now()}` })],
      );
      return null;
    });
    return { success: true };
  }),
});
