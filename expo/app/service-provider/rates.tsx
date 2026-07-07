import React from 'react';
import RatesManagerScreen from '@/components/pricing/RatesManagerScreen';
import { PRICING_VERTICALS } from '@/constants/pricing';

export default function ServiceProviderRatesScreen() {
  return <RatesManagerScreen config={PRICING_VERTICALS.service} />;
}
