import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { generateObject, generateText } from '@rork-ai/toolkit-sdk';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAdmin, requireAuthUser } from '@/backend/auth';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { createAuditLog } from '@/backend/audit';
import { logger } from '@/backend/logger';

interface WarehouseRow {
  id: string;
  name: string;
  city: string;
  warehouse_type: string;
  available_pallet_capacity: number;
  storage_rate_per_pallet: string;
}

interface MessageRow {
  id: string;
  body: string;
  sender_user_id: string;
  created_at: string;
  translations: Record<string, string> | null;
}

interface AuditRow {
  id: string;
  action: string;
  entity_name: string;
  entity_id: string;
  new_value: unknown;
  created_at: string;
}

export const aiRouter = createTRPCRouter({
  recommendWarehouses: protectedProcedure.input(z.object({
    query: z.string().min(3).max(500),
    city: z.string().max(80).optional(),
    pallets: z.number().int().positive().optional(),
    warehouseType: z.enum(['Dry', 'Chill', 'Frozen']).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const clauses: string[] = [`status = 'Available'`, `deleted_at IS NULL`];
    const params: unknown[] = [];
    if (input.city) { params.push(input.city); clauses.push(`city ILIKE $${params.length}`); }
    if (input.pallets) { params.push(input.pallets); clauses.push(`available_pallet_capacity >= $${params.length}`); }
    if (input.warehouseType) { params.push(input.warehouseType); clauses.push(`warehouse_type = $${params.length}`); }
    const warehouses = await queryRows<WarehouseRow>(
      `SELECT id, name, city, warehouse_type, available_pallet_capacity,
              storage_rate_per_pallet::text AS storage_rate_per_pallet
       FROM warehouse_listings WHERE ${clauses.join(' AND ')}
       ORDER BY storage_rate_per_pallet ASC LIMIT 30`,
      params,
    );
    if (warehouses.length === 0) {
      return { recommendations: [], summary: 'No warehouses currently match those criteria.' };
    }

    try {
      const result = await generateObject({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Recommend up to 5 warehouses for this request from a Vancouver-area customer. Return the top matches ordered by best fit, each with a one-sentence rationale.\n\nCustomer request: ${input.query}\nFilters: city=${input.city ?? 'any'}, pallets=${input.pallets ?? 'any'}, type=${input.warehouseType ?? 'any'}\n\nAvailable warehouses:\n${warehouses.map((w) => `- id=${w.id}, name=${w.name}, city=${w.city}, type=${w.warehouse_type}, pallets=${w.available_pallet_capacity}, rate=$${w.storage_rate_per_pallet}`).join('\n')}`,
              },
            ],
          },
        ],
        schema: z.object({
          summary: z.string(),
          recommendations: z.array(z.object({
            id: z.string(),
            rationale: z.string(),
            score: z.number().min(0).max(100),
          })).max(5),
        }),
      });
      const ids = new Set(warehouses.map((w) => w.id));
      const filtered = result.recommendations.filter((r) => ids.has(r.id));
      return {
        summary: result.summary,
        recommendations: filtered.map((r) => {
          const w = warehouses.find((x) => x.id === r.id)!;
          return { ...r, name: w.name, city: w.city, warehouseType: w.warehouse_type, ratePerPallet: Number(w.storage_rate_per_pallet) };
        }),
      };
    } catch (error) {
      logger.error('ai.recommend_failed', { error: error instanceof Error ? error.message : String(error), userId: user.id });
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI recommendation failed' });
    }
  }),

  translateMessage: protectedProcedure.input(z.object({
    messageId: z.string(),
    targetLanguage: z.string().min(2).max(10),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const message = await queryRow<MessageRow & { thread_id: string }>(
      `SELECT m.id, m.body, m.sender_user_id, m.created_at, m.thread_id,
              COALESCE((m.attachments->>'translations')::jsonb, '{}'::jsonb) AS translations
       FROM messages m WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [input.messageId],
    );
    if (!message) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });

    const thread = await queryRow<{ company_id: string | null }>(
      `SELECT company_id FROM message_threads WHERE id = $1`, [message.thread_id],
    );
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && thread?.company_id && thread.company_id !== user.companyId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied to this thread' });
    }

    const existing = message.translations ?? {};
    if (existing[input.targetLanguage]) {
      return { original: message.body, translated: existing[input.targetLanguage], targetLanguage: input.targetLanguage, cached: true };
    }

    const translated = await generateText({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Translate the following message into ${input.targetLanguage}. Preserve meaning and tone. Respond with only the translation, no commentary.\n\n${message.body}` }],
        },
      ],
    });

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE messages
         SET attachments = jsonb_set(COALESCE(attachments, '{}'::jsonb), '{translations}',
           COALESCE(attachments->'translations', '{}'::jsonb) || jsonb_build_object($2::text, $3::text), true),
             updated_at = NOW()
         WHERE id = $1`,
        [message.id, input.targetLanguage, translated],
      );
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId: thread?.company_id ?? null,
        entityName: 'messages',
        entityId: message.id,
        action: 'translate',
        newValue: { targetLanguage: input.targetLanguage },
        requestId: ctx.requestId,
      });
    });

    return { original: message.body, translated, targetLanguage: input.targetLanguage, cached: false };
  }),

  adminAnomalySummary: protectedProcedure.input(z.object({
    hours: z.number().int().positive().max(168).default(24),
  })).query(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    const audits = await queryRows<AuditRow>(
      `SELECT id, action, entity_name, entity_id, new_value, created_at
       FROM audit_logs
       WHERE created_at >= NOW() - ($1::text || ' hours')::interval
       ORDER BY created_at DESC LIMIT 200`,
      [String(input.hours)],
    );
    const disputes = await queryRows<{ id: string; status: string; description: string; created_at: string }>(
      `SELECT id, status, description, created_at FROM disputes
       WHERE created_at >= NOW() - ($1::text || ' hours')::interval AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [String(input.hours)],
    );
    const failedPayments = await queryRows<{ id: string; gross_amount: string; created_at: string }>(
      `SELECT id, gross_amount::text AS gross_amount, created_at FROM payments
       WHERE status = 'Failed' AND created_at >= NOW() - ($1::text || ' hours')::interval
       ORDER BY created_at DESC`,
      [String(input.hours)],
    );

    if (audits.length === 0 && disputes.length === 0 && failedPayments.length === 0) {
      return { summary: `No notable activity in the last ${input.hours}h.`, bullets: [], severity: 'low' as const };
    }

    try {
      const result = await generateObject({
        messages: [
          {
            role: 'user',
            content: [{
              type: 'text',
              text: `Review this platform activity from the last ${input.hours} hours and surface anything suspicious or operationally important. Be concise; facts only.\n\nAudit (first 30):\n${audits.slice(0, 30).map((a) => `- ${a.created_at} ${a.action} ${a.entity_name}:${a.entity_id}`).join('\n') || 'none'}\n\nDisputes:\n${disputes.map((d) => `- ${d.status}: ${d.description.slice(0, 120)}`).join('\n') || 'none'}\n\nFailed payments:\n${failedPayments.map((p) => `- $${p.gross_amount} at ${p.created_at}`).join('\n') || 'none'}`,
            }],
          },
        ],
        schema: z.object({
          summary: z.string(),
          severity: z.enum(['low', 'medium', 'high']),
          bullets: z.array(z.string()).max(8),
        }),
      });
      return result;
    } catch (error) {
      logger.error('ai.anomaly_failed', { error: error instanceof Error ? error.message : String(error) });
      return {
        summary: `${audits.length} audit events, ${disputes.length} disputes, ${failedPayments.length} failed payments in the last ${input.hours}h. AI summary unavailable.`,
        bullets: [],
        severity: (disputes.length > 0 || failedPayments.length > 3 ? 'high' : 'medium') as 'low' | 'medium' | 'high',
      };
    }
  }),
});
