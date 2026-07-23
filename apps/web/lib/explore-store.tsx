"use client";

/**
 * Web "Explore mode" — mirrors the mobile app's `expo/store/explore.ts`.
 *
 * Lets a visitor browse any role's real dashboards with sample/public data —
 * no account required. It is intentionally session-only (a session cookie, no
 * Max-Age), so a fresh browser always starts signed-out and non-exploring.
 *
 * The mode is backed by a session cookie `d2d_explore=<role>|<domain>` so that
 * server components (middleware + the (app) layout) can detect it and render
 * the dashboard shell without an authenticated session. Any real action (post,
 * quote, accept, book, save, pay) is intercepted by the action gate, which
 * invites the visitor to create an account.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { UserRole } from "@/lib/types";
import type { Domain } from "@/lib/explore-catalog";

export const EXPLORE_COOKIE = "d2d_explore";

interface ExploreState {
  isExploring: boolean;
  exploreRole: UserRole | null;
  exploreDomain: Domain | null;
  gateAction: string | null;
  startExplore: (role: UserRole, domain: Domain) => void;
  stopExplore: () => void;
  requestAction: (label: string) => void;
  dismissGate: () => void;
}

const ExploreContext = createContext<ExploreState | null>(null);

/** Serialize/parse the session cookie value. */
function readCookie(): { role: UserRole; domain: Domain } | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${EXPLORE_COOKIE}=`));
  if (!match) return null;
  const raw = decodeURIComponent(match.slice(EXPLORE_COOKIE.length + 1));
  const [role, domain] = raw.split("|");
  if (!role || !domain) return null;
  return { role: role as UserRole, domain: domain as Domain };
}

function writeCookie(role: UserRole, domain: Domain) {
  // Session cookie (no Max-Age/Expires) — cleared when the browser closes.
  document.cookie = `${EXPLORE_COOKIE}=${encodeURIComponent(`${role}|${domain}`)}; path=/; SameSite=Lax`;
}

function clearCookie() {
  document.cookie = `${EXPLORE_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Provider for explore mode. Accepts an optional initial value (read from the
 * cookie server-side) so the very first render already knows the explore role,
 * avoiding a flash of the wrong shell.
 */
export function ExploreProvider({
  children,
  initialRole = null,
  initialDomain = null,
}: {
  children: React.ReactNode;
  initialRole?: UserRole | null;
  initialDomain?: Domain | null;
}) {
  const [exploreRole, setExploreRole] = useState<UserRole | null>(initialRole);
  const [exploreDomain, setExploreDomain] = useState<Domain | null>(initialDomain);
  const [gateAction, setGateAction] = useState<string | null>(null);

  // Re-sync from the cookie on mount (client navigations keep it in sync).
  useEffect(() => {
    if (initialRole) return;
    const c = readCookie();
    if (c) {
      setExploreRole(c.role);
      setExploreDomain(c.domain);
    }
  }, [initialRole]);

  const startExplore = useCallback((role: UserRole, domain: Domain) => {
    writeCookie(role, domain);
    setExploreRole(role);
    setExploreDomain(domain);
    setGateAction(null);
  }, []);

  const stopExplore = useCallback(() => {
    clearCookie();
    setExploreRole(null);
    setExploreDomain(null);
    setGateAction(null);
  }, []);

  const requestAction = useCallback((label: string) => {
    setGateAction(label);
  }, []);

  const dismissGate = useCallback(() => {
    setGateAction(null);
  }, []);

  const value = useMemo<ExploreState>(
    () => ({
      isExploring: Boolean(exploreRole),
      exploreRole,
      exploreDomain,
      gateAction,
      startExplore,
      stopExplore,
      requestAction,
      dismissGate,
    }),
    [exploreRole, exploreDomain, gateAction, startExplore, stopExplore, requestAction, dismissGate],
  );

  return <ExploreContext.Provider value={value}>{children}</ExploreContext.Provider>;
}

export function useExplore(): ExploreState {
  const ctx = useContext(ExploreContext);
  if (!ctx) {
    throw new Error("useExplore must be used within an ExploreProvider");
  }
  return ctx;
}

/**
 * Returns a guard function. In explore mode it intercepts the real action and
 * opens the account gate (returns false = "don't run the real action"); when
 * not exploring it returns true so the caller runs the action normally.
 *
 *   const guard = useActionGuard();
 *   onClick={() => { if (guard("Post this load")) doRealThing(); }}
 */
export function useActionGuard(): (label: string) => boolean {
  const { isExploring, requestAction } = useExplore();
  return useCallback(
    (label: string) => {
      if (isExploring) {
        requestAction(label);
        return false;
      }
      return true;
    },
    [isExploring, requestAction],
  );
}

/** Client-safe route entry: begin exploring a role then navigate to its dashboard. */
export function startExploreCookie(role: UserRole, domain: Domain) {
  writeCookie(role, domain);
}
