import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';

/**
 * Fire the AI watchdog automatically when a company dashboard mounts.
 * The scan is throttled server-side (once per window per company via
 * ai_maybe_run_watchdog), so calling this on every dashboard is safe and
 * keeps the alerts feed fresh without the user opening the Copilot.
 */
export function useAutoWatchdog(minMinutes = 30): void {
  const maybeRun = trpc.ai.maybeRunWatchdog.useMutation();
  const firedRef = useRef<boolean>(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    maybeRun.mutate({ minMinutes }, { onError: () => undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
