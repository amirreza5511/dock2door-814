import { getCurrentSessionContext } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";
import { GroundFreightClient } from "./ground-client";

export default async function GroundFreightPage() {
  const ctx = await getCurrentSessionContext();
  const role = (ctx.role as UserRole | null) ?? null;
  return <GroundFreightClient role={role} />;
}
