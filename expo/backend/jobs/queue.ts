import { db } from '@/backend/db';
import { logger } from '@/backend/logger';

export type JobKind = 'notification.push' | 'notification.email' | 'webhook.retry' | 'carrier.tracking_sync' | 'channel.sync';

interface JobRecord {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  status: 'Pending' | 'Running' | 'Completed' | 'Failed';
  run_at: string;
  last_error: string | null;
  created_at: string;
}

let schemaReady = false;

async function ensureJobTable(): Promise<void> {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'Pending',
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_background_jobs_status_run_at ON background_jobs(status, run_at);
  `);
  schemaReady = true;
}

export async function enqueueJob(kind: JobKind, payload: Record<string, unknown>, options: { delayMs?: number; maxAttempts?: number } = {}): Promise<string> {
  await ensureJobTable();
  const id = crypto.randomUUID();
  const runAt = new Date(Date.now() + (options.delayMs ?? 0)).toISOString();
  await db.query(
    `INSERT INTO background_jobs (id, kind, payload, max_attempts, run_at)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [id, kind, JSON.stringify(payload), options.maxAttempts ?? 5, runAt],
  );
  logger.info('job.enqueued', { jobId: id, kind, runAt });
  return id;
}

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers: Partial<Record<JobKind, JobHandler>> = {};

export function registerJobHandler(kind: JobKind, handler: JobHandler): void {
  handlers[kind] = handler;
}

async function runJob(job: JobRecord): Promise<void> {
  const handler = handlers[job.kind];
  if (!handler) {
    await db.query(
      `UPDATE background_jobs SET status = 'Failed', last_error = 'No handler registered', updated_at = NOW() WHERE id = $1`,
      [job.id],
    );
    logger.warn('job.no_handler', { jobId: job.id, kind: job.kind });
    return;
  }
  const started = Date.now();
  try {
    await handler(job.payload);
    await db.query(
      `UPDATE background_jobs SET status = 'Completed', attempts = attempts + 1, updated_at = NOW() WHERE id = $1`,
      [job.id],
    );
    logger.info('job.completed', { jobId: job.id, kind: job.kind, durationMs: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts + 1;
    const failed = attempts >= job.max_attempts;
    const backoffMs = Math.min(60_000 * 2 ** attempts, 30 * 60_000);
    await db.query(
      `UPDATE background_jobs
       SET status = $1, attempts = $2, last_error = $3, run_at = $4, updated_at = NOW()
       WHERE id = $5`,
      [
        failed ? 'Failed' : 'Pending',
        attempts,
        message,
        failed ? job.run_at : new Date(Date.now() + backoffMs).toISOString(),
        job.id,
      ],
    );
    logger.error('job.failed', { jobId: job.id, kind: job.kind, attempts, failed, error: message });
  }
}

let workerStarted = false;

export async function startJobWorker(options: { intervalMs?: number; batchSize?: number } = {}): Promise<void> {
  if (workerStarted) return;
  workerStarted = true;
  await ensureJobTable();
  const intervalMs = options.intervalMs ?? 5000;
  const batchSize = options.batchSize ?? 5;

  const tick = async (): Promise<void> => {
    try {
      const claim = await db.query<JobRecord>(
        `WITH picked AS (
           SELECT id FROM background_jobs
           WHERE status = 'Pending' AND run_at <= NOW()
           ORDER BY run_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE background_jobs
         SET status = 'Running', updated_at = NOW()
         WHERE id IN (SELECT id FROM picked)
         RETURNING *`,
        [batchSize],
      );
      for (const job of claim.rows) {
        await runJob(job);
      }
    } catch (error) {
      logger.error('job.tick_failed', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setTimeout(() => { void tick(); }, intervalMs);
    }
  };

  void tick();
  logger.info('job.worker_started', { intervalMs, batchSize });
}
