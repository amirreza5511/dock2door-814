"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Check, Share2, Warehouse, Truck, Ship, Users, Package, User, Send, ClipboardList } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMyAgent } from "@/lib/hooks/use-sales";

interface BizType {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const BIZ_TYPES: BizType[] = [
  { key: "warehouse", label: "Warehouse provider", icon: Warehouse },
  { key: "drayage", label: "Drayage company", icon: Ship },
  { key: "freight-forwarder", label: "Freight forwarder", icon: Package },
  { key: "trucking", label: "Trucking company", icon: Truck },
  { key: "employer", label: "Employer (labour)", icon: Users },
  { key: "shipper", label: "Shipper / customer", icon: Package },
  { key: "driver", label: "Driver", icon: Truck },
  { key: "worker", label: "Warehouse worker", icon: User },
];

function signupBase(): string {
  if (typeof window !== "undefined") return `${window.location.origin}/login`;
  return "https://app.dock2door.com/login";
}

export default function OnboardClientPage() {
  const agentQ = useMyAgent();
  const code = agentQ.data?.agent_code ?? "";
  const [selected, setSelected] = useState<string>("warehouse");
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedMsg, setCopiedMsg] = useState<boolean>(false);

  const link = useMemo(() => {
    const params = new URLSearchParams();
    if (code) params.set("ref", code);
    if (selected) params.set("type", selected);
    return `${signupBase()}?${params.toString()}`;
  }, [code, selected]);

  const message = useMemo(
    () => `Join Dock2Door and get set up in minutes. Use my referral code ${code || "——"} when you sign up: ${link}`,
    [code, link],
  );

  async function copy(text: string, which: "link" | "msg") {
    await navigator.clipboard.writeText(text);
    if (which === "link") { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 1800); }
    else { setCopiedMsg(true); setTimeout(() => setCopiedMsg(false), 1800); }
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try { await navigator.share({ title: "Join Dock2Door", text: message, url: link }); } catch { /* cancelled */ }
    } else {
      await copy(message, "msg");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Onboard a new client</h1>
        <p className="text-sm text-muted-foreground">Invite a business to join with your code pre-filled — they&apos;re credited to you automatically.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · What kind of business?</CardTitle>
          <CardDescription>This tailors their signup and how commission is tracked.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {BIZ_TYPES.map((b) => {
              const Icon = b.icon;
              const active = selected === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => setSelected(b.key)}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}
                >
                  <div className={`grid h-10 w-10 place-items-center rounded-lg ${active ? "bg-primary/20" : "bg-muted"}`}><Icon className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`} /></div>
                  <span className="text-sm font-medium">{b.label}</span>
                  {active && <Check className="ml-auto h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Send the invite</CardTitle>
          <CardDescription>Share this link or message. It carries your code <span className="font-mono font-semibold text-primary">{code || "——"}</span>.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Signup link</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">{link}</code>
              <Button variant="outline" size="sm" onClick={() => void copy(link, "link")}>
                {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Ready-to-send message</p>
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{message}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void nativeShare()}><Share2 className="mr-2 h-4 w-4" /> Share invite</Button>
            <Button variant="outline" onClick={() => void copy(message, "msg")}>
              {copiedMsg ? <Check className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
              {copiedMsg ? "Copied" : "Copy message"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not ready to invite yet?</CardTitle>
          <CardDescription>Log them as a lead and work the pipeline first — convert to an invite when they&apos;re ready.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild><Link href="/sales-agent/leads"><ClipboardList className="mr-2 h-4 w-4" /> Save as a lead</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
