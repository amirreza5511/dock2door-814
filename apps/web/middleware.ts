/**
 * Next.js Middleware — Supabase session refresh + auth guard.
 *
 * WHY THIS EXISTS
 * ---------------
 * Without this middleware the Supabase session token is never refreshed by the
 * Edge runtime.  After the access-token TTL (~1 h), every Server Component call
 * to `supabase.auth.getUser()` returns null — even though the user has a valid
 * refresh token — because the token-refresh dance can only happen here, in the
 * middleware, where we can read AND write response cookies.
 *
 * DO NOT remove the `supabase.auth.getUser()` call.  It triggers the refresh.
 *
 * PROTECTED ROUTES
 * ----------------
 * Any path that is not "/" or "/login" requires an authenticated session.
 * Unauthenticated visitors are redirected to /login.
 * Authenticated users hitting /login are redirected to /dashboard.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// These are baked in at build time by next.config.mjs (falls back to the
// project-level Rork proxy URL / anon key when env vars are absent).
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://hyargzciywuqhlcaorwy.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_qHc_d78l_CCiTI-KBrlo_w_bz2eh8wz";

export async function middleware(request: NextRequest) {
  // We must create a new response object that mirrors the request cookies so
  // that the cookie-refresh writes land on the SAME response object we return.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write the refreshed cookies back onto both the request (for Server
        // Components that run after middleware) and the response (for the browser).
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: getUser() triggers the token refresh.  Do not remove it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isPublicRoute = pathname === "/" || pathname.startsWith("/login");

  // Redirect unauthenticated visitors away from protected routes.
  if (!user && !isPublicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Preserve the intended destination so we can redirect back after sign-in.
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from the login page.
  if (user && pathname === "/login") {
    const dest = request.nextUrl.searchParams.get("next") ?? "/dashboard";
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = dest;
    dashUrl.search = "";
    return NextResponse.redirect(dashUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match every path except:
     *   _next/static   — bundled JS/CSS
     *   _next/image    — Next.js image optimisation
     *   favicon.ico    — browser favicon request
     *   static assets  — svg, png, jpg, jpeg, gif, webp
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
