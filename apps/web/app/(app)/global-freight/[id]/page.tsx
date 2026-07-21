import { getCurrentSessionContext } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";
import { FreightDetailClient } from "./detail-client";

export default async function GlobalFreightDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCurrentSessionContext();
  const role = (ctx.role as UserRole | null) ?? null;
  const name = (ctx.profile as { name?: string } | null)?.name ?? null;
  return <FreightDetailClient quoteId={id} role={role} userName={name} />;
}
