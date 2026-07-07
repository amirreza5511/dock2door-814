import React from 'react';
import InvoicingScreen from '@/components/InvoicingScreen';
import { useAuthStore } from '@/store/auth';

export default function EmployerInvoicingScreen() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? null);
  return <InvoicingScreen title="Invoicing" subtitle="Bill clients and track your labour accounting." providerCompanyId={companyId} />;
}
