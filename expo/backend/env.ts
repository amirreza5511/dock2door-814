import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('*'),
  APP_WEB_URL: z.string().url().default('http://localhost:8081'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CURRENCY: z.string().default('cad'),
  STORAGE_PROVIDER: z.enum(['s3', 'local']).default('local'),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  STORAGE_LOCAL_PATH: z.string().default('/app/uploads'),
  EXPO_PUSH_ACCESS_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  COOKIE_DOMAIN: z.string().optional(),
  SECURE_COOKIES: z.coerce.boolean().default(true),
  NGINX_SERVER_NAME: z.string().default('localhost'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.log('[Env] Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid backend environment variables');
}

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  databaseUrl: parsed.data.DATABASE_URL,
  jwtAccessSecret: parsed.data.JWT_ACCESS_SECRET,
  jwtRefreshSecret: parsed.data.JWT_REFRESH_SECRET,
  jwtAccessTtl: parsed.data.JWT_ACCESS_TTL,
  jwtRefreshTtl: parsed.data.JWT_REFRESH_TTL,
  apiBaseUrl: parsed.data.API_BASE_URL,
  corsOrigin: parsed.data.CORS_ORIGIN,
  appWebUrl: parsed.data.APP_WEB_URL,
  stripeSecretKey: parsed.data.STRIPE_SECRET_KEY,
  stripeWebhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET,
  stripeCurrency: parsed.data.STRIPE_CURRENCY,
  storageProvider: parsed.data.STORAGE_PROVIDER,
  storageBucket: parsed.data.STORAGE_BUCKET,
  storageRegion: parsed.data.STORAGE_REGION,
  storageEndpoint: parsed.data.STORAGE_ENDPOINT,
  storageAccessKeyId: parsed.data.STORAGE_ACCESS_KEY_ID,
  storageSecretAccessKey: parsed.data.STORAGE_SECRET_ACCESS_KEY,
  storagePublicBaseUrl: parsed.data.STORAGE_PUBLIC_BASE_URL,
  storageLocalPath: parsed.data.STORAGE_LOCAL_PATH,
  expoPushAccessToken: parsed.data.EXPO_PUSH_ACCESS_TOKEN,
  resendApiKey: parsed.data.RESEND_API_KEY,
  emailFrom: parsed.data.EMAIL_FROM,
  rateLimitWindowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: parsed.data.RATE_LIMIT_MAX_REQUESTS,
  cookieDomain: parsed.data.COOKIE_DOMAIN,
  secureCookies: parsed.data.SECURE_COOKIES,
  nginxServerName: parsed.data.NGINX_SERVER_NAME,
} as const;

export type BackendEnv = typeof env;
