import type { PoolClient } from 'pg';
import { queryRows } from '@/backend/db';
import { sendExpoPushNotification } from '@/backend/notifications';

interface NotifyParams {
  userId: string;
  companyId?: string | null;
  title: string;
  body: string;
  channel?: 'in_app' | 'push' | 'email';
  metadata?: Record<string, unknown>;
}

export async function createNotification(client: PoolClient, params: NotifyParams): Promise<string> {
  const id = crypto.randomUUID();
  const channel = params.channel ?? 'in_app';
  await client.query(
    `INSERT INTO notifications (id, user_id, company_id, title, body, channel, metadata, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
    [id, params.userId, params.companyId ?? null, params.title, params.body, channel, JSON.stringify(params.metadata ?? {})],
  );
  return id;
}

interface PrefsRow {
  push_enabled: boolean;
  in_app_enabled: boolean;
  muted_events: unknown;
}

async function getPrefs(userId: string): Promise<{ push: boolean; inApp: boolean; muted: string[] }> {
  const rows = await queryRows<PrefsRow>(
    `SELECT push_enabled, in_app_enabled, muted_events FROM notification_preferences WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return { push: true, inApp: true, muted: [] };
  const muted = Array.isArray(row.muted_events) ? (row.muted_events as string[]) : [];
  return { push: row.push_enabled, inApp: row.in_app_enabled, muted };
}

export async function notifyCompanyMembers(
  client: PoolClient,
  params: {
    companyId: string | null;
    eventKey: string;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!params.companyId) return;
  const members = await queryRows<{ user_id: string }>(
    `SELECT user_id FROM company_members WHERE company_id = $1 AND status = 'Active'`,
    [params.companyId],
  );
  for (const m of members) {
    const prefs = await getPrefs(m.user_id);
    if (prefs.muted.includes(params.eventKey)) continue;
    if (prefs.inApp) {
      await createNotification(client, {
        userId: m.user_id,
        companyId: params.companyId,
        title: params.title,
        body: params.body,
        metadata: { ...(params.metadata ?? {}), eventKey: params.eventKey },
      });
    }
    if (prefs.push) {
      void sendExpoPushNotification(m.user_id, params.title, params.body, { eventKey: params.eventKey, ...(params.metadata ?? {}) })
        .catch((error) => console.log('[events] push failed', error));
    }
  }
}

export async function notifyUser(
  client: PoolClient,
  params: {
    userId: string;
    companyId?: string | null;
    eventKey: string;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const prefs = await getPrefs(params.userId);
  if (prefs.muted.includes(params.eventKey)) return;
  if (prefs.inApp) {
    await createNotification(client, {
      userId: params.userId,
      companyId: params.companyId ?? null,
      title: params.title,
      body: params.body,
      metadata: { ...(params.metadata ?? {}), eventKey: params.eventKey },
    });
  }
  if (prefs.push) {
    void sendExpoPushNotification(params.userId, params.title, params.body, { eventKey: params.eventKey, ...(params.metadata ?? {}) })
      .catch((error) => console.log('[events] push failed', error));
  }
}
