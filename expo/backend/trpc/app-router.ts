import { createTRPCRouter } from '@/backend/trpc/create-context';
import { adminRouter } from '@/backend/trpc/routes/admin';
import { aiRouter } from '@/backend/trpc/routes/ai';
import { channelsRouter } from '@/backend/trpc/routes/channels';
import { inventoryRouter } from '@/backend/trpc/routes/inventory';
import { labourRouter } from '@/backend/trpc/routes/labour';
import { analyticsRouter } from '@/backend/trpc/routes/analytics';
import { authRouter } from '@/backend/trpc/routes/auth';
import { bookingsRouter } from '@/backend/trpc/routes/bookings';
import { dockRouter } from '@/backend/trpc/routes/dock';
import { fulfillmentRouter } from '@/backend/trpc/routes/fulfillment';
import { messagingRouter } from '@/backend/trpc/routes/messaging';
import { notificationsRouter } from '@/backend/trpc/routes/notifications';
import { operationsRouter } from '@/backend/trpc/routes/operations';
import { opsRouter } from '@/backend/trpc/routes/ops';
import { paymentsRouter } from '@/backend/trpc/routes/payments';
import { shippingRouter } from '@/backend/trpc/routes/shipping';
import { servicesRouter } from '@/backend/trpc/routes/services';
import { warehousesRouter } from '@/backend/trpc/routes/warehouses';
import { wmsRouter } from '@/backend/trpc/routes/wms';
import { systemRouter } from '@/backend/trpc/routes/system';
import { uploadsRouter } from '@/backend/trpc/routes/uploads';

export const appRouter = createTRPCRouter({
  system: systemRouter,
  auth: authRouter,
  bookings: bookingsRouter,
  dock: dockRouter,
  fulfillment: fulfillmentRouter,
  admin: adminRouter,
  ai: aiRouter,
  channels: channelsRouter,
  inventory: inventoryRouter,
  labour: labourRouter,
  analytics: analyticsRouter,
  messaging: messagingRouter,
  notifications: notificationsRouter,
  operations: operationsRouter,
  ops: opsRouter,
  payments: paymentsRouter,
  services: servicesRouter,
  shipping: shippingRouter,
  warehouses: warehousesRouter,
  wms: wmsRouter,
  uploads: uploadsRouter,
});

export type AppRouter = typeof appRouter;
