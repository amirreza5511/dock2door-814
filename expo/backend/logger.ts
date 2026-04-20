import { env } from '@/backend/env';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

function emit(level: Level, message: string, fields: LogFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: 'dock2door-api',
    env: env.nodeEnv,
    message,
    ...fields,
  };
  const serialized = JSON.stringify(entry);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
  if (level === 'error' && process.env.SENTRY_DSN) {
    void fetch(`${process.env.SENTRY_DSN.replace(/\/$/, '')}/api/store/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serialized,
    }).catch(() => undefined);
  }
}

export const logger = {
  debug: (message: string, fields: LogFields = {}) => emit('debug', message, fields),
  info: (message: string, fields: LogFields = {}) => emit('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => emit('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => emit('error', message, fields),
  child: (bindings: LogFields) => ({
    debug: (message: string, fields: LogFields = {}) => emit('debug', message, { ...bindings, ...fields }),
    info: (message: string, fields: LogFields = {}) => emit('info', message, { ...bindings, ...fields }),
    warn: (message: string, fields: LogFields = {}) => emit('warn', message, { ...bindings, ...fields }),
    error: (message: string, fields: LogFields = {}) => emit('error', message, { ...bindings, ...fields }),
  }),
};
