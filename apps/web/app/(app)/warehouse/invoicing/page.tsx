"use client";

import { InvoicingView } from "@/components/invoicing-view";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function WarehouseInvoicingPage() {
  const companyId = useActiveCompanyId("WarehouseProvider") ?? null;
  return (
    <InvoicingView
      companyId={companyId}
      roleLabel="Warehouse"
      subtitle="Bill customers and track your warehouse accounting."
    />
  );
}
