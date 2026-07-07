import React from 'react';
import RatesManagerScreen from '@/components/pricing/RatesManagerScreen';
import { PRICING_VERTICALS } from '@/constants/pricing';

export default function WarehouseRatesScreen() {
  return <RatesManagerScreen config={PRICING_VERTICALS.warehouse} />;
}
