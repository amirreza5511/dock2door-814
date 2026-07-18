import React from 'react';
import ContainerOrdersScreen from '@/components/drayage/ContainerOrdersScreen';

export default function CustomerDrayageScreen() {
  return <ContainerOrdersScreen detailPath="/customer/drayage/[orderId]" showBack clearancePath="/clearance" />;
}
