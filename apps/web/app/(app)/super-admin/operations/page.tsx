"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface MoveRow {
  id: string;
  order_id: string;
  move_type: string;
  status: string;
  driver_user_id: string | null;
  updated_at: string | null;
  created_at: string | null;
  drayage_orders: {
    reference_code?: string | null;
    container_number?: string | null;
    container_size?: string | null;
  } | null;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  created_at: string | null;
}

interface ShiftRow {
  id: string;
  title: string;
  category: string;
  date: string;
  start_time: string;
  end_time: string;
}

interface ProfileRow {
  id: string;
  name: string | null;
  email: string | null;
}

interface OpsData {
  moves: MoveRow[];
  assignments: AssignmentRow[];
  shiftsById: Record<string, ShiftRow>;
  namesById: Record<string, string>;
}

const DRAYAGE_ACTIVE = ["Assigned", "EnRoute", "AtOrigin", "Loaded", "InTransit", "AtDestination", "Unloaded"];
const SHIFT_ACTIVE = ["Scheduled", "InProgress"];
const SHIFT_DONE = ["Completed", "HoursConfirmed", "Confirmed"];

type Filter = "completed" | "active" | "all";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  Completed: "default",
  HoursConfirmed: "default",
  Confirmed: "default",
};

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

export default function SuperAdminOperationsPage() {
  const supabase = getBrowserSupabase();
  const [filter, setFilter] = useState<Filter>("completed");

  const opsQuery = useQuery<OpsData>({
    queryKey: ["super-admin", "operations-log"],
    staleTime: 20_000,
    queryFn: async (): Promise<OpsData> => {
      const [movesRes, assignRes] = await Promise.all([
        supabase
          .from("drayage_moves")
          .select(
            "id,order_id,move_type,status,driver_user_id,updated_at,created_at,drayage_orders(reference_code,container_number,container_size)"
          )
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("shift_assignments")
          .select("id,shift_id,worker_user_id,status,created_at")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (movesRes.error) throw new Error(movesRes.error.message);
      if (assignRes.error) throw new Error(assignRes.error.message);

      const moves = (movesRes.data ?? []) as unknown as MoveRow[];
      const assignments = (assignRes.data ?? []) as AssignmentRow[];

      const shiftIds = Array.from(new Set(assignments.map((a) => a.shift_id).filter(Boolean)));
      const userIds = Array.from(
        new Set([
          ...(moves.map((m) => m.driver_user_id).filter(Boolean) as string[]),
          ...assignments.map((a) => a.worker_user_id).filter(Boolean),
        ])
      );

      const [shiftsRes, profilesRes] = await Promise.all([
        shiftIds.length
          ? supabase.from("shift_posts").select("id,title,category,date,start_time,end_time").in("id", shiftIds)
          : Promise.resolve({ data: [] as ShiftRow[], error: null }),
        userIds.length
          ? supabase.from("profiles").select("id,name,email").in("id", userIds)
          : Promise.resolve({ data: [] as ProfileRow[], error: null }),
      ]);

      const shiftsById: Record<string, ShiftRow> = {};
      for (const s of (shiftsRes.data ?? []) as ShiftRow[]) shiftsById[s.id] = s;
      const namesById: Record<string, string> = {};
      for (const p of (profilesRes.data ?? []) as ProfileRow[])
        namesById[p.id] = p.name ?? p.email ?? p.id.slice(0, 8);

      return { moves, assignments, shiftsById, namesById };
    },
  });

  const data = opsQuery.data;

  const moves = useMemo(() => {
    const all = data?.moves ?? [];
    if (filter === "completed") return all.filter((m) => m.status === "Completed");
    if (filter === "active") return all.filter((m) => DRAYAGE_ACTIVE.includes(m.status));
    return all;
  }, [data?.moves, filter]);

  const assignments = useMemo(() => {
    const all = data?.assignments ?? [];
    if (filter === "completed") return all.filter((a) => SHIFT_DONE.includes(a.status));
    if (filter === "active") return all.filter((a) => SHIFT_ACTIVE.includes(a.status));
    return all;
  }, [data?.assignments, filter]);

  const counts = useMemo(() => {
    const m = data?.moves ?? [];
    const a = data?.assignments ?? [];
    return {
      completed:
        m.filter((x) => x.status === "Completed").length +
        a.filter((x) => SHIFT_DONE.includes(x.status)).length,
      active:
        m.filter((x) => DRAYAGE_ACTIVE.includes(x.status)).length +
        a.filter((x) => SHIFT_ACTIVE.includes(x.status)).length,
    };
  }, [data?.moves, data?.assignments]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations Log</h1>
        <p className="text-sm text-muted-foreground">
          Completed &amp; in-progress jobs across all companies.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-emerald-600">{counts.completed}</p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-teal-600">{counts.active}</p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">In progress</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        {(["completed", "active", "all"] as Filter[]).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={filter === k ? "default" : "outline"}
            onClick={() => setFilter(k)}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </Button>
        ))}
      </div>

      {opsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading operations…</p>
      ) : opsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {opsQuery.error instanceof Error ? opsQuery.error.message : "Unable to load operations."}
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Drayage jobs ({moves.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {moves.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">No drayage jobs in this view.</p>
              ) : (
                moves.map((m) => {
                  const o = m.drayage_orders;
                  const driver = m.driver_user_id
                    ? data?.namesById[m.driver_user_id] ?? m.driver_user_id.slice(0, 8)
                    : "Unassigned";
                  return (
                    <div key={m.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold">
                          {m.move_type} · {o?.reference_code ?? m.order_id.slice(0, 8)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {o?.container_number || "Container TBD"}
                          {o?.container_size ? ` · ${o.container_size}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">Driver: {driver}</p>
                        <p className="text-xs text-muted-foreground">{fmt(m.updated_at ?? m.created_at)}</p>
                      </div>
                      <Badge variant={STATUS_VARIANT[m.status] ?? "secondary"}>{m.status}</Badge>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Worker shifts ({assignments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {assignments.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">No worker shifts in this view.</p>
              ) : (
                assignments.map((a) => {
                  const shift = data?.shiftsById[a.shift_id];
                  const worker = data?.namesById[a.worker_user_id] ?? a.worker_user_id.slice(0, 8);
                  return (
                    <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold">{shift?.title ?? "Shift"}</p>
                        {shift ? (
                          <p className="text-xs text-muted-foreground">
                            {shift.category} · {shift.date} {shift.start_time}–{shift.end_time}
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">Worker: {worker}</p>
                        <p className="text-xs text-muted-foreground">{fmt(a.created_at)}</p>
                      </div>
                      <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>{a.status}</Badge>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
