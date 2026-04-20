import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { assertCompanyAccess } from '@/backend/access';
import { requireAuthUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { notifyCompanyMembers, notifyUser } from '@/backend/events';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';

interface ThreadRow {
  id: string;
  company_id: string | null;
  booking_id: string | null;
  appointment_id: string | null;
  scope: 'Booking' | 'Appointment' | 'Dispute' | 'Direct' | 'Internal';
  subject: string | null;
  created_at: string;
  updated_at: string;
}

export const messagingRouter = createTRPCRouter({
  listThreads: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    return user.role === 'Admin' || user.role === 'SuperAdmin'
      ? queryRows(`SELECT message_threads.*, (
          SELECT body FROM messages WHERE messages.thread_id = message_threads.id AND messages.deleted_at IS NULL ORDER BY created_at DESC LIMIT 1
        ) AS last_message
        FROM message_threads WHERE deleted_at IS NULL ORDER BY updated_at DESC`, [])
      : queryRows(`SELECT message_threads.*, (
          SELECT body FROM messages WHERE messages.thread_id = message_threads.id AND messages.deleted_at IS NULL ORDER BY created_at DESC LIMIT 1
        ) AS last_message
        FROM message_threads WHERE company_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC`, [user.companyId]);
  }),
  createThread: protectedProcedure.input(z.object({ companyId: z.string().nullable().optional(), bookingId: z.string().nullable().optional(), appointmentId: z.string().nullable().optional(), scope: z.enum(['Booking', 'Appointment', 'Dispute', 'Direct', 'Internal']), subject: z.string().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const companyId = input.companyId ?? user.companyId;
    assertCompanyAccess(user, companyId);
    const id = crypto.randomUUID();

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO message_threads (id, company_id, booking_id, appointment_id, scope, subject)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, companyId, input.bookingId ?? null, input.appointmentId ?? null, input.scope, input.subject ?? null],
      );
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId,
        entityName: 'message_threads',
        entityId: id,
        action: 'create',
        newValue: input,
        requestId: ctx.requestId,
      });
    });

    return { id };
  }),
  getThread: protectedProcedure.input(z.object({ threadId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const thread = await queryRow<ThreadRow>('SELECT * FROM message_threads WHERE id = $1 AND deleted_at IS NULL', [input.threadId]);
    if (!thread) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
    }
    assertCompanyAccess(user, thread.company_id);
    return thread;
  }),
  listMessages: protectedProcedure.input(z.object({ threadId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const thread = await queryRow<ThreadRow>('SELECT * FROM message_threads WHERE id = $1 AND deleted_at IS NULL', [input.threadId]);
    if (!thread) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
    }
    assertCompanyAccess(user, thread.company_id);
    return queryRows('SELECT * FROM messages WHERE thread_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC', [input.threadId]);
  }),
  sendMessage: protectedProcedure.input(z.object({ threadId: z.string(), body: z.string().min(1), attachments: z.array(z.object({ id: z.string(), url: z.string().nullable().optional(), name: z.string().nullable().optional() })).default([]) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const thread = await queryRow<ThreadRow>('SELECT * FROM message_threads WHERE id = $1 AND deleted_at IS NULL', [input.threadId]);
    if (!thread) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
    }
    assertCompanyAccess(user, thread.company_id);

    const messageId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO messages (id, thread_id, company_id, sender_user_id, body, attachments, read_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [messageId, input.threadId, thread.company_id, user.id, input.body.trim(), JSON.stringify(input.attachments), JSON.stringify([user.id])],
      );
      await client.query('UPDATE message_threads SET updated_at = NOW() WHERE id = $1', [input.threadId]);
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId: thread.company_id,
        entityName: 'messages',
        entityId: messageId,
        action: 'create',
        newValue: { threadId: input.threadId, body: input.body },
        requestId: ctx.requestId,
      });

      if (thread.booking_id) {
        const booking = await client.query<{ company_id: string; provider_company_id: string | null }>(
          'SELECT company_id, provider_company_id FROM bookings WHERE id = $1', [thread.booking_id],
        );
        const row = booking.rows[0];
        if (row) {
          const target = user.companyId === row.company_id ? row.provider_company_id : row.company_id;
          if (target) {
            await notifyCompanyMembers(client, {
              companyId: target,
              eventKey: 'message.new',
              title: 'New message',
              body: input.body.slice(0, 140),
              metadata: { threadId: input.threadId, bookingId: thread.booking_id },
            });
          }
        }
      } else if (thread.company_id && thread.company_id !== user.companyId) {
        await notifyCompanyMembers(client, {
          companyId: thread.company_id,
          eventKey: 'message.new',
          title: 'New message',
          body: input.body.slice(0, 140),
          metadata: { threadId: input.threadId },
        });
      } else {
        await notifyUser(client, {
          userId: user.id,
          companyId: thread.company_id,
          eventKey: 'message.new',
          title: 'New message',
          body: input.body.slice(0, 140),
          metadata: { threadId: input.threadId },
        });
      }
    });

    return { id: messageId };
  }),
  markThreadRead: protectedProcedure.input(z.object({ threadId: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const thread = await queryRow<ThreadRow>('SELECT * FROM message_threads WHERE id = $1 AND deleted_at IS NULL', [input.threadId]);
    if (!thread) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
    }
    assertCompanyAccess(user, thread.company_id);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE messages
         SET read_by = CASE
           WHEN read_by @> $1::jsonb THEN read_by
           ELSE read_by || $1::jsonb
         END,
         updated_at = NOW()
         WHERE thread_id = $2 AND deleted_at IS NULL`,
        [JSON.stringify([user.id]), input.threadId],
      );
    });
    return { success: true };
  }),
});
