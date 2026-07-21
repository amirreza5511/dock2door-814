import { getCurrentSessionContext } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";
import { FreightClient } from "./freight-client";

export default async function GlobalFreightPage() {
  const ctx = await getCurrentSessionContext();
  const role = (ctx.role as UserRole | null) ?? null;
  return <FreightClient role={role} />;
}
