import React from 'react';
import TruckingSettlementScreen from '@/app/trucking-company/settlement';

/**
 * Drayage companies pay drivers with the same model as trucking companies
 * (hourly / percent / flat) and see the same FSC + profit rollups. The screen is
 * company-scoped via the backend (active company_id), so we reuse it directly.
 */
export default function DrayageSettlementScreen() {
  return <TruckingSettlementScreen />;
}
