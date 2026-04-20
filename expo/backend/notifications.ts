import { env } from '@/backend/env';
import { queryRows } from '@/backend/db';

interface PushTokenRow {
  expo_push_token: string;
}

export async function sendExpoPushNotification(userId: string, title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
  const rows = await queryRows<PushTokenRow>('SELECT expo_push_token FROM expo_push_tokens WHERE user_id = $1 AND deleted_at IS NULL', [userId]);
  if (rows.length === 0) {
    return;
  }

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(env.expoPushAccessToken ? { Authorization: `Bearer ${env.expoPushAccessToken}` } : {}),
    },
    body: JSON.stringify(
      rows.map((row) => ({
        to: row.expo_push_token,
        title,
        body,
        data,
        sound: 'default',
      })),
    ),
  });
}

export async function sendEmailNotification(to: string, subject: string, html: string): Promise<void> {
  if (!env.resendApiKey || !env.emailFrom) {
    return;
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to,
      subject,
      html,
    }),
  });
}
