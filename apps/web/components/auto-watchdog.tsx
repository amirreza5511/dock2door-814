"use client";

import { useEffect, useRef } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Fires a throttled AI watchdog scan once per app mount. The throttle lives
 * server-side in ai_maybe_run_watchdog, so this is safe to mount globally and
 * degrades silently when the RPC isn't deployed yet.
 */
export function AutoWatchdog() {
  const ranRef = useRef<boolean>(false);
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const supabase = getBrowserSupabase();
    void (async () => {
      try {
        await supabase.rpc("ai_maybe_run_watchdog", { p_min_minutes: 30 });
      } catch {
        // No-op: RPC not deployed or user has no company yet.
      }
    })();
  }, []);
  return null;
}
