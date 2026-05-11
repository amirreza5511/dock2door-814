"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

interface ShiftRow {
  id: string;
  title: string;
  category: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  workers_needed: number;
  employer_company_id: string;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
}

interface TimeEntryRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  clock_in_ts: string;
  clock_out_ts: string | null;
  payroll_status: string;
  total_hours: number | null;
}

interface ConflictRow {
  worker_user_id: string;
  shift_a: string;
  shift_b: string;
  date: string;
}

type Tab = "calendar" | "conflicts" | "assign" | "timeentries";

function statusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Filled") return "success";
  if (s === "Posted") return "default";
  if (s === "Cancelled") return "destructive";
  if (s === "InProgress") return "warning";
  return "secondary";
}

export default function AdminLabourCalendarPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("calendar");

  // Assign form
  const [shiftId, setShiftId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [replaceAssignmentId, setReplaceAssignmentId] = useState("");
  const [assignReason, setAssignReason] = useState("Admin scheduling");

  // Time entry approval
  const [timeEntryId, setTimeEntryId] = useState("");

  const shiftsQ = useQuery({
    queryKey: ["admin", "shifts-cal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_posts")
        .select("id,title,category,date,start_time,end_time,status,workers_needed,employer_company_id")
        .order("date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
  });

  const assignmentsQ = useQuery({
    queryKey: ["admin", "assignments-cal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_assignments")
        .select("id,shift_id,worker_user_id,status")
        .in("status", ["Scheduled", "InProgress"]);
      if (error) throw error;
      return (data ?? []) as AssignmentRow[];
    },
  });

  const timeEntriesQ = useQuery({
    queryKey: ["admin", "time-entries-cal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("id,shift_id,worker_user_id,clock_in_ts,clock_out_ts,payroll_status,total_hours")
        .order("clock_in_ts", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as TimeEntryRow[];
    },
    enabled: tab === "timeentries",
  });

  const conflicts = useMemo<ConflictRow[]>(() => {
    const shifts = shiftsQ.data ?? [];
    const assigns = assignmentsQ.data ?? [];
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const byWorker = new Map<string, { shift: ShiftRow; assignmentId: string }[]>();
    for (const a of assigns) {
      const s = shiftMap.get(a.shift_id);
      if (!s) continue;
      const arr = byWorker.get(a.worker_user_id) ?? [];
      arr.push({ shift: s, assignmentId: a.id });
      byWorker.set(a.worker_user_id, arr);
    }
    const out: ConflictRow[] = [];
    for (const [worker, list] of byWorker) {
      list.sort((x, y) =>
        (x.shift.date + x.shift.start_time).localeCompare(y.shift.date + y.shift.start_time)
      );
      for (let i = 0; i < list.length - 1; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i].shift;
          const B = list[j].shift;
          if (A.date !== B.date) continue;
          if (!(A.end_time <= B.start_time || A.start_time >= B.end_time)) {
            out.push({ worker_user_id: worker, shift_a: A.id, shift_b: B.id, date: A.date });
          }
        }
      }
    }
    return out;
  }, [shiftsQ.data, assignmentsQ.data]);

  const assignMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_assign_worker_to_shift", {
        p_shift_id: shiftId,
        p_worker_user_id: workerId,
        p_replace_assignment_id: replaceAssignmentId || null,
        p_reason: assignReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "shifts-cal"] });
      qc.invalidateQueries({ queryKey: ["admin", "assignments-cal"] });
      setShiftId("");
      setWorkerId("");
      setReplaceAssignmentId("");
    },
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_approve_time_entry", {
        p_time_entry_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "time-entries-cal"] });
      setTimeEntryId("");
    },
  });

  const noShowMut = useMutation({
    mutationFn: async ({ si, wu }: { si: string; wu: string }) => {
      const { error } = await supabase.rpc("mark_shift_no_show", {
        p_shift_id: si,
        p_worker_user_id: wu,
        p_reason: "Conflict resolution",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "shifts-cal"] });
      qc.invalidateQueries({ queryKey: ["admin", "assignments-cal"] });
    },
  });

  const TABS: { id: Tab; label: string }[] = [
    { id: "calendar", label: "Shifts" },
    { id: "conflicts", label: `Conflicts (${conflicts.length})` },
    { id: "assign", label: "Assign Worker" },
    { id: "timeentries", label: "Time Entries" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Labour Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Admin shift overview, conflict detection, worker assignment, and payroll approval.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={tab === t.id ? "default" : "outline"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Shifts calendar view */}
      {tab === "calendar" && (
        <Card>
          <CardHeader>
            <CardTitle>All Shifts</CardTitle>
            <CardDescription>{shiftsQ.data?.length ?? 0} shifts</CardDescription>
          </CardHeader>
          <CardContent>
            {shiftsQ.isLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
            ) : (shiftsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No shifts found.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Title</TH>
                    <TH>Category</TH>
                    <TH>Date</TH>
                    <TH>Time</TH>
                    <TH>Status</TH>
                    <TH>Workers needed</TH>
                    <TH>ID</TH>
                  </TR>
                </THead>
                <TBody>
                  {(shiftsQ.data ?? []).map((s) => (
                    <TR key={s.id}>
                      <TD className="font-medium">{s.title}</TD>
                      <TD><Badge variant="secondary">{s.category}</Badge></TD>
                      <TD>{s.date}</TD>
                      <TD className="text-sm text-muted-foreground">{s.start_time} – {s.end_time}</TD>
                      <TD><Badge variant={statusVariant(s.status)}>{s.status}</Badge></TD>
                      <TD>{s.workers_needed}</TD>
                      <TD>
                        <button
                          className="font-mono text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setShiftId(s.id)}
                          title="Click to copy to assign form"
                        >
                          {s.id.slice(0, 8)}…
                        </button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Conflicts */}
      {tab === "conflicts" && (
        <div className="space-y-3">
          {conflicts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No scheduling conflicts detected.
              </CardContent>
            </Card>
          ) : (
            conflicts.map((c, i) => (
              <Card key={`${c.worker_user_id}-${i}`} className="border-l-4 border-l-destructive">
                <CardContent className="py-4 space-y-2">
                  <p className="font-semibold text-destructive text-sm">Conflict on {c.date}</p>
                  <p className="text-sm">
                    Worker: <span className="font-mono">{c.worker_user_id.slice(0, 8)}…</span>
                  </p>
                  <p className="text-xs text-muted-foreground">Shift A: {c.shift_a.slice(0, 8)}…</p>
                  <p className="text-xs text-muted-foreground">Shift B: {c.shift_b.slice(0, 8)}…</p>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={noShowMut.isPending}
                    onClick={() => noShowMut.mutate({ si: c.shift_a, wu: c.worker_user_id })}
                  >
                    Mark no-show (Shift A)
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Assign worker */}
      {tab === "assign" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Assign / Replace Worker</CardTitle>
              <CardDescription>
                Admin can override normal application flow. Tip: click a shift ID in the calendar tab to prefill.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {assignMut.error && (
                <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {(assignMut.error as Error).message}
                </div>
              )}
              <div className="space-y-1">
                <Label>Shift ID</Label>
                <Input value={shiftId} onChange={(e) => setShiftId(e.target.value)} placeholder="Paste shift id…" />
              </div>
              <div className="space-y-1">
                <Label>Worker user ID</Label>
                <Input value={workerId} onChange={(e) => setWorkerId(e.target.value)} placeholder="Paste worker user id…" />
              </div>
              <div className="space-y-1">
                <Label>Replace assignment ID (optional)</Label>
                <Input
                  value={replaceAssignmentId}
                  onChange={(e) => setReplaceAssignmentId(e.target.value)}
                  placeholder="Existing assignment id to replace"
                />
              </div>
              <div className="space-y-1">
                <Label>Reason</Label>
                <Input value={assignReason} onChange={(e) => setAssignReason(e.target.value)} />
              </div>
              <Button
                disabled={!shiftId || !workerId || assignMut.isPending}
                onClick={() => assignMut.mutate()}
              >
                {assignMut.isPending ? "Assigning…" : "Assign Worker"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Final Payroll Approval</CardTitle>
              <CardDescription>Mark a time entry as invoice/payroll ready.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {approveMut.error && (
                <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {(approveMut.error as Error).message}
                </div>
              )}
              <div className="space-y-1">
                <Label>Time Entry ID</Label>
                <Input
                  value={timeEntryId}
                  onChange={(e) => setTimeEntryId(e.target.value)}
                  placeholder="Paste time_entries.id…"
                />
              </div>
              <Button
                disabled={!timeEntryId || approveMut.isPending}
                onClick={() => approveMut.mutate(timeEntryId)}
              >
                {approveMut.isPending ? "Approving…" : "Mark invoice/payroll ready"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Time entries */}
      {tab === "timeentries" && (
        <Card>
          <CardHeader>
            <CardTitle>Time Entries</CardTitle>
            <CardDescription>Recent clock-in/out records and payroll status.</CardDescription>
          </CardHeader>
          <CardContent>
            {timeEntriesQ.isLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
            ) : (timeEntriesQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No time entries found.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Worker</TH>
                    <TH>Clock in</TH>
                    <TH>Clock out</TH>
                    <TH>Hours</TH>
                    <TH>Payroll</TH>
                    <TH>Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {(timeEntriesQ.data ?? []).map((te) => (
                    <TR key={te.id}>
                      <TD className="font-mono text-xs">{te.worker_user_id.slice(0, 8)}…</TD>
                      <TD className="text-xs">{formatDate(te.clock_in_ts)}</TD>
                      <TD className="text-xs">{te.clock_out_ts ? formatDate(te.clock_out_ts) : "—"}</TD>
                      <TD>{te.total_hours ?? "—"}</TD>
                      <TD>
                        <Badge
                          variant={
                            te.payroll_status === "invoice_ready"
                              ? "success"
                              : te.payroll_status === "company_approved"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {te.payroll_status}
                        </Badge>
                      </TD>
                      <TD>
                        {te.payroll_status !== "invoice_ready" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={approveMut.isPending}
                            onClick={() => approveMut.mutate(te.id)}
                          >
                            Approve
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
