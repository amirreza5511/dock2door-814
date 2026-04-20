import { serve } from '@hono/node-server';
import app from '@/backend/hono';
import { env } from '@/backend/env';
import { ensureSchema } from '@/backend/db';

const port = Number(process.env.PORT ?? 3000);

async function bootstrap(): Promise<void> {
  await ensureSchema();
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[Server] Dock2Door API listening on http://localhost:${info.port}`);
    console.log(`[Server] NODE_ENV=${env.nodeEnv}`);
  });
}

void bootstrap();
