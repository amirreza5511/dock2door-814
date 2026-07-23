"use client";

import Link from "next/link";
import { Sparkles, UserPlus } from "lucide-react";
import { useExplore } from "@/lib/explore-store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Account gate — shown when a visitor in explore mode tries a real action.
 * Mirrors the mobile app's action gate: a friendly invite to create an account.
 */
export function ExploreGate() {
  const { gateAction, dismissGate } = useExplore();
  const open = Boolean(gateAction);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismissGate(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <DialogTitle>Create a free account to continue</DialogTitle>
          <DialogDescription>
            {gateAction
              ? `“${gateAction}” needs an account. Sign up free to unlock this — it takes less than a minute, and everything you explored stays exactly the same.`
              : "Sign up free to unlock this action."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={dismissGate}>
            Keep exploring
          </Button>
          <Link href="/login?next=/dashboard">
            <Button className="w-full gap-2">
              <UserPlus className="h-4 w-4" /> Create a free account
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
