import { registerJobHandler } from '@/backend/jobs/queue';
import { sendEmailNotification, sendExpoPushNotification } from '@/backend/notifications';
import { logger } from '@/backend/logger';
import { db } from '@/backend/db';

registerJobHandler('notification.push', async (payload) => {
  const userId = String(payload.userId ?? '');
  const title = String(payload.title ?? '');
  const body = String(payload.body ?? '');
  const data = (payload.data && typeof payload.data === 'object' ? payload.data : {}) as Record<string, unknown>;
  if (!userId || !title) return;
  await sendExpoPushNotification(userId, title, body, data);
});

registerJobHandler('notification.email', async (payload) => {
  const to = String(payload.to ?? '');
  const subject = String(payload.subject ?? '');
  const html = String(payload.html ?? '');
  if (!to || !subject) return;
  await sendEmailNotification(to, subject, html);
});

registerJobHandler('webhook.retry', async (payload) => {
  const url = String(payload.url ?? '');
  const body = payload.body ?? {};
  if (!url) return;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Webhook ${url} failed with ${response.status}`);
  }
});

registerJobHandler('carrier.tracking_sync', async (payload) => {
  const shipmentId = String(payload.shipmentId ?? '');
  if (!shipmentId) return;
  logger.info('job.carrier_tracking_sync.placeholder', { shipmentId });
});

registerJobHandler('channel.sync', async (payload) => {
  const connectionId = String(payload.connectionId ?? '');
  if (!connectionId) return;
  await db.query(
    `UPDATE channel_connections SET last_sync_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [connectionId],
  );
});
