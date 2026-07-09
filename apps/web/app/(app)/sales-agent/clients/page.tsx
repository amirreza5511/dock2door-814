"use client";

import Link from "next/link";
import { Building2, ChevronRight, UserPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { useSalesClients, money, type SalesClient } from "@/lib/hooks/use-sales";

const STATUS_STYLE: Record<SalesClient["onboardStatus"], string> = {
  "Signed up": "bg-blue-500/15 text-blue-400",
  "Setting up": "bg-yellow-500/15 text-yellow-400",
  Active: "bg-emerald-500/15 text-emerald-400",
};

export default function SalesClientsPage() {
  const q = useSalesClients();
  const clients = q.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My clients</h1>
          <p className="text-sm text-muted-foreground">{clients.length} onboarded business{clients.length === 1 ? "" : "es"}</p>
        </div>
        <Button asChild>
          <Link href="/sales-agent/onboard"><UserPlus className="mr-2 h-4 w-4" /> Onboard a client</Link>
        </Button>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : clients.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No clients yet</CardTitle>
            <CardDescription>Share your referral code or onboard a business to start building your book.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/sales-agent/onboard"><UserPlus className="mr-2 h-4 w-4" /> Onboard your first client</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/sales-agent/clients/${c.id}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="grid h-11 w-11 place-items-center rounded-lg bg-muted"><Building2 className="h-5 w-5 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{c.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[c.onboardStatus]}`}>{c.onboardStatus}</span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.vertical || "—"}{c.city ? ` · ${c.city}` : ""} · joined {formatDate(c.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-emerald-400">{money(c.earned)}</p>
                    <p className="text-[11px] text-muted-foreground">earned</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
