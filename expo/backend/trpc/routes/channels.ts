import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { getChannel, listImplementedChannels } from '@/backend/channels';
import type { ChannelKind } from '@/backend/channels';
import { enqueueJob } from '@/backend/jobs/queue';
import { logger } from '@/backend/logger';

const channelKindSchema = z.enum(['Shopify', 'WooCommerce', 'AmazonSPAPI', 'Manual']);

interface ChannelRow {
  id: string;
  kind: ChannelKind;
  name: string;
}

interface ConnectionRow {
  id: string;
  company_id: string;
  channel_id: string;
  credentials: Record<string, unknown>;
  status: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

async function ensureChannelRow(kind: ChannelKind): Promise<ChannelRow> {
  const existing = await queryRow<ChannelRow>(
    `SELECT id, kind::text AS kind, name FROM channels WHERE kind = $1::channel_kind LIMIT 1`,
    [kind],
  );
  if (existing) return existing;
  const id = crypto.randomUUID();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO channels (id, kind, name) VALUES ($1, $2::channel_kind, $3)`,
      [id, kind, kind],
    );
  });
  return { id, kind, name: kind };
}

export const channelsRouter = createTRPCRouter({
  listImplemented: protectedProcedure.query(() => {
    return listImplementedChannels();
  }),

  listConnections: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && !user.companyId) {
      return [];
    }
    const rows = user.role === 'Admin' || user.role === 'SuperAdmin'
      ? await queryRows<ConnectionRow & { kind: ChannelKind }>(
          `SELECT cc.*, c.kind::text AS kind FROM channel_connections cc
           INNER JOIN channels c ON c.id = cc.channel_id
           ORDER BY cc.updated_at DESC`, [],
        )
      : await queryRows<ConnectionRow & { kind: ChannelKind }>(
          `SELECT cc.*, c.kind::text AS kind FROM channel_connections cc
           INNER JOIN channels c ON c.id = cc.channel_id
           WHERE cc.company_id = $1 ORDER BY cc.updated_at DESC`, [user.companyId],
        );
    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      kind: row.kind,
      status: row.status,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
      credentialsPresent: Object.keys(row.credentials ?? {}).length > 0,
    }));
  }),

  connect: protectedProcedure.input(z.object({
    kind: channelKindSchema,
    credentials: z.record(z.string(), z.any()),
    displayName: z.string().max(120).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Company context required' });
    }
    const channel = await ensureChannelRow(input.kind);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO channel_connections (id, company_id, channel_id, credentials, status)
         VALUES ($1, $2, $3, $4::jsonb, 'Active')
         ON CONFLICT (company_id, channel_id) DO UPDATE SET
           credentials = EXCLUDED.credentials,
           status = 'Active',
           updated_at = NOW()`,
        [id, user.companyId, channel.id, JSON.stringify(input.credentials)],
      );
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId: user.companyId,
        entityName: 'channel_connections',
        entityId: id,
        action: 'connect',
        newValue: { kind: input.kind, displayName: input.displayName ?? null },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  disconnect: protectedProcedure.input(z.object({ connectionId: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const row = await queryRow<ConnectionRow>(`SELECT * FROM channel_connections WHERE id = $1`, [input.connectionId]);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
    const isAdmin = user.role === 'Admin' || user.role === 'SuperAdmin';
    if (!isAdmin && row.company_id !== user.companyId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE channel_connections SET status = 'Disconnected', updated_at = NOW() WHERE id = $1`, [input.connectionId]);
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId: row.company_id,
        entityName: 'channel_connections',
        entityId: input.connectionId,
        action: 'disconnect',
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  syncOrders: protectedProcedure.input(z.object({ connectionId: z.string(), bookingId: z.string().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const row = await queryRow<ConnectionRow & { kind: ChannelKind }>(
      `SELECT cc.*, c.kind::text AS kind FROM channel_connections cc
       INNER JOIN channels c ON c.id = cc.channel_id
       WHERE cc.id = $1`, [input.connectionId],
    );
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
    const isAdmin = user.role === 'Admin' || user.role === 'SuperAdmin';
    if (!isAdmin && row.company_id !== user.companyId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    let imported = 0;
    try {
      const adapter = getChannel(row.kind);
      const orders = await adapter.importOrders(
        { connectionId: row.id, companyId: row.company_id, credentials: row.credentials ?? {} },
        { since: row.last_sync_at },
      );
      for (const order of orders) {
        await withTransaction(async (client) => {
          const existing = await client.query<{ id: string; order_id: string | null }>(
            `SELECT id, order_id FROM external_orders WHERE channel_connection_id = $1 AND external_order_id = $2`,
            [row.id, order.externalOrderId],
          );
          if (existing.rows[0]) {
            await client.query(
              `UPDATE external_orders SET raw_payload = $1::jsonb WHERE id = $2`,
              [JSON.stringify(order.raw), existing.rows[0].id],
            );
            return;
          }
          await client.query(
            `INSERT INTO external_orders (id, channel_connection_id, external_order_id, raw_payload)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [crypto.randomUUID(), row.id, order.externalOrderId, JSON.stringify(order.raw)],
          );
          imported += 1;
        });
      }
      await withTransaction(async (client) => {
        await client.query(`UPDATE channel_connections SET last_sync_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
      });
      await enqueueJob('channel.sync', { connectionId: row.id }, { delayMs: 15 * 60 * 1000 });
      return { imported };
    } catch (error) {
      logger.error('channel.sync_failed', { connectionId: row.id, error: error instanceof Error ? error.message : String(error) });
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error instanceof Error ? error.message : 'Channel sync failed' });
    }
  }),

  pushFulfillment: protectedProcedure.input(z.object({
    connectionId: z.string(),
    externalOrderId: z.string(),
    trackingNumber: z.string(),
    carrier: z.string().max(40),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const row = await queryRow<ConnectionRow & { kind: ChannelKind }>(
      `SELECT cc.*, c.kind::text AS kind FROM channel_connections cc
       INNER JOIN channels c ON c.id = cc.channel_id
       WHERE cc.id = $1`, [input.connectionId],
    );
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
    const isAdmin = user.role === 'Admin' || user.role === 'SuperAdmin';
    if (!isAdmin && row.company_id !== user.companyId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    const adapter = getChannel(row.kind);
    await adapter.pushFulfillment(
      { connectionId: row.id, companyId: row.company_id, credentials: row.credentials ?? {} },
      { externalOrderId: input.externalOrderId, trackingNumber: input.trackingNumber, carrier: input.carrier },
    );
    return { success: true };
  }),
});
