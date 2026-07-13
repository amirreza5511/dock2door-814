import React from 'react';
import { Stack } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import MarketplaceProviderDashboard from '@/components/MarketplaceProviderDashboard';
import C from '@/constants/colors';

export default function CargoInsurerDashboard() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MarketplaceProviderDashboard
        config={{
          kicker: 'Cargo Insurance',
          tagline: 'Insure freight & shipments by cargo value',
          primaryType: 'cargo_insurance',
          icon: ShieldCheck,
          accent: C.yellow,
          jobNoun: 'policy request',
        }}
      />
    </>
  );
}
