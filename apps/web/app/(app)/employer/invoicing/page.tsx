"use client";

import { InvoicingView } from "@/components/invoicing-view";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function EmployerInvoicingPage() {
  const companyId = useActiveCompanyId("Employer") ?? null;
  return (
    <InvoicingView
      companyId={companyId}
      roleLabel="Employer"
      subtitle="Bill clients and track your labour accounting."
    />
  );
}
