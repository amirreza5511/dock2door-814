"use client";

import { RatesView } from "@/components/rates-view";
import { PRICING_VERTICALS } from "@/lib/hooks/use-pricing";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function DrayageRatesPage() {
  const companyId = useActiveCompanyId("DrayageCompany") ?? null;
  return <RatesView companyId={companyId} config={PRICING_VERTICALS.trucking} roleLabel="Drayage Company" />;
}
