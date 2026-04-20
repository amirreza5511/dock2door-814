import app from '@/backend/hono';

async function handler(request: Request): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const rewrittenUrl = new URL(incomingUrl.toString());
  if (rewrittenUrl.pathname.startsWith('/api/')) {
    rewrittenUrl.pathname = rewrittenUrl.pathname.slice('/api'.length);
  } else if (rewrittenUrl.pathname === '/api') {
    rewrittenUrl.pathname = '/';
  }

  console.log('[API Route]', request.method, incomingUrl.pathname, '->', rewrittenUrl.pathname);

  const forwarded = new Request(rewrittenUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.clone().arrayBuffer(),
  });

  try {
    return await app.fetch(forwarded);
  } catch (error) {
    console.log('[API Route] error', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
