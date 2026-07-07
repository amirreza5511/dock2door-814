import React from 'react';
import InvoicingScreen from '@/components/InvoicingScreen';
import { useAuthStore } from '@/store/auth';

export default function TruckingInvoicingScreen() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? null);
  return <InvoicingScreen title="Invoicing" subtitle="Bill customers and track your trucking accounting." providerCompanyId={companyId} />;
}
