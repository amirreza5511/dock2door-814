import type { PoolClient } from 'pg';

interface AuditLogInput {
  actorUserId: string | null;
  companyId: string | null;
  entityName: string;
  entityId: string;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  requestId?: string | null;
}

export async function createAuditLog(client: PoolClient, input: AuditLogInput): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (id, actor_user_id, company_id, entity_name, entity_id, action, previous_value, new_value, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [
      crypto.randomUUID(),
      input.actorUserId,
      input.companyId,
      input.entityName,
      input.entityId,
      input.action,
      input.previousValue ? JSON.stringify(input.previousValue) : null,
      input.newValue ? JSON.stringify(input.newValue) : null,
      input.requestId ?? null,
    ],
  );
}
