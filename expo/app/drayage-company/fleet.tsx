import React from 'react';
import TruckingFleetScreen from '@/app/trucking-company/fleet';

/**
 * Drayage companies manage the same fleet entities (drivers, trucks, trailers,
 * containers) as trucking companies. The underlying screen is company-scoped via
 * the backend (company_id), so we reuse it directly here. This lives under the
 * drayage-company segment so the route guard lets DrayageCompany users in.
 */
export default function DrayageFleetScreen() {
  return <TruckingFleetScreen />;
}
