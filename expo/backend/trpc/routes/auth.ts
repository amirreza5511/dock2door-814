import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { COMPANY_TYPE_BY_ROLE, requiresCompany } from '@/lib/access';
import { createTRPCRouter, protectedProcedure, publicProcedure } from '@/backend/trpc/create-context';
import { hashPassword, requireAuthUser, rotateRefreshToken, signAccessToken, toSessionUser, validateRefreshToken, verifyPassword } from '@/backend/auth';
import { queryRow, withTransaction } from '@/backend/db';
import type { UserRole } from '@/constants/types';

const roleSchema = z.enum([
  'Customer',
  'WarehouseProvider',
  'ServiceProvider',
  'Employer',
  'Worker',
  'TruckingCompany',
  'Driver',
  'GateStaff',
  'Admin',
  'SuperAdmin',
]);

const registerInputSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: roleSchema,
  companyName: z.string().optional(),
  city: z.string().optional(),
});

const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshInputSchema = z.object({
  refreshToken: z.string().min(1),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  company_id: string | null;
  status: 'PendingVerification' | 'Active' | 'Suspended';
  email_verified: boolean;
  two_factor_enabled: boolean;
  profile_image: string | null;
  last_login_at: string | null;
  created_at: string;
  password_hash: string;
}

export const authRouter = createTRPCRouter({
  login: publicProcedure.input(loginInputSchema).mutation(async ({ ctx, input }) => {
    const userRow = await queryRow<UserRow>('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [input.email.toLowerCase()]);

    if (!userRow || !verifyPassword(input.password, userRow.password_hash)) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
    }

    if (userRow.status !== 'Active') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account is not active' });
    }

    return withTransaction(async (client) => {
      const user = toSessionUser(userRow);
      const tokens = await rotateRefreshToken(client, user, null, {
        userAgent: ctx.req.headers.get('user-agent'),
        ipAddress: ctx.req.headers.get('x-forwarded-for') ?? null,
      });
      return { user, ...tokens };
    });
  }),

  register: publicProcedure.input(registerInputSchema).mutation(async ({ ctx, input }) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await queryRow<{ id: string }>('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [normalizedEmail]);

    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'An account with this email already exists' });
    }

    if (requiresCompany(input.role) && !input.companyName?.trim()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Company name is required for this role' });
    }

    return withTransaction(async (client) => {
      const userId = crypto.randomUUID();
      let companyId: string | null = null;

      if (requiresCompany(input.role)) {
        const companyType = COMPANY_TYPE_BY_ROLE[input.role];
        if (!companyType) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Role is missing a company mapping' });
        }

        companyId = crypto.randomUUID();
        await client.query(
          'INSERT INTO companies (id, name, type, address, city, status) VALUES ($1, $2, $3, $4, $5, $6)',
          [companyId, input.companyName?.trim() ?? `${input.name.trim()} Company`, companyType, 'Address pending', input.city?.trim() ?? 'Vancouver', input.role === 'Customer' ? 'Approved' : 'PendingApproval'],
        );
      }

      await client.query(
        `INSERT INTO users (id, email, password_hash, name, role, company_id, status, email_verified, two_factor_enabled, profile_image)
         VALUES ($1, $2, $3, $4, $5, $6, 'Active', false, false, NULL)`,
        [userId, normalizedEmail, hashPassword(input.password), input.name.trim(), input.role, companyId],
      );

      if (companyId) {
        await client.query(
          'INSERT INTO company_members (id, company_id, user_id, company_role, status) VALUES ($1, $2, $3, $4, $5)',
          [crypto.randomUUID(), companyId, userId, 'Owner', 'Active'],
        );
      }

      const insertedUser = await client.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
      const user = toSessionUser(insertedUser.rows[0]);
      const tokens = await rotateRefreshToken(client, user, null, {
        userAgent: ctx.req.headers.get('user-agent'),
        ipAddress: ctx.req.headers.get('x-forwarded-for') ?? null,
      });
      return { user, ...tokens };
    });
  }),

  refresh: publicProcedure.input(refreshInputSchema).mutation(async ({ ctx, input }) => {
    const validated = await validateRefreshToken(input.refreshToken);
    return withTransaction(async (client) => {
      const tokens = await rotateRefreshToken(client, validated.user, validated.tokenRow.id, {
        userAgent: ctx.req.headers.get('user-agent'),
        ipAddress: ctx.req.headers.get('x-forwarded-for') ?? null,
      });
      return { user: validated.user, ...tokens };
    });
  }),

  logout: protectedProcedure.input(z.object({ refreshToken: z.string().optional() })).mutation(async ({ input }) => {
    if (!input.refreshToken) {
      return { success: true };
    }

    const validated = await validateRefreshToken(input.refreshToken);
    await withTransaction(async (client) => {
      await client.query('UPDATE refresh_tokens SET revoked_at = NOW(), rotated_at = NOW() WHERE id = $1', [validated.tokenRow.id]);
    });

    return { success: true };
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    return {
      user,
      accessToken: signAccessToken(user),
    };
  }),
});
