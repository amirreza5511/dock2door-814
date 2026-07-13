import React from 'react';
import { Stack } from 'expo-router';
import { Hammer } from 'lucide-react-native';
import MarketplaceProviderDashboard from '@/components/MarketplaceProviderDashboard';
import C from '@/constants/colors';

export default function RepairProviderDashboard() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MarketplaceProviderDashboard
        config={{
          kicker: 'Mobile Repair',
          tagline: 'Dispatch technicians & work crews on-site',
          primaryType: 'mobile_repair',
          icon: Hammer,
          accent: C.purple,
          jobNoun: 'repair job',
        }}
      />
    </>
  );
}
