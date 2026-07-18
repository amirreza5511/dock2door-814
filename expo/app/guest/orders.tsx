import React from 'react';
import ContainerOrdersScreen from '@/components/drayage/ContainerOrdersScreen';

/** Guests can post and track container drayage orders like any customer. */
export default function GuestOrdersScreen() {
  return (
    <ContainerOrdersScreen
      detailPath="/guest/order/[orderId]"
      showBack={false}
      subtitle="Guest orders — prepaid, with guest surcharge"
      clearancePath="/clearance"
    />
  );
}
