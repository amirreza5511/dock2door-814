import { createTRPCReact } from '@trpc/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@/backend/trpc/app-router';
import { getAccessToken } from '@/lib/session';

export const trpc = createTRPCReact<AppRouter>();

function getBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_RORK_API_BASE_URL;

  if (!url) {
    throw new Error('Missing EXPO_PUBLIC_RORK_API_BASE_URL');
  }

  return url;
}

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
      headers() {
        const accessToken = getAccessToken();
        return accessToken ? { authorization: `Bearer ${accessToken}` } : {};
      },
    }),
  ],
});
