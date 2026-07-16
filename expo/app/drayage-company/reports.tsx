import React from 'react';
import TruckingReportsScreen from '@/app/trucking-company/reports';

/**
 * Drayage reports mirror trucking: on-time %, fleet use, revenue, FSC collected,
 * driver/fuel cost, profit and per-driver performance. Data is company-scoped via
 * the backend (active company_id), so we reuse the screen directly.
 */
export default function DrayageReportsScreen() {
  return <TruckingReportsScreen />;
}
