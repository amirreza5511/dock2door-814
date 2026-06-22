import createContextHook from '@nkzw/create-context-hook';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSegments } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { type Domain, domainForSegment, visibleDomains } from '@/lib/access';

/**
 * Session-only holder for the user's currently active world (Labour / Logistics).
 *
 * It is intentionally NOT persisted to AsyncStorage: on a fresh load the world is
 * re-inferred from the active route segment, and falls back to the user's single
 * visible world. This keeps the switcher in sync after deep links / refresh while
 * never affecting data, permissions, or backend calls — it is pure UI grouping.
 */
export const [CurrentWorldProvider, useCurrentWorld] = createContextHook(() => {
  const user = useAuthStore((s) => s.user);
  const segments = useSegments();
  const [currentWorld, setCurrentWorldState] = useState<Domain | null>(null);

  const domains = useMemo<Domain[]>(() => visibleDomains(user), [user]);
  const canSwitch = domains.length > 1;

  const routeWorld = useMemo<Domain | null>(
    () => domainForSegment(segments[0] as string | undefined),
    [segments],
  );

  // Keep the active world in sync with the route the user is actually on, and
  // default single-world users to their only world. Never override an explicit
  // selection that still matches a visible world unless the route disagrees.
  useEffect(() => {
    if (!user) {
      setCurrentWorldState(null);
      return;
    }
    if (routeWorld && routeWorld !== currentWorld) {
      setCurrentWorldState(routeWorld);
      return;
    }
    if (!currentWorld) {
      setCurrentWorldState(domains[0] ?? null);
    }
  }, [user, routeWorld, currentWorld, domains]);

  const setCurrentWorld = useCallback(
    (world: Domain) => {
      if (!domains.includes(world)) {
        return;
      }
      setCurrentWorldState(world);
    },
    [domains],
  );

  return useMemo(
    () => ({
      currentWorld,
      domains,
      canSwitch,
      setCurrentWorld,
    }),
    [currentWorld, domains, canSwitch, setCurrentWorld],
  );
});
