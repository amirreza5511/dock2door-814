"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Check, Users, ClipboardList, Wallet, TrendingUp, UserPlus, Building2, CircleUser, CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMyAgent, useSalesDashboard, money } from "@/lib/hooks/use-sales";

export default function SalesAgentDashboardPage() {
  const agentQ = useMyAgent();
  const dashQ = useSalesDashboard();
  const [copied, setCopied] = useState<boolean>(false);

  const agent = agentQ.data;
  const dash = dashQ.data;
  const code = agent?.agent_code ?? "——————";

  const profileComplete = Boolean((agent?.phone ?? "").trim() && (agent?.territory ?? "").trim() && (agent?.payout_method ?? "").trim());

  const checklist = useMemo(
    () => [
      { key: "profile", label: "Complete your agent profile", done: profileComplete, href: "/sales-agent/profile" },
      { key: "code", label: "Share your referral code", done: (dash?.accounts ?? 0) > 0 || (dash?.leads ?? 0) > 0, href: "/sales-agent/onboard" },
      { key: "lead", label: "Add your first lead", done: (dash?.leads ?? 0) > 0, href: "/sales-agent/leads" },
      { key: "client", label: "Onboard your first client", done: (dash?.accounts ?? 0) > 0, href: "/sales-agent/onboard" },
    ],
    [profileComplete, dash?.accounts, dash?.leads],
  );
  const doneCount = checklist.filter((i) => i.done).length;
  const allDone = doneCount === checklist.length;

  const copyCode = useCallback(async () => {
    if (!agent?.agent_code) return;
    await navigator.clipboard.writeText(agent.agent_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [agent?.agent_code]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Sales Agent</p>
          <h1 className="text-2xl font-semibold tracking-tight">Your CRM</h1>
        </div>
        <Button asChild size="lg">
          <Link href="/sales-agent/onboard"><UserPlus className="mr-2 h-4 w-4" /> Onboard a new client</Link>
        </Button>
      </div>

      {/* Lifetime commission hero */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 to-transparent">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Lifetime commission</p>
          <p className="mt-1 text-4xl font-bold tracking-tight">{money(dash?.lifetime ?? 0)}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-yellow-500/15 px-3 py-1 text-xs font-semibold text-yellow-400">Pending {money(dash?.pending ?? 0)}</span>
            <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-400">Approved {money(dash?.approved ?? 0)}</span>
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">Paid {money(dash?.paid ?? 0)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Getting started checklist */}
      {!allDone && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Getting started</CardTitle>
            <span className="text-sm font-semibold text-primary">{doneCount}/{checklist.length}</span>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
            </div>
            {checklist.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent"
              >
                {item.done ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                <span className={item.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{item.label}</span>
                {!item.done && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Referral code */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your referral code</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-3xl font-bold tracking-[0.3em] text-primary">{code}</p>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Share this code. When a warehouse, driver, employer or company signs up with it, you get credit and the commission is added to your ledger automatically.
          </p>
          <div className="mt-4">
            <Button variant="outline" onClick={() => void copyCode()} disabled={!agent?.agent_code}>
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Copied" : "Copy code"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats + nav */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard icon={<Users className="h-5 w-5 text-blue-400" />} value={String(dash?.accounts ?? 0)} label="Accounts onboarded" />
        <StatCard icon={<ClipboardList className="h-5 w-5 text-purple-400" />} value={String(dash?.openLeads ?? 0)} label="Open leads" />
      </div>

      <div className="grid gap-3">
        <NavRow href="/sales-agent/clients" icon={<Building2 className="h-5 w-5 text-primary" />} title="My clients" subtitle={`${dash?.accounts ?? 0} onboarded · manage & track each one`} />
        <NavRow href="/sales-agent/leads" icon={<ClipboardList className="h-5 w-5 text-purple-400" />} title="My leads pipeline" subtitle={`${dash?.leads ?? 0} leads · track prospects to won`} />
        <NavRow href="/sales-agent/earnings" icon={<Wallet className="h-5 w-5 text-emerald-400" />} title="Commission ledger" subtitle="Every bounty, referral & recurring payout" />
        <NavRow href="/sales-agent/profile" icon={<CircleUser className="h-5 w-5 text-primary" />} title="Agent profile" subtitle={profileComplete ? "Contact & payout details set" : "Add your phone, territory & payout"} />
        <NavRow href="/sales-agent/earnings" icon={<TrendingUp className="h-5 w-5 text-blue-400" />} title="My commission plan" subtitle={agent?.plan?.name ?? "Default plan"} />
      </div>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="grid h-11 w-11 place-items-center rounded-lg bg-muted">{icon}</div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function NavRow({ href, icon, title, subtitle }: { href: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-primary/40">
        <CardContent className="flex items-center gap-4 py-4">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-muted">{icon}</div>
          <div className="flex-1">
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
