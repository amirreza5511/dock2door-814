import { initTRPC, TRPCError } from '@trpc/server';
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import superjson from 'superjson';
import { ensureSchema } from '@/backend/db';
import { getUserById, toSessionUser, verifyAccessToken, type SessionUser } from '@/backend/auth';

function parseBearerToken(request: Request): string | null {
  const authorizationHeader = request.headers.get('authorization');
  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice(7);
  }

  return null;
}

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  await ensureSchema();

  let user: SessionUser | null = null;
  const bearerToken = parseBearerToken(opts.req);

  if (bearerToken) {
    try {
      const payload = verifyAccessToken(bearerToken);
      const userRow = await getUserById(payload.sub);
      if (userRow && userRow.status === 'Active') {
        user = toSessionUser(userRow);
      }
    } catch (error) {
      console.log('[tRPC] Failed to parse auth token', error);
    }
  }

  return {
    req: opts.req,
    requestId: opts.req.headers.get('x-request-id') ?? crypto.randomUUID(),
    user,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});
