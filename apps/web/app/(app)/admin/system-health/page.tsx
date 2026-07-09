"use client";

import { useCallback, useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle2, XCircle, AlertTriangle, Clock, PlayCircle } from "lucide-react";

type CheckStatus = "idle" | "running" | "pass" | "fail" | "warn";

interface CheckResult {
  id: string;
  name: string;
  affects: string;
  status: CheckStatus;
  message?: string;
  durationMs?: number;
}

const INITIAL: Omit<CheckResult, "status">[] = [
  { id: "role", name: "Current user role / admin access", affects: "All admin screens & admin RPCs" },
  { id: "rpc", name: "Supabase RPCs callable (my_companies)", affects: "Active company switching, all role panels" },
  { id: "pending", name: "Pending companies visible (admin RLS)", affects: "Admin › Companies, approval workflow" },
  { id: "storage", name: "Storage signed URL (get-signed-url)", affects: "Cert previews, booking docs, invoices" },
  { id: "checkout", name: "Stripe checkout function reachable", affects: "Customer pay invoice" },
  { id: "connectOnboard", name: "Stripe Connect onboard function reachable", affects: "Warehouse/Service provider payouts" },
  { id: "connectDashboard", name: "Stripe Connect dashboard function reachable", affects: "Provider Stripe Express dashboard" },
  { id: "easypost", name: "EasyPost label function reachable", affects: "Shipment label purchase" },
  { id: "push", name: "Push notification dispatcher reachable", affects: "Chat push, booking status push" },
  { id: "realtime", name: "Realtime messaging connection", affects: "Live chat / thread messages" },
];

interface InvokeProbe { ok: boolean; reachable: boolean; status?: number; message: string }

