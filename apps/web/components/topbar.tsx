import { SignOutButton } from "./sign-out-button";
import { Badge } from "./ui/badge";
import type { UserRole } from "@/lib/types";

export function Topbar({ email, role }: { email: string | null; role: UserRole | null }) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div className="text-sm text-muted-foreground">
        Operations Console
      </div>
      <div className="flex items-center gap-3">
        {role && <Badge variant="secondary">{role}</Badge>}
        <span className="text-sm text-foreground/80">{email ?? "—"}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
