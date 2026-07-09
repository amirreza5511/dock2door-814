"use client";

import { InvoicingView } from "@/components/invoicing-view";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export default function ForwarderInvoicingPage() {
  const companyId = useActiveCompanyId("FreightForwarder") ?? null;
  return (
    <InvoicingView
      companyId={companyId}
      roleLabel="Freight Forwarder"
      subtitle="Bill customers and track your forwarding accounting."
    />
  );
}
