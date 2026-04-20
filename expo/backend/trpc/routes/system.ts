import { createTRPCRouter, publicProcedure } from '@/backend/trpc/create-context';
import { env } from '@/backend/env';

export const systemRouter = createTRPCRouter({
  health: publicProcedure.query(() => {
    return {
      status: 'ok' as const,
      service: 'dock2door-api',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
    };
  }),
  metadata: publicProcedure.query(() => {
    return {
      roles: ['Customer', 'WarehouseProvider', 'ServiceProvider', 'Employer', 'Worker', 'TruckingCompany', 'Driver', 'GateStaff', 'Admin', 'SuperAdmin'],
      features: ['auth', 'payments', 'uploads', 'messaging', 'notifications', 'operations', 'analytics', 'admin'],
      apiBaseUrl: env.apiBaseUrl,
      webBaseUrl: env.appWebUrl,
    };
  }),
});
