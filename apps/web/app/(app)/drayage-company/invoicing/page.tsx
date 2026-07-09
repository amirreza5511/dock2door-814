"use client";

import { InvoicingView } from "@/components/invoicing-view";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function DrayageInvoicingPage() {
  const companyId = useActiveCompanyId("DrayageCompany") ?? null;
  return (
    <InvoicingView
      companyId={companyId}
      roleLabel="Drayage Company"
      subtitle="Bill customers and track your drayage accounting."
    />
  );
}
