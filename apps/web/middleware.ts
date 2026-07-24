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
  // Expose the pathname to Server Components (the (app) layout uses it to
  // allow guests into the public Help Center + AI assistant, like the app).
  request.headers.set("x-pathname", request.nextUrl.pathname);

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

  // Explore mode: a session cookie `d2d_explore` lets a no-account visitor
  // browse any role's real dashboard shell (read-only, sample/public data).
  // Any real write is intercepted client-side by the action gate.
  const isExploring = Boolean(request.cookies.get("d2d_explore")?.value);

  // Build a redirect that PRESERVES the Supabase auth cookies just refreshed on
  // `supabaseResponse`. Plain `NextResponse.redirect` returns a fresh response
  // with NO cookies, so the rotated tokens never reach the browser, the session
  // breaks, and the user bounces in a loop between /login and their destination.
  const redirectWithCookies = (url: URL): NextResponse => {
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      res.cookies.set(cookie);
    });
    return res;
  };

  // `/t/<token>` is the public, no-account tracking page for receivers.
  // `/auth/*` hosts the password-recovery flow (the recovery code is exchanged
  // client-side, so the middleware sees no session yet).
  const isPublicRoute =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/t/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/explore") ||
    pathname.startsWith("/directory") ||
    pathname.startsWith("/ship") ||
    pathname.startsWith("/international") ||
    pathname.startsWith("/ground-freight") ||
    // Help Center + AI assistant are guest-accessible, same as the mobile app.
    pathname.startsWith("/help");

  // Admin & super-admin areas are NEVER explorable — real privileged surfaces.
  const isPrivilegedRoute =
    pathname.startsWith("/admin") || pathname.startsWith("/super-admin");

  // Redirect unauthenticated visitors away from protected routes, unless they
  // are exploring a (non-privileged) role dashboard without an account.
  if (!user && !isPublicRoute && !(isExploring && !isPrivilegedRoute)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Preserve the intended destination so we can redirect back after sign-in.
    loginUrl.searchParams.set("next", pathname);
    return redirectWithCookies(loginUrl);
  }

  // Redirect authenticated users away from the login page.
  if (user && pathname === "/login") {
    const dest = request.nextUrl.searchParams.get("next") ?? "/dashboard";
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = dest;
    dashUrl.search = "";
    return redirectWithCookies(dashUrl);
  }

  // -------------------------------------------------------------------
  // Server-side admin / super-admin route guard.
  //
  // Routes under /admin/* require ANY platform role (admin OR super_admin)
  // OR profile.role IN ('Admin','SuperAdmin').
  // Routes under /super-admin/* require super_admin specifically
  // (or profile.role === 'SuperAdmin').
  //
  // RLS still enforces this on every RPC/table read, but blocking at the
  // edge prevents the unauthorized UI shell from ever rendering and stops
  // accidental data leaks via cached pages.
  // -------------------------------------------------------------------
  if (user) {
    const isAdminRoute = pathname.startsWith("/admin");
    const isSuperAdminRoute = pathname.startsWith("/super-admin");
    if (isAdminRoute || isSuperAdminRoute) {
      const [profileRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      const profileRole = (profileRes.data as { role?: string | null } | null)?.role ?? null;
      const platformRoles = ((rolesRes.data ?? []) as { role: string }[]).map((r) => r.role);
      const isAdmin = platformRoles.includes("admin") || profileRole === "Admin" || profileRole === "SuperAdmin";
      const isSuperAdmin = platformRoles.includes("super_admin") || profileRole === "SuperAdmin";

      const allowed = isSuperAdminRoute ? isSuperAdmin : (isAdmin || isSuperAdmin);
      if (!allowed) {
        const denyUrl = request.nextUrl.clone();
        denyUrl.pathname = "/dashboard";
        denyUrl.search = "?denied=1";
        return redirectWithCookies(denyUrl);
      }
    }
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
