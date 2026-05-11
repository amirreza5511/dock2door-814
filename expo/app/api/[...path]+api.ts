/**
 * Legacy API route stub.
 *
 * The Hono/tRPC backend has been replaced with direct Supabase calls.
 * This file exists only to satisfy Expo Router's file-system routing; it
 * returns 404 for every request so no server traffic accidentally hits it.
 *
 * Do NOT import anything from @/backend here — those packages (hono, pg,
 * stripe, etc.) are Node-only and will crash the Metro bundler if included
 * in the client bundle.
 */

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
export const HEAD = notFound;
