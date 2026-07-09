"use client";

import { RatesView } from "@/components/rates-view";
import { PRICING_VERTICALS } from "@/lib/hooks/use-pricing";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function WarehouseRatesPage() {
  const companyId = useActiveCompanyId("WarehouseProvider") ?? null;
  return <RatesView companyId={companyId} config={PRICING_VERTICALS.warehouse} roleLabel="Warehouse" />;
}
