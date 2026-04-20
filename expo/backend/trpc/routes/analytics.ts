import { requireAuthUser } from '@/backend/auth';
import { queryRow } from '@/backend/db';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';

export const analyticsRouter = createTRPCRouter({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    const companyFilter = user.role === 'Admin' || user.role === 'SuperAdmin' ? [] : [user.companyId];
    const companyClause = user.role === 'Admin' || user.role === 'SuperAdmin' ? '' : 'WHERE company_id = $1 AND deleted_at IS NULL';

    const bookings = await queryRow<{ count: string; total: string }>(`SELECT COUNT(*)::text AS count, COALESCE(SUM(total_amount), 0)::text AS total FROM bookings ${companyClause}`, companyFilter);
    const payments = await queryRow<{ total: string }>(`SELECT COALESCE(SUM(gross_amount), 0)::text AS total FROM payments ${companyClause.replace('company_id', 'company_id')} `, companyFilter);
    const utilization = await queryRow<{ utilization_rate: string }>(
      user.role === 'Admin' || user.role === 'SuperAdmin'
        ? `SELECT COALESCE(ROUND((SUM(CASE WHEN available_pallet_capacity > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2), 0)::text AS utilization_rate FROM warehouse_listings WHERE deleted_at IS NULL`
        : `SELECT COALESCE(ROUND((SUM(CASE WHEN available_pallet_capacity > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2), 0)::text AS utilization_rate FROM warehouse_listings WHERE company_id = $1 AND deleted_at IS NULL`,
      companyFilter,
    );
    const performance = await queryRow<{ completed_bookings: string }>(
      user.role === 'Admin' || user.role === 'SuperAdmin'
        ? `SELECT COUNT(*)::text AS completed_bookings FROM bookings WHERE status = 'Completed' AND deleted_at IS NULL`
        : `SELECT COUNT(*)::text AS completed_bookings FROM bookings WHERE company_id = $1 AND status = 'Completed' AND deleted_at IS NULL`,
      companyFilter,
    );

    return {
      bookingVolume: Number(bookings?.count ?? '0'),
      revenue: Number(payments?.total ?? '0'),
      utilizationRate: Number(utilization?.utilization_rate ?? '0'),
      companyPerformance: Number(performance?.completed_bookings ?? '0'),
      grossBookingValue: Number(bookings?.total ?? '0'),
    };
  }),
});
