/**
 * Guest explore entry — GET /explore/start?role=<UserRole>&domain=<Domain>
 *
 * Sets the `d2d_explore` session cookie SERVER-SIDE and redirects straight to
 * the role's dashboard. This is the bulletproof entry point for explore mode:
 * a plain link/full navigation, so the cookie is guaranteed to be present on
 * the very next request — no client-side cookie race, no stale router cache,
 * no bounce to /login.
 *
 * Admin / SuperAdmin are never explorable: they simply have no entry in
 * EXPLORE_ROLE_ROUTE, so any attempt falls back to the landing page.
 */

import { NextResponse, type NextRequest } from "next/server";
import { EXPLORE_ROLE_ROUTE } from "@/lib/explore-catalog";

const VALID_DOMAINS = [
  "labour",
  "logistics",
  "freight",
  "drayage",
  "marketplace",
  "globalfreight",
] as const;

export function GET(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role") ?? "";
  const domain = request.nextUrl.searchParams.get("domain") ?? "";

  const route = EXPLORE_ROLE_ROUTE[role];
  const isValidDomain = (VALID_DOMAINS as readonly string[]).includes(domain);

  const url = request.nextUrl.clone();
  url.search = "";

  if (!route || !isValidDomain) {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  url.pathname = route;
  const res = NextResponse.redirect(url);
  // Session cookie (no Max-Age) — cleared when the browser closes, mirroring
  // the mobile app's session-only explore mode.
  res.cookies.set("d2d_explore", `${role}|${domain}`, {
    path: "/",
    sameSite: "lax",
  });
  return res;
}
