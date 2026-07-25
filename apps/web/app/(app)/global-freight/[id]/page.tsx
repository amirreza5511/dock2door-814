import { cookies } from "next/headers";
import { getCurrentSessionContext } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";
import { EXPLORE_COOKIE } from "@/lib/explore-store";
import { FreightDetailClient } from "./detail-client";

export default async function GlobalFreightDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCurrentSessionContext();
  let role = (ctx.role as UserRole | null) ?? null;
  if (!role) {
    const raw = (await cookies()).get(EXPLORE_COOKIE)?.value ?? null;
    if (raw) role = (decodeURIComponent(raw).split("|")[0] as UserRole) ?? null;
  }
  const name = (ctx.profile as { name?: string } | null)?.name ?? null;
  return <FreightDetailClient quoteId={id} role={role} userName={name} />;
}