export default function AdminSystemHealthPage() {
  const supabase = getBrowserSupabase();
  const [results, setResults] = useState<CheckResult[]>(INITIAL.map((c) => ({ ...c, status: "idle" })));
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  const update = useCallback((id: string, patch: Partial<CheckResult>) => {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const probeFunction = useCallback(async (name: string, body: Record<string, unknown>): Promise<InvokeProbe> => {
    try {
      const { data, error } = await supabase.functions.invoke(name, { body });
      if (error) {
        const ctx = (error as unknown as { context?: { status?: number } }).context;
        const status = ctx?.status;
        if (typeof status === "number") {
          return { ok: status >= 200 && status < 300, reachable: status !== 0, status, message: `${status} ${error.message ?? ""}`.trim() };
        }
        const msg = error.message ?? String(error);
        const looksUnreachable = /not\s*found|failed to fetch|network|fetch error|deploy/i.test(msg);
        return { ok: false, reachable: !looksUnreachable, message: msg };
      }
      return { ok: true, reachable: true, status: 200, message: typeof data === "object" ? "OK" : String(data ?? "OK") };
    } catch (e) {
      return { ok: false, reachable: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [supabase]);

  const runOne = useCallback(async (id: string): Promise<void> => {
    const start = Date.now();
    update(id, { status: "running", message: undefined, durationMs: undefined });
    try {
      switch (id) {
        case "role": {
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session) { update(id, { status: "fail", message: "No active session." }); break; }
          const { data: roleRow, error } = await supabase.from("user_roles").select("role").eq("user_id", sessionData.session.user.id).eq("role", "admin").maybeSingle();
          if (error) { update(id, { status: "fail", message: `user_roles read failed: ${error.message}` }); break; }
          if (!roleRow) { update(id, { status: "warn", message: `Signed in as ${sessionData.session.user.email} but no admin row in user_roles.` }); break; }
          update(id, { status: "pass", message: `Admin confirmed for ${sessionData.session.user.email}` });
          break;
        }
        case "rpc": {
          const { data, error } = await supabase.rpc("my_companies");
          if (error) { update(id, { status: "fail", message: `my_companies RPC failed: ${error.message}` }); break; }
          update(id, { status: "pass", message: `RPC OK. ${Array.isArray(data) ? data.length : 0} membership row(s).` });
          break;
        }
        case "pending": {
          const { data, error, count } = await supabase.from("companies").select("id,name,status", { count: "exact" }).eq("status", "PendingApproval").limit(5);
          if (error) { update(id, { status: "fail", message: `companies SELECT blocked: ${error.message}` }); break; }
          const n = count ?? data?.length ?? 0;
          update(id, { status: "pass", message: n === 0 ? "Query OK. No pending companies right now." : `Visible: ${n} pending.` });
          break;
        }
        case "storage": {
          const probe = await probeFunction("get-signed-url", { bucket: "attachments", path: "__healthcheck__/none.txt" });
          if (!probe.reachable) { update(id, { status: "fail", message: `Function not reachable: ${probe.message}` }); break; }
          if (probe.status === 401 || probe.status === 403) { update(id, { status: "warn", message: `Reachable but auth/RLS rejected (${probe.status}). Expected. ${probe.message}` }); break; }
          if (probe.status === 404 || probe.status === 400) { update(id, { status: "pass", message: `Reachable. Returned ${probe.status} for missing object (expected).` }); break; }
          update(id, { status: probe.ok ? "pass" : "warn", message: probe.message });
          break;
        }
        case "checkout": {
          const probe = await probeFunction("create-checkout-session", { invoice_id: "00000000-0000-0000-0000-000000000000" });
          if (!probe.reachable) { update(id, { status: "fail", message: `Function not reachable: ${probe.message}` }); break; }
          if (probe.status === 400 || probe.status === 404 || probe.status === 403) { update(id, { status: "pass", message: `Reachable. Rejected dummy invoice with ${probe.status} (expected).` }); break; }
          update(id, { status: probe.ok ? "pass" : "warn", message: `${probe.status ?? "?"} ${probe.message}` });
          break;
        }
        case "connectOnboard": {
          const probe = await probeFunction("stripe-connect-onboard", { company_id: "00000000-0000-0000-0000-000000000000" });
          if (!probe.reachable) { update(id, { status: "fail", message: `Function not reachable: ${probe.message}` }); break; }
          if (probe.status && probe.status >= 400 && probe.status < 500) { update(id, { status: "pass", message: `Reachable. ${probe.status} for dummy company (expected).` }); break; }
          update(id, { status: probe.ok ? "pass" : "warn", message: `${probe.status ?? "?"} ${probe.message}` });
          break;
        }
        case "connectDashboard": {
          const probe = await probeFunction("stripe-connect-dashboard", { company_id: "00000000-0000-0000-0000-000000000000" });
          if (!probe.reachable) { update(id, { status: "fail", message: `Function not reachable: ${probe.message}` }); break; }
          if (probe.status && probe.status >= 400 && probe.status < 500) { update(id, { status: "pass", message: `Reachable. ${probe.status} for dummy company (expected).` }); break; }
          update(id, { status: probe.ok ? "pass" : "warn", message: `${probe.status ?? "?"} ${probe.message}` });
          break;
        }
        case "easypost": {
          const probe = await probeFunction("purchase-shipping-label", { shipment_id: "00000000-0000-0000-0000-000000000000" });
          if (!probe.reachable) { update(id, { status: "fail", message: `Function not reachable: ${probe.message}` }); break; }
          if (probe.status && probe.status >= 400 && probe.status < 500) { update(id, { status: "pass", message: `Reachable. ${probe.status} for dummy shipment (expected). Verify EASYPOST_API_KEY.` }); break; }
          update(id, { status: probe.ok ? "pass" : "warn", message: `${probe.status ?? "?"} ${probe.message}` });
          break;
        }
        case "push": {
          const probe = await probeFunction("push-notifications", { batch: true, limit: 0 });
          if (!probe.reachable) { update(id, { status: "fail", message: `Function not reachable: ${probe.message}` }); break; }
          update(id, { status: probe.ok ? "pass" : "warn", message: probe.ok ? `Dispatcher reachable. ${probe.message}` : `${probe.status ?? "?"} ${probe.message}` });
          break;
        }
        case "realtime": {
          const ok: boolean = await new Promise((resolve) => {
            let settled = false;
            const channel = supabase.channel(`health-${Date.now()}`);
            const finish = (v: boolean) => { if (settled) return; settled = true; try { void supabase.removeChannel(channel); } catch {} resolve(v); };
            const t = setTimeout(() => finish(false), 6000);
            channel.subscribe((status: string) => {
              if (status === "SUBSCRIBED") { clearTimeout(t); finish(true); }
              if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { clearTimeout(t); finish(false); }
            });
          });
          update(id, { status: ok ? "pass" : "fail", message: ok ? "Realtime SUBSCRIBED." : "Realtime did not subscribe within 6s." });
          break;
        }
        default:
          update(id, { status: "warn", message: "Unknown check." });
      }
    } catch (e) {
      update(id, { status: "fail", message: e instanceof Error ? e.message : String(e) });
    } finally {
      update(id, { durationMs: Date.now() - start });
    }
  }, [supabase, update, probeFunction]);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults((prev) => prev.map((r) => ({ ...r, status: "idle", message: undefined, durationMs: undefined })));
    for (const c of INITIAL) {
      // eslint-disable-next-line no-await-in-loop
      await runOne(c.id);
    }
    setLastRunAt(new Date());
    setRunning(false);
  }, [runOne]);

  const summary = useMemo(() => ({
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
    idle: results.filter((r) => r.status === "idle").length,
  }), [results]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">System health</h1>
        </div>
        <p className="text-sm text-muted-foreground">Diagnose Edge Functions, RPCs, RLS, storage, and realtime.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="grid grid-cols-4 gap-3">
            <Pill label="Pass" value={summary.pass} className="text-emerald-500" />
            <Pill label="Warn" value={summary.warn} className="text-amber-500" />
            <Pill label="Fail" value={summary.fail} className="text-red-500" />
            <Pill label="Idle" value={summary.idle} className="text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground">{lastRunAt ? `Last run: ${lastRunAt.toLocaleTimeString()}` : "Not run yet."}</p>
          <Button disabled={running} onClick={runAll}>{running ? "Running checks…" : "Run all checks"}</Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {results.map((r) => (
          <CheckRow key={r.id} result={r} onRun={() => runOne(r.id)} disabled={running} />
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Reading the results</CardTitle><CardDescription>What pass / warn / fail mean.</CardDescription></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">A 4xx response from Stripe / EasyPost / checkout for a dummy ID is expected and proves the function is deployed and reachable. Only network / 5xx / not-found errors mean the function is broken.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Pill({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-center">
      <div className={`text-xl font-bold ${className}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function CheckRow({ result, onRun, disabled }: { result: CheckResult; onRun: () => void; disabled: boolean }) {
  const { Icon, color, label } = statusVisual(result.status);
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${color}`} />
            <span className="text-sm font-medium">{result.name}</span>
          </div>
          <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${color}`}>{label}</span>
        </div>
        <p className="text-xs text-muted-foreground">Affects: {result.affects}</p>
        {result.message && <p className={`text-xs ${result.status === "fail" ? "text-red-500" : result.status === "warn" ? "text-amber-500" : "text-muted-foreground"}`}>{result.message}</p>}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{result.durationMs ? `${result.durationMs} ms` : " "}</span>
          <Button size="sm" variant="outline" disabled={disabled || result.status === "running"} onClick={onRun}>
            <PlayCircle className="mr-1 h-3.5 w-3.5" />{result.status === "running" ? "Running" : "Run"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function statusVisual(status: CheckStatus): { Icon: React.ComponentType<{ className?: string }>; color: string; label: string } {
  switch (status) {
    case "pass": return { Icon: CheckCircle2, color: "text-emerald-500", label: "PASS" };
    case "fail": return { Icon: XCircle, color: "text-red-500", label: "FAIL" };
    case "warn": return { Icon: AlertTriangle, color: "text-amber-500", label: "WARN" };
    case "running": return { Icon: Activity, color: "text-primary", label: "RUN" };
    default: return { Icon: Clock, color: "text-muted-foreground", label: "IDLE" };
  }
}
