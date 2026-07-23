import { cookies } from "next/headers";
import { getCurrentSessionContext } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";
import { EXPLORE_COOKIE } from "@/lib/explore-store";
import { FreightClient } from "./freight-client";

export default async function GlobalFreightPage() {
  const ctx = await getCurrentSessionContext();
  let role = (ctx.role as UserRole | null) ?? null;
  if (!role) {
    const raw = (await cookies()).get(EXPLORE_COOKIE)?.value ?? null;
    if (raw) role = (decodeURIComponent(raw).split("|")[0] as UserRole) ?? null;
  }
  return <FreightClient role={role} />;
}
