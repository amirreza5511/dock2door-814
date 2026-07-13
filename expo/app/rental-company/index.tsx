import React from 'react';
import { Stack } from 'expo-router';
import { Forklift } from 'lucide-react-native';
import MarketplaceProviderDashboard from '@/components/MarketplaceProviderDashboard';
import C from '@/constants/colors';

export default function RentalCompanyDashboard() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MarketplaceProviderDashboard
        config={{
          kicker: 'Equipment Rental',
          tagline: 'Rent out forklifts, cranes, hoists & heavy machinery',
          primaryType: 'equipment_rental',
          icon: Forklift,
          accent: C.blue,
          jobNoun: 'rental request',
        }}
      />
    </>
  );
}
