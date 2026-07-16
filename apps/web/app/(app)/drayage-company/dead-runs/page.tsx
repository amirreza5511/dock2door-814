"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingDown, Truck, User, Repeat2, DollarSign, Navigation } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DeadRunSummary {
  empty_miles?: number;
  deadhead_miles?: number;
  loaded_miles?: number;
  dead_cost?: number;
  pct_empty?: number;
  savings_miles?: number;
  savings_cost?: number;
  default_rate?: number;
}

interface DeadRunEntry {
  kind?: string;
  move_type?: string;
  miles?: number;
  cost?: number;
  driver?: string;
  truck?: string;
  ref?: string;
  from_ref?: string;
  to_ref?: string;
  at?: string;
}

interface DeadRunsPayload {
  summary?: DeadRunSummary;
  runs?: DeadRunEntry[];
  by_truck?: Record<string, { miles?: number; cost?: number }>;
  by_driver?: Record<string, { miles?: number; cost?: number }>;
}

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function aggToRows(obj: Record<string, { miles?: number; cost?: number }> | null | undefined) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .map(([key, v]) => ({ key, miles: Number(v?.miles ?? 0), cost: Number(v?.cost ?? 0) }))
    .sort((a, b) => b.cost - a.cost);
}

export default function DeadRunsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const companyId = useActiveCompanyId("DrayageCompany") ?? null;
  const [days, setDays] = useState<number>(7);
  const [rateDraft, setRateDraft] = useState<string>("");

  const query = useQuery({
    queryKey: ["drayage", "deadRunsFull", days, companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<DeadRunsPayload | null> => {
      const { data, error } = await supabase.rpc("drayage_dead_runs", { p_days: days });
      if (error) {
        if (error.message.includes("function") || error.code === "PGRST202") return null;
        throw error;
      }
      return (data as DeadRunsPayload | null) ?? null;
    },
  });

  const saveRate = useMutation({
    mutationFn: async () => {
      const n = Number(rateDraft);
      if (!Number.isFinite(n) || n < 0) throw new Error("Enter a dollar amount per mile, e.g. 2.10");
      const { error } = await supabase.rpc("set_company_cost_per_mile", { p_rate: n });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["drayage", "deadRunsFull"] });
    },
  });

  const data = query.data;
  const summary = data?.summary;
  const totalDead = Number(summary?.empty_miles ?? 0) + Number(summary?.deadhead_miles ?? 0);
  const byTruck = useMemo(() => aggToRows(data?.by_truck), [data?.by_truck]);
  const byDriver = useMemo(() => aggToRows(data?.by_driver), [data?.by_driver]);
  const runs = (data?.runs ?? []).slice().reverse();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Drayage Company</p>
        <h1 className="text-2xl font-semibold tracking-tight">Dead Runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">Empty miles, what they cost & what street turns saved.</p>
      </div>

      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <Button key={p.days} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)}>
            {p.label}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Crunching empty miles…</p>
      ) : data == null ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Not ready yet — apply the latest database migration (0149) in Supabase to unlock dead-run analytics.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="space-y-1 py-4">
                <TrendingDown className="h-4 w-4 text-red-400" />
                <p className="text-xl font-bold">{totalDead.toFixed(1)} mi</p>
                <p className="text-xs text-muted-foreground">Dead-run miles</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 py-4">
                <DollarSign className="h-4 w-4 text-red-400" />
                <p className="text-xl font-bold text-red-400">${Number(summary?.dead_cost ?? 0).toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">Cost of empty miles</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 py-4">
                <Navigation className="h-4 w-4 text-blue-400" />
                <p className="text-xl font-bold">{Number(summary?.pct_empty ?? 0)}%</p>
                <p className="text-xs text-muted-foreground">Empty vs total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 py-4">
                <Repeat2 className="h-4 w-4 text-emerald-400" />
                <p className="text-xl font-bold text-emerald-400">${Number(summary?.savings_cost ?? 0).toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">Saved by street turns</p>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            Empty legs {Number(summary?.empty_miles ?? 0).toFixed(1)} mi · deadhead gaps {Number(summary?.deadhead_miles ?? 0).toFixed(1)} mi · loaded {Number(summary?.loaded_miles ?? 0).toFixed(1)} mi
          </p>

          <Card>
            <CardContent className="space-y-3 py-4">
              <div>
                <p className="text-sm font-semibold">Company default cost per mile</p>
                <p className="text-xs text-muted-foreground">
                  Used when a truck has no rate of its own (set per truck in Fleet). Current: ${Number(summary?.default_rate ?? 2).toFixed(2)}/mi
                </p>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label>New default ($/mi)</Label>
                  <Input value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} placeholder={String(summary?.default_rate ?? 2)} inputMode="decimal" />
                </div>
                <Button onClick={() => saveRate.mutate()} disabled={saveRate.isPending}>
                  {saveRate.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
              {saveRate.isError ? <p className="text-xs text-red-400">{(saveRate.error as Error).message}</p> : null}
            </CardContent>
          </Card>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">By truck</h2>
            </div>
            {byTruck.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No dead runs recorded in this period. 🎉</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="divide-y divide-border py-1">
                  {byTruck.map((r) => (
                    <div key={r.key} className="flex items-center justify-between py-3">
                      <p className="text-sm font-medium">{r.key}</p>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-muted-foreground">{r.miles.toFixed(1)} mi</span>
                        <span className="text-sm font-bold text-red-400">${r.cost.toFixed(0)}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold">By driver</h2>
            </div>
            {byDriver.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Nothing here yet.</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="divide-y divide-border py-1">
                  {byDriver.map((r) => (
                    <div key={r.key} className="flex items-center justify-between py-3">
                      <p className="text-sm font-medium">{r.key}</p>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-muted-foreground">{r.miles.toFixed(1)} mi</span>
                        <span className="text-sm font-bold text-red-400">${r.cost.toFixed(0)}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-400" />
              <h2 className="text-sm font-semibold">Recent dead runs</h2>
            </div>
            {runs.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No empty legs or deadhead gaps detected in this window.</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="divide-y divide-border py-1">
                  {runs.map((r, idx) => (
                    <div key={`${r.at}-${idx}`} className="flex items-center gap-3 py-3">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${r.kind === "deadhead" ? "bg-yellow-400" : "bg-red-400"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {r.kind === "deadhead"
                            ? `Deadhead ${r.from_ref ? `${r.from_ref} → ` : ""}${r.to_ref ?? ""}`
                            : `${r.move_type ?? "Empty leg"} · ${r.ref ?? ""}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[r.driver, r.truck, r.at ? new Date(r.at).toLocaleString() : ""].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{Number(r.miles ?? 0).toFixed(1)} mi</p>
                        <p className="text-xs text-red-400">${Number(r.cost ?? 0).toFixed(0)}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
