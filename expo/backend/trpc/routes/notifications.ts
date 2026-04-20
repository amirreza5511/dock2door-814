import { z } from 'zod';
import { requireAuthUser } from '@/backend/auth';
import { sendExpoPushNotification } from '@/backend/notifications';
import { queryRows, withTransaction } from '@/backend/db';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';

export const notificationsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    return queryRows('SELECT * FROM notifications WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [user.id]);
  }),
  registerPushToken: protectedProcedure.input(z.object({ expoPushToken: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO expo_push_tokens (id, user_id, expo_push_token)
         VALUES ($1, $2, $3)
         ON CONFLICT (expo_push_token) DO UPDATE SET deleted_at = NULL`,
        [crypto.randomUUID(), user.id, input.expoPushToken],
      );
    });
    return { success: true };
  }),
  create: protectedProcedure.input(z.object({ userId: z.string(), title: z.string().min(1), body: z.string().min(1), channel: z.string().default('in_app') })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO notifications (id, user_id, company_id, title, body, channel, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)`,
        [crypto.randomUUID(), input.userId, user.companyId, input.title, input.body, input.channel],
      );
    });
    await sendExpoPushNotification(input.userId, input.title, input.body, { createdBy: user.id });
    return { success: true };
  }),
  markRead: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await withTransaction(async (client) => {
      await client.query('UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2', [input.id, user.id]);
    });
    return { success: true };
  }),
});
