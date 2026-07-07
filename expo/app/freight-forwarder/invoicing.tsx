import React from 'react';
import InvoicingScreen from '@/components/InvoicingScreen';
import { useAuthStore } from '@/store/auth';

export default function ForwarderInvoicingScreen() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? null);
  return <InvoicingScreen title="Invoicing" subtitle="Bill customers and track your forwarding accounting." providerCompanyId={companyId} />;
}
