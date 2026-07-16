import React from 'react';
import FuelSurchargeScreen from '@/components/FuelSurchargeScreen';

/**
 * Drayage companies set the same monthly fuel surcharge as trucking companies.
 * The backend RPCs are company-scoped, so the shared screen works as-is.
 */
export default function DrayageFuelSurcharge() {
  return <FuelSurchargeScreen subtitle="Monthly percent added to freight on your container invoices" />;
}
