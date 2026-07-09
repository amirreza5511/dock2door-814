"use client";

import { RatesView } from "@/components/rates-view";
import { PRICING_VERTICALS } from "@/lib/hooks/use-pricing";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function EmployerRatesPage() {
  const companyId = useActiveCompanyId("Employer") ?? null;
  return <RatesView companyId={companyId} config={PRICING_VERTICALS.labor} roleLabel="Employer" />;
}
