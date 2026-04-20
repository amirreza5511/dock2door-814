import React from 'react';
import FinanceScreen from '@/components/FinanceScreen';

export default function CustomerBilling() {
  return <FinanceScreen title="Billing" subtitle="Your payments and invoices, live from the platform." showPayouts={false} />;
}
