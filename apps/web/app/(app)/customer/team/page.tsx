"use client";

import { TeamView } from "@/components/team-view";

export default function CustomerTeamPage() {
  return (
    <TeamView
      title="Team"
      subtitle="Invite colleagues and manage who can act on your account."
      companyType="Customer"
    />
  );
}
