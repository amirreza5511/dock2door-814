"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

interface TimeEntryRow {
  id: string;
  assignment_id: string;
  start_timestamp: string | null;
  end_timestamp: string | null;
  total_hours: number | null;
  employer_confirmed_hours: number | null;
  shift_id?: string;
  shift_title?: string;
  worker_user_id?: string;
  worker_name?: string;
  shift_date?: string;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  worker_confirmed: boolean | null;
  shift_title?: string;
  shift_date?: string;
  shift_end?: string;
  worker_name?: string;
}

type Tab = "confirm" | "noshow";

export default function EmployerHoursPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("confirm");

  // Confirm hours modal
  const [confirmTarget, setConfirmTarget] = useState<TimeEntryRow | null>(null);
  const [confirmHours, setConfirmHours] = useState("");
  const [confirmNotes, setConfirmNotes] = useState("");

  // No-show modal
  const [noShowTarget, setNoShowTarget] = useState<AssignmentRow | null>(null);
  const [noShowReason, setNoShowReason] = useState("");

  // Pending time entries (clocked out, not yet confirmed) for this employer's shifts
  const entriesQ = useQuery({
    queryKey: ["employer", "hours-pending"],
    queryFn: async (): Promise<TimeEntryRow[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: memberships } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .eq("status", "Active");
      const companyIds = (memberships ?? []).map((m: { company_id: string }) => m.company_id);
      if (companyIds.length === 0) return [];

      const { data: shifts } = await supabase
        .from("shift_posts")
        .select("id,title,date")
        .in("employer_company_id", companyIds);
      const shiftMap = new Map<string, { title: string; date: string }>();
      for (const s of shifts ?? []) shiftMap.set(s.id, { title: s.title, date: s.date });
      const shiftIds = Array.from(shiftMap.keys());
      if (shiftIds.length === 0) return [];

      const { data: assignments } = await supabase
        .from("shift_assignments")
        .select("id, shift_id, worker_user_id")
        .in("shift_id", shiftIds);
      const assignMap = new Map<string, { shift_id: string; worker_user_id: string }>();
      for (const a of assignments ?? []) assignMap.set(a.id, { shift_id: a.shift_id, worker_user_id: a.worker_user_id });
      const assignmentIds = Array.from(assignMap.keys());
      if (assignmentIds.length === 0) return [];

      const { data: entries, error } = await supabase
        .from("time_entries")
        .select("id, assignment_id, start_timestamp, end_timestamp, total_hours, employer_confirmed_hours")
        .in("assignment_id", assignmentIds)
        .not("end_timestamp", "is", null)
        .is("employer_confirmed_hours", null)
        .order("end_timestamp", { ascending: false });
      if (error) throw error;

      const workerIds = Array.from(new Set((entries ?? []).map((e: TimeEntryRow) => assignMap.get(e.assignment_id)?.worker_user_id).filter(Boolean) as string[]));
      const nameMap = new Map<string, string>();
      if (workerIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, name").in("id", workerIds);
        for (const p of profs ?? []) nameMap.set(p.id, p.name ?? "Unknown");
      }

      return (entries ?? []).map((e: TimeEntryRow) => {
        const a = assignMap.get(e.assignment_id);
        const s = a ? shiftMap.get(a.shift_id) : null;
        return {
          ...e,
          shift_id: a?.shift_id,
          shift_title: s?.title ?? "—",
          shift_date: s?.date,
          worker_user_id: a?.worker_user_id,
          worker_name: a ? nameMap.get(a.worker_user_id) ?? "Unknown" : "—",
        };
      });
    },
  });

  // No-show candidates: assignments with status Scheduled where shift end is in the past, OR worker_confirmed is false
  const noShowQ = useQuery({
    queryKey: ["employer", "noshow-candidates"],
    queryFn: async (): Promise<AssignmentRow[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: memberships } = await supabase
        .from("company_users").select("company_id").eq("user_id", user.id).eq("status", "Active");
      const companyIds = (memberships ?? []).map((m: { company_id: string }) => m.company_id);
      if (companyIds.length === 0) return [];

      const { data: shifts } = await supabase
        .from("shift_posts").select("id,title,date,end_time")
        .in("employer_company_id", companyIds);
      const shiftMap = new Map<string, { title: string; date: string; end_time: string }>();
      for (const s of shifts ?? []) shiftMap.set(s.id, { title: s.title, date: s.date, end_time: s.end_time });
      const shiftIds = Array.from(shiftMap.keys());
      if (shiftIds.length === 0) return [];

      const { data: assigns, error } = await supabase
        .from("shift_assignments")
        .select("id, shift_id, worker_user_id, status, worker_confirmed")
        .in("shift_id", shiftIds)
        .in("status", ["Scheduled", "InProgress"]);
      if (error) throw error;

      const workerIds = Array.from(new Set((assigns ?? []).map((a: AssignmentRow) => a.worker_user_id)));
      const nameMap = new Map<string, string>();
      if (workerIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, name").in("id", workerIds);
        for (const p of profs ?? []) nameMap.set(p.id, p.name ?? "Unknown");
      }

      const now = Date.now();
      return (assigns ?? [])
        .map((a: AssignmentRow) => {
          const s = shiftMap.get(a.shift_id);
          return {
            ...a,
            shift_title: s?.title ?? "—",
            shift_date: s?.date,
            shift_end: s?.end_time,
            worker_name: nameMap.get(a.worker_user_id) ?? "Unknown",
          };
        })
        .filter((a: AssignmentRow) => {
          if (a.worker_confirmed === false) return true;
          if (!a.shift_date || !a.shift_end) return false;
          const endTs = new Date(`${a.shift_date}T${a.shift_end}`).getTime();
          return endTs < now;
        });
    },
  });

  const confirmMut = useMutation({
    mutationFn: async ({ id, hours, notes, shiftId }: { id: string; hours: number; notes: string; shiftId?: string }) => {
      const { error } = await supabase.rpc("employer_confirm_hours", {
        p_time_entry_id: id,
        p_hours: hours,
        p_notes: notes,
      });
      if (error) throw error;
      // Auto-issue invoice + worker payable record. Idempotent — safe if already issued.
      if (shiftId) {
        const { error: invErr } = await supabase.rpc("issue_invoice_for_shift", {
          p_shift_id: shiftId,
          p_due_days: null,
        });
        if (invErr) console.warn("[hours] issue_invoice_for_shift", invErr.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employer", "hours-pending"] });
      qc.invalidateQueries({ queryKey: ["employer", "invoices"] });
      setConfirmTarget(null);
      setConfirmHours("");
      setConfirmNotes("");
    },
  });

  const noShowMut = useMutation({
    mutationFn: async ({ shiftId, workerUserId, reason }: { shiftId: string; workerUserId: string; reason: string }) => {
      const { error } = await supabase.rpc("mark_shift_no_show", {
        p_shift_id: shiftId,
        p_worker_user_id: workerUserId,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employer", "noshow-candidates"] });
      setNoShowTarget(null);
      setNoShowReason("");
    },
  });

  const openConfirm = (e: TimeEntryRow) => {
    setConfirmTarget(e);
    setConfirmHours(e.total_hours != null ? String(e.total_hours) : "");
    setConfirmNotes("");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hours &amp; attendance</h1>
        <p className="text-sm text-muted-foreground">
          Confirm hours submitted by workers, or mark a no-show with a real reason.
        </p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={tab === "confirm" ? "default" : "outline"} onClick={() => setTab("confirm")}>
          Hours to confirm{(entriesQ.data?.length ?? 0) > 0 ? ` (${entriesQ.data?.length})` : ""}
        </Button>
        <Button size="sm" variant={tab === "noshow" ? "default" : "outline"} onClick={() => setTab("noshow")}>
          No-show candidates{(noShowQ.data?.length ?? 0) > 0 ? ` (${noShowQ.data?.length})` : ""}
        </Button>
      </div>

      {tab === "confirm" && (
        <Card>
          <CardHeader>
            <CardTitle>Hours awaiting confirmation</CardTitle>
            <CardDescription>Workers have clocked out — confirm their hours so payroll can proceed.</CardDescription>
          </CardHeader>
          <CardContent>
            {entriesQ.isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading…</p>
            ) : (entriesQ.data ?? []).length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Nothing to confirm right now.</p>
            ) : (
              <Table>
                <THead>
                  <TR><TH>Worker</TH><TH>Shift</TH><TH>Date</TH><TH>Clock in/out</TH><TH>Submitted hrs</TH><TH></TH></TR>
                </THead>
                <TBody>
                  {(entriesQ.data ?? []).map((e) => (
                    <TR key={e.id}>
                      <TD className="font-medium">{e.worker_name}</TD>
                      <TD>{e.shift_title}</TD>
                      <TD className="text-xs text-muted-foreground">{e.shift_date ?? "—"}</TD>
                      <TD className="text-xs text-muted-foreground">
                        {e.start_timestamp ? new Date(e.start_timestamp).toLocaleTimeString() : "—"}
                        {" → "}
                        {e.end_timestamp ? new Date(e.end_timestamp).toLocaleTimeString() : "—"}
                      </TD>
                      <TD>{e.total_hours != null ? `${Number(e.total_hours).toFixed(2)}h` : "—"}</TD>
                      <TD className="text-right">
                        <Button size="sm" onClick={() => openConfirm(e)}>Confirm</Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "noshow" && (
        <Card>
          <CardHeader>
            <CardTitle>No-show candidates</CardTitle>
            <CardDescription>
              Scheduled or in-progress workers whose shift end has passed, or who declined attendance. A real reason is required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {noShowQ.isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading…</p>
            ) : (noShowQ.data ?? []).length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No candidates right now.</p>
            ) : (
              <Table>
                <THead>
                  <TR><TH>Worker</TH><TH>Shift</TH><TH>Date</TH><TH>Status</TH><TH></TH></TR>
                </THead>
                <TBody>
                  {(noShowQ.data ?? []).map((a) => (
                    <TR key={a.id}>
                      <TD className="font-medium">{a.worker_name}</TD>
                      <TD>{a.shift_title}</TD>
                      <TD className="text-xs text-muted-foreground">{a.shift_date ?? "—"}</TD>
                      <TD>
                        <Badge variant={a.worker_confirmed === false ? "destructive" : "warning"}>
                          {a.worker_confirmed === false ? "Declined" : a.status}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        <Button size="sm" variant="destructive" onClick={() => { setNoShowTarget(a); setNoShowReason(""); }}>
                          Mark no-show
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmTarget(null)}>
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Confirm hours</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {confirmTarget.worker_name} · {confirmTarget.shift_title}
            </p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Hours *</Label>
                <Input type="number" min={0} step={0.25} value={confirmHours} onChange={(e) => setConfirmHours(e.target.value)} />
                <p className="text-xs text-muted-foreground">Worker submitted {confirmTarget.total_hours != null ? `${Number(confirmTarget.total_hours).toFixed(2)}h` : "—"}.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes (optional)</Label>
                <Input value={confirmNotes} onChange={(e) => setConfirmNotes(e.target.value)} placeholder="e.g. adjusted for unpaid break" />
              </div>
              {confirmMut.error && <p className="text-xs text-destructive">{(confirmMut.error as Error).message}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmTarget(null)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!confirmHours || Number(confirmHours) <= 0 || confirmMut.isPending}
                  onClick={() => confirmMut.mutate({ id: confirmTarget.id, hours: Number(confirmHours), notes: confirmNotes.trim(), shiftId: confirmTarget.shift_id })}
                >
                  {confirmMut.isPending ? "Confirming…" : "Confirm hours"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {noShowTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setNoShowTarget(null)}>
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-destructive">Mark no-show</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {noShowTarget.worker_name} · {noShowTarget.shift_title}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              A specific reason is required. This is logged in audit and affects the worker&apos;s record. Minimum 10 characters.
            </p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Reason *</Label>
                <Input
                  value={noShowReason}
                  onChange={(e) => setNoShowReason(e.target.value)}
                  placeholder="e.g. Did not arrive at site, no communication for 2h"
                  autoFocus
                />
              </div>
              {noShowMut.error && <p className="text-xs text-destructive">{(noShowMut.error as Error).message}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setNoShowTarget(null)}>Cancel</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={noShowReason.trim().length < 10 || noShowMut.isPending}
                  onClick={() => noShowMut.mutate({ shiftId: noShowTarget.shift_id, workerUserId: noShowTarget.worker_user_id, reason: noShowReason.trim() })}
                >
                  {noShowMut.isPending ? "Marking…" : "Mark no-show"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
