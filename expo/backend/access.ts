import { TRPCError } from '@trpc/server';
import type { SessionUser } from '@/backend/auth';

export function assertCompanyAccess(user: SessionUser, companyId: string | null | undefined): void {
  if (user.role === 'Admin' || user.role === 'SuperAdmin') {
    return;
  }

  if (!companyId || user.companyId !== companyId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Cross-company access denied' });
  }
}

export function assertRole(user: SessionUser, roles: SessionUser['role'][]): void {
  if (!roles.includes(user.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission for this action' });
  }
}
