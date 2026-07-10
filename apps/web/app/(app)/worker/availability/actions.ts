"use server";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Availability server actions.
 *
 * WHY THESE EXIST
 * ---------------
 * Some worker networks/regions cannot reach Supabase (Cloudflare) directly from
 * the browser, so client-side `supabase.rpc(...)` calls fail with
 * "TypeError: Failed to fetch" before any response is received. Routing the
 * reads and writes through our own Next.js server (same-origin) fixes this: the
 * server (Vercel) reaches Supabase fine and authenticates via the session cookie.
 */

export interface AvailabilityRow {
  id: string;
  worker_user_id: string;
  date: string;
  start_time: string;
  end_time: string;
  kind: "available" | "unavailable" | "preferred";
  preferred_area: string | null;
  preferred_category: string | null;
  notes: string | null;
}

export type DayMode = "default" | "custom" | "off";

/** Fetch this worker's upcoming availability rows (today onward). */
export async function getMyAvailability(): Promise<AvailabilityRow[]> {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("worker_availability")
    .select("id,worker_user_id,date,start_time,end_time,kind,preferred_area,preferred_category,notes")
    .eq("worker_user_id", user.id)
    .gte("date", today)
    .order("date");
  if (error) throw new Error(error.message);
  return (data ?? []) as AvailabilityRow[];
}

/**
 * Set a single day's availability. Clears any existing rows for that date first
 * so we never leave stale slots behind, then writes the new state:
 *   - "default": no row (available on default 8–17 hours)
 *   - "off":     an all-day `unavailable` row
 *   - "custom":  an `available` row with the chosen start/end
 */
export async function saveAvailabilityDay(payload: {
  date: string;
  mode: DayMode;
  start: string;
  end: string;
}): Promise<{ ok: true }> {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You are signed out. Please sign in again.");

  // Clear existing rows for this date.
  const { data: existing, error: readErr } = await supabase
    .from("worker_availability")
    .select("id")
    .eq("worker_user_id", user.id)
    .eq("date", payload.date);
  if (readErr) throw new Error(readErr.message);

  for (const r of existing ?? []) {
    const { error } = await supabase.rpc("delete_my_availability", { p_id: (r as { id: string }).id });
    if (error) throw new Error(error.message);
  }

  if (payload.mode === "default") return { ok: true };

  if (payload.mode === "off") {
    const { error } = await supabase.rpc("set_my_availability", {
      p_date: payload.date, p_start: "00:00", p_end: "23:59",
      p_kind: "unavailable", p_preferred_area: null, p_preferred_category: null, p_notes: "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  const { error } = await supabase.rpc("set_my_availability", {
    p_date: payload.date, p_start: payload.start, p_end: payload.end,
    p_kind: "available", p_preferred_area: null, p_preferred_category: null, p_notes: "",
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}
