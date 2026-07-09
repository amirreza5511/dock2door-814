"use client";

import { TeamView, GENERIC_COMPANY_ROLES } from "@/components/team-view";

export default function TruckingTeamPage() {
  return (
    <TeamView
      title="Team"
      companyType="TruckingCompany"
      roleOptions={GENERIC_COMPANY_ROLES}
      defaultRole="Staff"
    />
  );
}
