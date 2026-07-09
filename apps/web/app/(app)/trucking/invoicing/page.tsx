"use client";

import { InvoicingView } from "@/components/invoicing-view";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function TruckingInvoicingPage() {
  const companyId = useActiveCompanyId("TruckingCompany") ?? null;
  return (
    <InvoicingView
      companyId={companyId}
      roleLabel="Trucking Company"
      subtitle="Bill customers and track your trucking accounting."
    />
  );
}
