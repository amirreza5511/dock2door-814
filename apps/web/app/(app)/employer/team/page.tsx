"use client";

import { TeamView } from "@/components/team-view";

export default function EmployerTeamPage() {
  return (
    <TeamView
      title="Team"
      subtitle="Invite staff and manage who can post shifts and confirm hours."
      companyType="Employer"
    />
  );
}
