"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Users, DollarSign, SlidersHorizontal, Check, X, Trash2, Plus } from "lucide-react";

/**
 * Admin › Sales & Commissions. Web mirror of expo/app/admin/sales-agents.tsx.
 * Supabase-direct port of the sales.admin* tRPC procedures (same tables/RPCs):
 *   sales_agents + profiles + commission_entries + agent_attributions,
 *   commission_plans, and RPCs admin_update_agent, admin_set_commission_status,
 *   admin_award_commission, admin_upsert_commission_plan.
 */

type Tab = "agents" | "payouts" | "plans";
type CommissionStatus = "Pending" | "Approved" | "Paid" | "Rejected";

const BOUNTY_KEYS = ["warehouse", "drayage", "employer", "trucking", "shipper", "customer", "service", "freight_forwarder"] as const;
const REFERRAL_KEYS = ["worker", "driver", "owner_operator"] as const;

const STATUS_TINT: Record<CommissionStatus, string> = {
  Pending: "text-amber-500",
  Approved: "text-sky-500",
  Paid: "text-emerald-500",
  Rejected: "text-red-500",
};
const KIND_LABEL: Record<string, string> = {
  bounty: "Signing bounty",
  recurring: "Recurring",
  referral: "Referral fee",
  bonus: "Milestone bonus",
  manual: "Manual adjustment",
};

