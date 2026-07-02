import React from 'react';
import TeamManagement, { GENERIC_COMPANY_ROLES } from '@/components/TeamManagement';

export default function EmployerTeam() {
  return (
    <TeamManagement
      title="Team"
      roleOptions={GENERIC_COMPANY_ROLES}
      defaultRole="Staff"
    />
  );
}
