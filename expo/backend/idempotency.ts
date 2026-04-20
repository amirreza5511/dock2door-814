import type { PoolClient } from 'pg';
import { db } from '@/backend/db';

export async function findIdempotentResponse<T>(
  key: string,
  scope: string,
): Promise<T | null> {
  const result = await db.query<{ response: T | null }>(
    `SELECT response FROM idempotency_keys WHERE key = $1 AND scope = $2`,
    [key, scope],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return row.response ?? null;
}

export async function storeIdempotentResponse<T>(
  client: PoolClient,
  params: { key: string; scope: string; userId: string | null; response: T },
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_keys (key, user_id, scope, response)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response`,
    [params.key, params.userId, params.scope, JSON.stringify(params.response)],
  );
}
