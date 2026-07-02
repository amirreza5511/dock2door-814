import React from 'react';
import TeamManagement, { WAREHOUSE_COMPANY_ROLES } from '@/components/TeamManagement';

export default function WarehouseStaff() {
  return (
    <TeamManagement
      title="Staff"
      roleOptions={WAREHOUSE_COMPANY_ROLES}
      defaultRole="Receiver"
    />
  );
}
