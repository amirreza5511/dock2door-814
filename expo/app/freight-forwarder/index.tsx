import React from 'react';
import ContainerOrdersScreen from '@/components/drayage/ContainerOrdersScreen';

export default function FreightForwarderHome() {
  return (
    <ContainerOrdersScreen
      detailPath="/freight-forwarder/[orderId]"
      showBack={false}
      subtitle="Import & export containers — post and track live"
      ratesPath="/freight-forwarder/rates"
    />
  );
}
