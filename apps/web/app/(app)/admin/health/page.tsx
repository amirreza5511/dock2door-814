"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type CheckStatus = "idle" | "running" | "pass" | "fail";
interface Check {
  id: string;
  label: string;
  affects: string;
  status: CheckStatus;
  message?: string;
  run: () => Promise<{ ok: boolean; message?: string }>;
}

export default function HealthPage() {
  const supabase = getBrowserSupabase();

  const initialChecks: Check[] = [
    {
      id: "auth",
      label: "Auth session",
      affects: "Login, all role panels",
      status: "idle",
      run: async () => {
        const { data, error } = await supabase.auth.getUser();
        if (error) return { ok: false, message: error.message };
        return { ok: !!data.user, message: data.user ? data.user.email ?? "ok" : "no user" };
      },
    },
    {
      id: "rpc-active-company",
      label: "RPC: my_companies()",
      affects: "Active company switcher",
      status: "idle",
      run: async () => {
        const { data, error } = await supabase.rpc("my_companies");
        if (error) return { ok: false, message: error.message };
        return { ok: true, message: `${(data as unknown[] | null)?.length ?? 0} memberships` };
      },
    },
    {
      id: "rpc-is-admin",
      label: "Admin role detection",
      affects: "Admin panels",
      status: "idle",
      run: async () => {
        const { data, error } = await supabase.from("user_roles").select("role");
        if (error) return { ok: false, message: error.message };
        const roles = (data ?? []).map((r: { role: string }) => r.role);
        return { ok: true, message: roles.length ? roles.join(", ") : "no platform roles" };
      },
    },
    {
      id: "edge-signed-url",
      label: "Edge: get-signed-url",
      affects: "Document downloads",
      status: "idle",
      run: async () => {
        const { error } = await supabase.functions.invoke("get-signed-url", {
          body: { bucket: "certifications", path: "_healthcheck/_probe" },
        });
        if (error && error.message.toLowerCase().includes("not found")) {
          return { ok: true, message: "function reachable (file 404 expected)" };
        }
        if (error) return { ok: false, message: error.message };
        return { ok: true };
      },
    },
    {
      id: "edge-checkout",
      label: "Edge: create-checkout-session",
      affects: "Stripe invoice payment",
      status: "idle",
      run: async () => {
        const { error } = await supabase.functions.invoke("create-checkout-session", {
          body: { invoice_id: "00000000-0000-0000-0000-000000000000" },
        });
        if (!error) return { ok: true };
        return { ok: error.message.includes("invoice") || error.message.includes("not found"), message: error.message };
      },
    },
    {
      id: "edge-connect",
      label: "Edge: stripe-connect-onboard",
      affects: "Provider payouts",
      status: "idle",
      run: async () => {
        const { error } = await supabase.functions.invoke("stripe-connect-onboard", { body: {} });
        if (!error) return { ok: true };
        return { ok: error.message.toLowerCase().includes("company"), message: error.message };
      },
    },
    {
      id: "edge-push",
      label: "Edge: push-notifications",
      affects: "Realtime push",
      status: "idle",
      run: async () => {
        const { error } = await supabase.functions.invoke("push-notifications", { body: { batch: true, limit: 0 } });
        if (error) return { ok: false, message: error.message };
        return { ok: true };
      },
    },
    {
      id: "realtime",
      label: "Realtime channel connection",
      affects: "Messaging",
      status: "idle",
      run: async () =>
        new Promise((resolve) => {
          const channel = supabase.channel("healthcheck-" + Math.random());
          const t = setTimeout(() => {
            channel.unsubscribe();
            resolve({ ok: false, message: "timeout" });
          }, 5000);
          channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              clearTimeout(t);
              channel.unsubscribe();
              resolve({ ok: true });
            } else if (status === "CHANNEL_ERROR") {
              clearTimeout(t);
              channel.unsubscribe();
              resolve({ ok: false, message: status });
            }
          });
        }),
    },
  ];

  const [checks, setChecks] = useState(initialChecks);
  const [running, setRunning] = useState(false);

  const runAll = async () => {
    setRunning(true);
    setChecks((prev) => prev.map((c) => ({ ...c, status: "running" as CheckStatus, message: undefined })));
    for (const c of initialChecks) {
      try {
        const result = await c.run();
        setChecks((prev) =>
          prev.map((x) =>
            x.id === c.id ? { ...x, status: result.ok ? "pass" : "fail", message: result.message } : x,
          ),
        );
      } catch (err) {
        setChecks((prev) =>
          prev.map((x) =>
            x.id === c.id ? { ...x, status: "fail", message: err instanceof Error ? err.message : "error" } : x,
          ),
        );
      }
    }
    setRunning(false);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground">Live diagnostics for backend, edge functions, and integrations.</p>
        </div>
        <Button onClick={runAll} disabled={running}>
          {running ? "Running…" : "Run all checks"}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {checks.map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">{c.label}</CardTitle>
                <CardDescription>Affects: {c.affects}</CardDescription>
              </div>
              <StatusBadge status={c.status} />
            </CardHeader>
            <CardContent>
              <p className="font-mono text-xs text-muted-foreground">{c.message ?? "—"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CheckStatus }) {
  switch (status) {
    case "pass":
      return <Badge variant="success">PASS</Badge>;
    case "fail":
      return <Badge variant="destructive">FAIL</Badge>;
    case "running":
      return <Badge variant="warning">RUNNING</Badge>;
    default:
      return <Badge variant="secondary">IDLE</Badge>;
  }
}