interface AgentRow {
  id: string;
  agent_code: string;
  status: string;
  plan_id: string | null;
  name: string;
  email: string;
  accounts: number;
  pending: number;
  approved: number;
  paid: number;
  [key: string]: unknown;
}
interface CommissionRow {
  id: string;
  kind: string;
  vertical: string;
  amount: number;
  status: CommissionStatus;
  description: string;
  created_at: string;
  agent_id: string;
  agentName: string;
  agentEmail: string;
}
interface PlanConfig {
  bounty?: Record<string, number>;
  recurring?: Record<string, number>;
  referral?: Record<string, number>;
  tiers?: { threshold: number; bonus: number }[];
}
interface PlanRow {
  id: string;
  name: string;
  description: string;
  config: PlanConfig;
  is_default: boolean;
  active: boolean;
}

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function AdminSalesAgentsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("agents");
  const [statusFilter, setStatusFilter] = useState<CommissionStatus | "All">("Pending");
  const [assignAgent, setAssignAgent] = useState<AgentRow | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanRow | null>(null);
  const [awardAmount, setAwardAmount] = useState("");
  const [awardNote, setAwardNote] = useState("");

  const dataQ = useQuery({
    queryKey: ["admin", "sales-agents"],
    queryFn: async () => {
      const { data: agents, error } = await supabase.from("sales_agents").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      const list = (agents as Record<string, unknown>[] | null) ?? [];
      const [plansRes, commissionsRes] = await Promise.all([
        supabase.from("commission_plans").select("*").order("is_default", { ascending: false }).order("name"),
        supabase.from("commission_entries").select("*").order("created_at", { ascending: false }).limit(500),
      ]);
      const commissionRows = (commissionsRes.data as Record<string, unknown>[] | null) ?? [];
      let agentRows: AgentRow[] = [];
      if (list.length > 0) {
        const ids = list.map((a) => a.id as string);
        const [profiles, attrs] = await Promise.all([
          supabase.from("profiles").select("id, name, email").in("id", ids),
          supabase.from("agent_attributions").select("agent_id").in("agent_id", ids),
        ]);
        const profMap = new Map(((profiles.data as Record<string, unknown>[] | null) ?? []).map((p) => [p.id as string, p]));
        const attrRows = (attrs.data as { agent_id: string }[] | null) ?? [];
        const entryRows = commissionRows as { agent_id: string; amount: number; status: string }[];
        agentRows = list.map((a) => {
          const id = a.id as string;
          const mine = entryRows.filter((e) => e.agent_id === id);
          const sum = (s: string) => mine.filter((e) => e.status === s).reduce((acc, e) => acc + Number(e.amount || 0), 0);
          const prof = profMap.get(id) as { name?: string; email?: string } | undefined;
          return {
            ...a,
            id,
            agent_code: (a.agent_code as string) ?? "",
            status: (a.status as string) ?? "Active",
            plan_id: (a.plan_id as string | null) ?? null,
            name: prof?.name ?? "Agent",
            email: prof?.email ?? "",
            accounts: attrRows.filter((t) => t.agent_id === id).length,
            pending: sum("Pending"),
            approved: sum("Approved"),
            paid: sum("Paid"),
          } as AgentRow;
        });
      }
      const profIds = Array.from(new Set(commissionRows.map((r) => r.agent_id as string)));
      const { data: cProfiles } = profIds.length ? await supabase.from("profiles").select("id, name, email").in("id", profIds) : { data: [] };
      const cProfMap = new Map(((cProfiles as Record<string, unknown>[] | null) ?? []).map((p) => [p.id as string, p]));
      const commissions: CommissionRow[] = commissionRows.map((r) => {
        const prof = cProfMap.get(r.agent_id as string) as { name?: string; email?: string } | undefined;
        return {
          id: r.id as string,
          kind: (r.kind as string) ?? "manual",
          vertical: (r.vertical as string) ?? "",
          amount: Number(r.amount ?? 0),
          status: (r.status as CommissionStatus) ?? "Pending",
          description: (r.description as string) ?? "",
          created_at: r.created_at as string,
          agent_id: r.agent_id as string,
          agentName: prof?.name ?? "Agent",
          agentEmail: prof?.email ?? "",
        };
      });
      return { agents: agentRows, plans: ((plansRes.data as PlanRow[] | null) ?? []), commissions };
    },
  });

  const agents = useMemo(() => dataQ.data?.agents ?? [], [dataQ.data]);
  const plans = useMemo(() => dataQ.data?.plans ?? [], [dataQ.data]);
  const commissions = useMemo(() => dataQ.data?.commissions ?? [], [dataQ.data]);

  const totals = useMemo(() => {
    const sum = (s: CommissionStatus) => commissions.filter((c) => c.status === s).reduce((a, c) => a + Number(c.amount || 0), 0);
    return { pending: sum("Pending"), approved: sum("Approved"), paid: sum("Paid") };
  }, [commissions]);

  const filteredCommissions = statusFilter === "All" ? commissions : commissions.filter((c) => c.status === statusFilter);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "sales-agents"] });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CommissionStatus }) => {
      const { error } = await supabase.rpc("admin_set_commission_status", { p_id: id, p_status: status });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const updateAgent = useMutation({
    mutationFn: async ({ agentId, planId, status }: { agentId: string; planId?: string | null; status?: string }) => {
      const { error } = await supabase.rpc("admin_update_agent", { p_agent_id: agentId, p_plan_id: planId ?? null, p_status: status ?? null });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const awardCommission = useMutation({
    mutationFn: async ({ agentId, amount, note }: { agentId: string; amount: number; note: string }) => {
      const { error } = await supabase.rpc("admin_award_commission", {
        p_agent_id: agentId, p_kind: "manual", p_vertical: "", p_amount: amount, p_description: note || "Manual adjustment by admin",
      });
      if (error) throw error;
    },
    onSuccess: () => { setAwardAmount(""); setAwardNote(""); invalidate(); },
  });
  const upsertPlan = useMutation({
    mutationFn: async (p: PlanRow) => {
      const { error } = await supabase.rpc("admin_upsert_commission_plan", {
        p_id: p.id || null, p_name: p.name, p_description: p.description, p_config: p.config, p_is_default: p.is_default, p_active: p.active,
      });
      if (error) throw error;
    },
    onSuccess: () => { setPlanDraft(null); invalidate(); },
  });

  function submitAward() {
    if (!assignAgent) return;
    const amount = Number(awardAmount.replace(/[^0-9.]/g, "")) || 0;
    if (amount <= 0) return;
    awardCommission.mutate({ agentId: assignAgent.id, amount, note: awardNote.trim() });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales &amp; Commissions</h1>
        <p className="text-sm text-muted-foreground">Agents, payouts, and commission plans.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Pending" value={money(totals.pending)} color="text-amber-500" />
        <SummaryTile label="Approved" value={money(totals.approved)} color="text-sky-500" />
        <SummaryTile label="Paid" value={money(totals.paid)} color="text-emerald-500" />
      </div>

      <div className="flex flex-wrap gap-2">
        {([["agents", "Agents", Users], ["payouts", "Payouts", DollarSign], ["plans", "Plans", SlidersHorizontal]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${tab === key ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {dataQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : dataQ.error ? (
        <p className="text-sm text-red-600">{(dataQ.error as Error).message}</p>
      ) : (
        <>
          {tab === "agents" && (
            agents.length === 0 ? (
              <EmptyBlock title="No sales agents yet" msg="When someone signs up as a Sales Agent, they'll appear here with their code and earnings." />
            ) : (
              <div className="space-y-3">
                {agents.map((a) => {
                  const plan = plans.find((p) => p.id === a.plan_id);
                  return (
                    <Card key={a.id}>
                      <CardContent className="space-y-3 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="font-semibold">{a.name}</div>
                            <div className="text-xs text-muted-foreground">{a.email}</div>
                          </div>
                          <span className="rounded-md border bg-muted/40 px-2.5 py-1 font-mono text-sm font-bold tracking-widest text-primary">{a.agent_code}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <MiniStat label="Accounts" value={String(a.accounts)} />
                          <MiniStat label="Pending" value={money(a.pending)} color="text-amber-500" />
                          <MiniStat label="Approved" value={money(a.approved)} color="text-sky-500" />
                          <MiniStat label="Paid" value={money(a.paid)} color="text-emerald-500" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setAssignAgent(a); setAwardAmount(""); setAwardNote(""); }}>
                            {plan?.name ?? "Default plan"} · Change
                          </Button>
                          <Button size="sm" variant={a.status === "Active" ? "secondary" : "outline"} disabled={updateAgent.isPending}
                            onClick={() => updateAgent.mutate({ agentId: a.id, status: a.status === "Active" ? "Paused" : "Active" })}>
                            {a.status}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {tab === "payouts" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(["Pending", "Approved", "Paid", "Rejected", "All"] as const).map((s) => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${statusFilter === s ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                    {s}
                  </button>
                ))}
              </div>
              {filteredCommissions.length === 0 ? (
                <EmptyBlock title="Nothing here" msg="Commission lines appear as agents onboard accounts and generate revenue." />
              ) : filteredCommissions.map((r) => (
                <Card key={r.id}>
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="flex-1">
                      <div className="text-sm font-semibold capitalize">{KIND_LABEL[r.kind] ?? r.kind}{r.vertical ? ` · ${r.vertical}` : ""}</div>
                      <div className="text-xs text-muted-foreground">{r.agentName}</div>
                      {r.description && <div className="mt-0.5 text-xs text-muted-foreground">{r.description}</div>}
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-base font-bold">{money(r.amount)}</span>
                        <span className={`text-xs font-semibold ${STATUS_TINT[r.status]}`}>{r.status}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === "Pending" && (
                        <>
                          <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "Approved" })}><Check className="h-4 w-4 text-sky-500" /></Button>
                          <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "Rejected" })}><X className="h-4 w-4 text-red-500" /></Button>
                        </>
                      )}
                      {r.status === "Approved" && (
                        <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "Paid" })}>Pay</Button>
                      )}
                      {r.status === "Paid" && <Check className="h-5 w-5 text-emerald-500" />}
                      {r.status === "Rejected" && <X className="h-5 w-5 text-red-500" />}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {tab === "plans" && (
            <div className="space-y-3">
              <Button variant="outline" onClick={() => setPlanDraft({ id: "", name: "", description: "", config: { bounty: {}, recurring: {}, referral: {}, tiers: [] }, is_default: false, active: true })}>
                <Plus className="mr-1 h-3.5 w-3.5" /> New commission plan
              </Button>
              {plans.map((p) => (
                <Card key={p.id} className="cursor-pointer" onClick={() => setPlanDraft(p)}>
                  <CardContent className="space-y-1 py-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{p.name}</span>
                      <div className="flex gap-1.5">
                        {p.is_default && <Badge variant="secondary">Default</Badge>}
                        <Badge variant={p.active ? "success" : "secondary"}>{p.active ? "Active" : "Off"}</Badge>
                      </div>
                    </div>
                    {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                    <p className="text-xs text-muted-foreground">Tap to edit bounties, recurring %, referral fees &amp; tiers</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Assign plan / award sheet */}
      {assignAgent && (
        <Overlay onClose={() => setAssignAgent(null)}>
          <h3 className="text-base font-semibold">Assign plan</h3>
          <p className="text-sm text-muted-foreground">{assignAgent.name} · {assignAgent.agent_code}</p>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Commission plan</p>
            {plans.map((p) => {
              const active = assignAgent.plan_id === p.id;
              return (
                <button key={p.id} onClick={() => { updateAgent.mutate({ agentId: assignAgent.id, planId: p.id }); setAssignAgent(null); }}
                  className={`flex w-full items-center gap-2 rounded-lg border p-3 text-left ${active ? "border-primary bg-primary/10" : "border-border"}`}>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    {p.is_default && <div className="text-xs text-muted-foreground">Default plan</div>}
                  </div>
                  {active && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Award / adjust commission</p>
            <p className="text-xs text-muted-foreground">Add a one-off commission line for this agent. It lands as Pending in Payouts.</p>
            <div className="flex gap-2">
              <Input className="w-32" value={awardAmount} onChange={(e) => setAwardAmount(e.target.value)} placeholder="$ amount" />
              <Input className="flex-1" value={awardNote} onChange={(e) => setAwardNote(e.target.value)} placeholder="Reason (optional)" />
            </div>
            <Button disabled={awardCommission.isPending} onClick={submitAward}>{awardCommission.isPending ? "Adding…" : "Add commission"}</Button>
          </div>
        </Overlay>
      )}

      {/* Plan editor */}
      {planDraft && (
        <Overlay onClose={() => setPlanDraft(null)}>
          <h3 className="text-base font-semibold">{planDraft.id ? "Edit plan" : "New plan"}</h3>
          <div className="space-y-1.5"><Label>Plan name</Label><Input value={planDraft.name} onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })} placeholder="e.g. Q3 Campaign" /></div>
          <div className="space-y-1.5"><Label>Description</Label><Input value={planDraft.description} onChange={(e) => setPlanDraft({ ...planDraft, description: e.target.value })} placeholder="Optional" /></div>
          <div className="flex gap-2">
            <ToggleBtn label="Set as default" on={planDraft.is_default} onClick={() => setPlanDraft({ ...planDraft, is_default: !planDraft.is_default })} />
            <ToggleBtn label="Active" on={planDraft.active} onClick={() => setPlanDraft({ ...planDraft, active: !planDraft.active })} />
          </div>

          <PlanGroup title="Signing bounty ($ per account)">
            {BOUNTY_KEYS.map((k) => (
              <NumRow key={k} label={k.replace("_", " ")} value={planDraft.config.bounty?.[k]}
                onChange={(n) => setPlanDraft({ ...planDraft, config: { ...planDraft.config, bounty: { ...planDraft.config.bounty, [k]: n } } })} />
            ))}
          </PlanGroup>
          <PlanGroup title="Recurring revenue share (%)">
            {BOUNTY_KEYS.map((k) => (
              <NumRow key={k} label={k.replace("_", " ")} value={planDraft.config.recurring?.[k]} suffix="%"
                onChange={(n) => setPlanDraft({ ...planDraft, config: { ...planDraft.config, recurring: { ...planDraft.config.recurring, [k]: n } } })} />
            ))}
          </PlanGroup>
          <PlanGroup title="Referral fee ($ per person)">
            {REFERRAL_KEYS.map((k) => (
              <NumRow key={k} label={k.replace("_", " ")} value={planDraft.config.referral?.[k]}
                onChange={(n) => setPlanDraft({ ...planDraft, config: { ...planDraft.config, referral: { ...planDraft.config.referral, [k]: n } } })} />
            ))}
          </PlanGroup>
          <PlanGroup title="Milestone bonuses">
            {(planDraft.config.tiers ?? []).map((t, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1"><Label>At</Label><Input value={String(t.threshold ?? "")} onChange={(e) => {
                  const tiers = [...(planDraft.config.tiers ?? [])]; tiers[i] = { ...tiers[i], threshold: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 };
                  setPlanDraft({ ...planDraft, config: { ...planDraft.config, tiers } });
                }} placeholder="10" /></div>
                <div className="flex-1 space-y-1"><Label>Bonus $</Label><Input value={String(t.bonus ?? "")} onChange={(e) => {
                  const tiers = [...(planDraft.config.tiers ?? [])]; tiers[i] = { ...tiers[i], bonus: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 };
                  setPlanDraft({ ...planDraft, config: { ...planDraft.config, tiers } });
                }} placeholder="500" /></div>
                <Button size="sm" variant="outline" onClick={() => {
                  const tiers = (planDraft.config.tiers ?? []).filter((_, idx) => idx !== i);
                  setPlanDraft({ ...planDraft, config: { ...planDraft.config, tiers } });
                }}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setPlanDraft({ ...planDraft, config: { ...planDraft.config, tiers: [...(planDraft.config.tiers ?? []), { threshold: 0, bonus: 0 }] } })}>+ Add tier</Button>
          </PlanGroup>

          {upsertPlan.error && <p className="text-sm text-red-600">{(upsertPlan.error as Error).message}</p>}
          <Button disabled={upsertPlan.isPending || !planDraft.name.trim()} onClick={() => upsertPlan.mutate(planDraft)}>{upsertPlan.isPending ? "Saving…" : "Save plan"}</Button>
        </Overlay>
      )}
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card><CardContent className="py-4 text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}
function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2 text-center">
      <div className={`text-sm font-bold ${color ?? ""}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
function EmptyBlock({ title, msg }: { title: string; msg: string }) {
  return (
    <Card><CardContent className="py-10 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{msg}</p>
    </CardContent></Card>
  );
}
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function ToggleBtn({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>
      {on ? <Check className="h-3.5 w-3.5" /> : null} {label}
    </button>
  );
}
function PlanGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{title}</p>
      {children}
    </div>
  );
}
function NumRow({ label, value, onChange, suffix }: { label: string; value?: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm capitalize">{label}</span>
      <div className="flex w-28 items-center gap-1.5">
        <Input value={value != null && value !== 0 ? String(value) : ""} onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)} placeholder="0" />
        {suffix && <span className="text-sm font-semibold text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
