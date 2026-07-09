"use client";

import { InvoicingView } from "@/components/invoicing-view";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function ServiceProviderInvoicingPage() {
  const companyId = useActiveCompanyId("ServiceProvider") ?? null;
  return (
    <InvoicingView
      companyId={companyId}
      roleLabel="Service Provider"
      subtitle="Bill customers for completed jobs and track your accounting."
    />
  );
}
