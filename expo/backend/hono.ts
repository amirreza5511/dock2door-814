import { trpcServer } from '@hono/trpc-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from '@/backend/env';
import { appRouter } from '@/backend/trpc/app-router';
import { createContext } from '@/backend/trpc/create-context';
import { ensureSchema } from '@/backend/db';
import { stripeWebhookHandler } from '@/backend/stripe';
import { startJobWorker } from '@/backend/jobs/queue';
import '@/backend/jobs/handlers';
import { logger } from '@/backend/logger';

const app = new Hono();

const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() ?? 'unknown';
  }

  return request.headers.get('x-real-ip') ?? 'unknown';
}

app.use('*', cors({
  origin: env.corsOrigin === '*' ? '*' : env.corsOrigin,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  exposeHeaders: ['x-request-id'],
  credentials: true,
}));

let workerBootstrapped = false;

app.use('*', async (context, next) => {
  const requestId = crypto.randomUUID();
  context.header('x-request-id', requestId);
  await ensureSchema();
  if (!workerBootstrapped) {
    workerBootstrapped = true;
    void startJobWorker().catch((error) => logger.error('job.worker_bootstrap_failed', { error: error instanceof Error ? error.message : String(error) }));
  }
  const started = Date.now();
  await next();
  logger.info('http.request', {
    requestId,
    method: context.req.method,
    path: context.req.path,
    status: context.res.status,
    durationMs: Date.now() - started,
  });
});

app.use('*', async (context, next) => {
  const now = Date.now();
  const clientIp = getClientIp(context.req.raw);
  const current = rateLimitState.get(clientIp);

  if (!current || current.resetAt <= now) {
    rateLimitState.set(clientIp, { count: 1, resetAt: now + env.rateLimitWindowMs });
    await next();
    return;
  }

  if (current.count >= env.rateLimitMaxRequests) {
    return context.json({ error: 'Too many requests' }, 429);
  }

  current.count += 1;
  rateLimitState.set(clientIp, current);
  await next();
});

app.get('/', (context) => {
  return context.json({
    status: 'ok',
    service: 'dock2door-api',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.post('/stripe/webhook', stripeWebhookHandler);

app.use(
  '/trpc/*',
  trpcServer({
    endpoint: '/api/trpc',
    router: appRouter,
    createContext,
  }),
);

export default app;
