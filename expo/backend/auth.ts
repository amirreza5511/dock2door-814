import jwt from 'jsonwebtoken';
import { createHash, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { TRPCError } from '@trpc/server';
import { env } from '@/backend/env';
import type { UserRole } from '@/constants/types';
import { queryRow } from '@/backend/db';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string | null;
  status: 'PendingVerification' | 'Active' | 'Suspended';
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  profileImage: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface JwtPayload {
  sub: string;
  role: UserRole;
  companyId: string | null;
  email: string;
  type: 'access' | 'refresh';
  tokenId?: string;
}

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

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

export function hashPassword(password: string): string {
  const salt = randomUUID();
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, stored] = storedHash.split(':');
  if (!salt || !stored) {
    return false;
  }

  const derived = scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(stored, 'hex');
  return derived.length === storedBuffer.length && timingSafeEqual(derived, storedBuffer);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toSessionUser(row: Omit<UserRow, 'password_hash'>): SessionUser {
  return {
    id: row.id,
    email: row.email,
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

export function signAccessToken(user: SessionUser): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      companyId: user.companyId,
      email: user.email,
      type: 'access',
    } satisfies JwtPayload,
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessTtl as jwt.SignOptions['expiresIn'] },
  );
}

export function signRefreshToken(user: SessionUser, tokenId: string): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      companyId: user.companyId,
      email: user.email,
      type: 'refresh',
      tokenId,
    } satisfies JwtPayload,
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshTtl as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtAccessSecret) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as JwtPayload;
}

export async function getUserById(userId: string): Promise<UserRow | null> {
  return queryRow<UserRow>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
}

export function requireAuthUser(authUser: SessionUser | null): SessionUser {
  if (!authUser) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  return authUser;
}

export function requireAdmin(authUser: SessionUser | null): SessionUser {
  if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'SuperAdmin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }

  return authUser;
}

export function isAdmin(authUser: SessionUser | null): boolean {
  return authUser?.role === 'Admin' || authUser?.role === 'SuperAdmin';
}

function parseExpiryDate(expiresAt: string): Date {
  return new Date(expiresAt);
}

export async function rotateRefreshToken(client: PoolClient, user: SessionUser, previousTokenId?: string | null, meta?: { userAgent?: string | null; ipAddress?: string | null }): Promise<AuthTokens> {
  const nextTokenId = crypto.randomUUID();
  const refreshToken = signRefreshToken(user, nextTokenId);
  const accessToken = signAccessToken(user);
  const refreshTokenHash = hashToken(refreshToken);
  const decoded = verifyRefreshToken(refreshToken);
  const expiresAt = new Date((decoded as jwt.JwtPayload).exp ? (decoded as jwt.JwtPayload).exp! * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (previousTokenId) {
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(), rotated_at = NOW(), replaced_by_token_id = $1 WHERE id = $2',
      [nextTokenId, previousTokenId],
    );
  }

  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [nextTokenId, user.id, refreshTokenHash, expiresAt.toISOString(), meta?.userAgent ?? null, meta?.ipAddress ?? null],
  );

  await client.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [user.id]);

  return { accessToken, refreshToken };
}

export async function validateRefreshToken(token: string): Promise<{ user: SessionUser; tokenRow: RefreshTokenRow }> {
  const payload = verifyRefreshToken(token);
  if (!payload.tokenId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token' });
  }

  const tokenRow = await queryRow<RefreshTokenRow>('SELECT * FROM refresh_tokens WHERE id = $1', [payload.tokenId]);
  const userRow = await getUserById(payload.sub);

  if (!tokenRow || !userRow || tokenRow.revoked_at || hashToken(token) !== tokenRow.token_hash) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token' });
  }

  if (parseExpiryDate(tokenRow.expires_at).getTime() <= Date.now()) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Refresh token expired' });
  }

  if (userRow.status !== 'Active') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account is not active' });
  }

  return { user: toSessionUser(userRow), tokenRow };
}
