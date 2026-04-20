import { z } from 'zod';
import { requireAuthUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { withTransaction } from '@/backend/db';
import { createPresignedUpload } from '@/backend/storage';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';

const uploadKindSchema = z.enum(['POD', 'Document', 'Attachment', 'WarehousePhoto', 'Invoice', 'Certification']);

export const uploadsRouter = createTRPCRouter({
  createPresignedUrl: protectedProcedure.input(z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), sizeBytes: z.number().int().positive(), kind: uploadKindSchema })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const objectKey = `${user.companyId ?? 'public'}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${input.fileName.replace(/\s+/g, '-')}`;
    const target = await createPresignedUpload(objectKey, input.mimeType);
    return { ...target, maxSizeBytes: input.sizeBytes };
  }),
  confirmUpload: protectedProcedure.input(z.object({ objectKey: z.string().min(1), originalName: z.string().min(1), mimeType: z.string().min(1), sizeBytes: z.number().int().positive(), kind: uploadKindSchema, publicUrl: z.string().url().nullable().optional(), metadata: z.record(z.string(), z.any()).optional() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const id = crypto.randomUUID();

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO files (id, company_id, uploaded_by_user_id, kind, object_key, original_name, mime_type, size_bytes, storage_provider, public_url, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [id, user.companyId, user.id, input.kind, input.objectKey, input.originalName, input.mimeType, input.sizeBytes, process.env.STORAGE_PROVIDER ?? 'local', input.publicUrl ?? null, JSON.stringify(input.metadata ?? {})],
      );
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId: user.companyId,
        entityName: 'files',
        entityId: id,
        action: 'confirm_upload',
        newValue: input,
        requestId: ctx.requestId,
      });
    });

    return { id };
  }),
});
