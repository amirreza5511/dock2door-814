"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, CheckCircle, XCircle, Clock, Star, Award, User as UserIcon,
  AlertCircle, LogIn, LogOut, MessageCircle, Copy, ChevronDown, ChevronUp,
} from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ShiftStatus = "Posted" | "Filled" | "InProgress" | "Completed" | "Cancelled" | "Draft";
const FILTERS: (ShiftStatus | "All")[] = ["All", "Posted", "Filled", "InProgress", "Completed", "Cancelled"];

interface ShiftRow {
  id: string;
  title: string;
  category: string | null;
  status: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  hourly_rate: number | null;
  workers_needed: number | null;
  location_city: string | null;
  location_address: string | null;
  minimum_hours: number | null;
  requirements: string | null;
  notes: string | null;
  created_at: string;
}

interface AppRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  applied_at: string;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  confirmed_rate: number;
  status: string;
  worker_confirmed: boolean | null;
  cancellation_reason: string | null;
}

interface TimeEntryRow {
  id: string;
  assignment_id: string;
  start_timestamp: string | null;
  end_timestamp: string | null;
  employer_confirmed_hours: number | null;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive" | "default"> = {
  Posted: "success", Filled: "success", Draft: "secondary",
  InProgress: "default", Scheduled: "warning", Completed: "secondary",
  HoursConfirmed: "success", Confirmed: "success", Cancelled: "destructive", NoShow: "destructive",
};

function fmtTs(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function calcHours(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
}
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export default function EmployerShiftsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const router = useRouter();

  const [filter, setFilter] = useState<ShiftStatus | "All">("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<{ id: string; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [noShowFor, setNoShowFor] = useState<AssignmentRow | null>(null);
  const [noShowReason, setNoShowReason] = useState("");
  const [cancelFor, setCancelFor] = useState<ShiftRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [editHoursFor, setEditHoursFor] = useState<string | null>(null);
  const [hoursValue, setHoursValue] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["emp-shifts"] });
    qc.invalidateQueries({ queryKey: ["emp-apps"] });
    qc.invalidateQueries({ queryKey: ["emp-assignments"] });
    qc.invalidateQueries({ queryKey: ["emp-timeentries"] });
  };

  const companyQ = useQuery({
    queryKey: ["emp-company"],
    queryFn: async (): Promise<string[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from("company_users").select("company_id").eq("user_id", user.id).eq("status", "Active");
      return (data ?? []).map((m: { company_id: string }) => m.company_id);
    },
  });
  const companyIds = companyQ.data ?? [];

  const shiftsQ = useQuery({
    queryKey: ["emp-shifts", companyIds],
    enabled: companyIds.length > 0,
    queryFn: async (): Promise<ShiftRow[]> => {
      const { data, error } = await supabase
        .from("shift_posts")
        .select("id,title,category,status,date,start_time,end_time,hourly_rate,workers_needed,location_city,location_address,minimum_hours,requirements,notes,created_at")
        .in("employer_company_id", companyIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
  });
  const myShifts = shiftsQ.data ?? [];
  const shiftIds = useMemo(() => myShifts.map((s) => s.id), [myShifts]);

  const appsQ = useQuery({
    queryKey: ["emp-apps", shiftIds],
    enabled: shiftIds.length > 0,
    queryFn: async (): Promise<AppRow[]> => {
      const { data } = await supabase
        .from("shift_applications")
        .select("id,shift_id,worker_user_id,status,applied_at")
        .in("shift_id", shiftIds).eq("status", "Applied");
      return (data ?? []) as AppRow[];
    },
    refetchInterval: 20_000,
  });

  const assignmentsQ = useQuery({
    queryKey: ["emp-assignments", shiftIds],
    enabled: shiftIds.length > 0,
    queryFn: async (): Promise<AssignmentRow[]> => {
      const { data } = await supabase
        .from("shift_assignments")
        .select("id,shift_id,worker_user_id,confirmed_rate,status,worker_confirmed,cancellation_reason")
        .in("shift_id", shiftIds);
      return (data ?? []) as AssignmentRow[];
    },
    refetchInterval: 20_000,
  });

  const allAssignments = assignmentsQ.data ?? [];
  const assignmentIds = useMemo(() => allAssignments.map((a) => a.id), [allAssignments]);

  const teQ = useQuery({
    queryKey: ["emp-timeentries", assignmentIds],
    enabled: assignmentIds.length > 0,
    queryFn: async (): Promise<TimeEntryRow[]> => {
      const { data } = await supabase
        .from("time_entries")
        .select("id,assignment_id,start_timestamp,end_timestamp,employer_confirmed_hours")
        .in("assignment_id", assignmentIds);
      return (data ?? []) as TimeEntryRow[];
    },
    refetchInterval: 20_000,
  });

  // Worker names + profiles + ratings
  const workerIds = useMemo(() => {
    const s = new Set<string>();
    (appsQ.data ?? []).forEach((a) => s.add(a.worker_user_id));
    allAssignments.forEach((a) => s.add(a.worker_user_id));
    return Array.from(s);
  }, [appsQ.data, allAssignments]);

  const profilesQ = useQuery({
    queryKey: ["emp-worker-profiles", workerIds],
    enabled: workerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("worker_profiles")
        .select("user_id,display_name,bio,skills")
        .in("user_id", workerIds);
      const map = new Map<string, { display_name: string | null; bio: string | null; skills: string[] | null }>();
      for (const p of data ?? []) map.set(p.user_id, p);
      const { data: names } = await supabase.from("profiles").select("id,name").in("id", workerIds);
      const nameMap = new Map<string, string>();
      for (const n of names ?? []) nameMap.set(n.id, n.name ?? "Worker");
      return { profiles: map, names: nameMap };
    },
  });

  const ratingsQ = useQuery({
    queryKey: ["emp-worker-ratings", workerIds],
    enabled: workerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("review_summaries").select("target_id,avg_rating,total")
        .eq("target_kind", "worker").in("target_id", workerIds);
      const map = new Map<string, { avg: number; total: number }>();
      for (const r of data ?? []) map.set(r.target_id, { avg: Number(r.avg_rating), total: r.total });
      return map;
    },
  });

  const workerName = (id: string) => profilesQ.data?.profiles.get(id)?.display_name ?? profilesQ.data?.names.get(id) ?? "Worker";

  const acceptM = useMutation({
    mutationFn: async (appId: string) => {
      const { error } = await supabase.rpc("employer_accept_applicant", { p_application_id: appId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const rejectM = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("employer_reject_applicant", { p_application_id: id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setRejectFor(null); setRejectReason(""); },
  });
  const noShowM = useMutation({
    mutationFn: async ({ shiftId, workerId, reason }: { shiftId: string; workerId: string; reason: string }) => {
      const { error } = await supabase.rpc("mark_shift_no_show", { p_shift_id: shiftId, p_worker_user_id: workerId, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setNoShowFor(null); setNoShowReason(""); },
  });
  const clockInM = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error: te } = await supabase.from("time_entries").insert({ assignment_id: assignmentId, start_timestamp: new Date().toISOString() });
      if (te) throw te;
      const { error: a } = await supabase.from("shift_assignments").update({ status: "InProgress" }).eq("id", assignmentId);
      if (a) throw a;
    },
    onSuccess: invalidate,
  });
  const clockOutM = useMutation({
    mutationFn: async ({ assignmentId, teId }: { assignmentId: string; teId: string }) => {
      const { error: te } = await supabase.from("time_entries").update({ end_timestamp: new Date().toISOString() }).eq("id", teId);
      if (te) throw te;
      const { error: a } = await supabase.from("shift_assignments").update({ status: "Completed" }).eq("id", assignmentId);
      if (a) throw a;
    },
    onSuccess: invalidate,
  });
  const confirmHoursM = useMutation({
    mutationFn: async ({ teId, hours, shiftId }: { teId: string; hours: number; shiftId: string }) => {
      const { error } = await supabase.rpc("employer_confirm_hours", { p_time_entry_id: teId, p_hours: hours, p_notes: "" });
      if (error) throw error;
      const { error: inv } = await supabase.rpc("issue_invoice_for_shift", { p_shift_id: shiftId, p_due_days: null });
      if (inv) console.warn("[shifts] issue_invoice_for_shift", inv.message);
    },
    onSuccess: () => { invalidate(); setEditHoursFor(null); setHoursValue(""); },
  });
  const completeM = useMutation({
    mutationFn: async (shiftId: string) => {
      const { error } = await supabase.rpc("employer_close_shift_post", { p_shift_id: shiftId, p_reason: "Shift completed by employer" });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setSelectedId(null); },
  });
  const cancelM = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("cancel_shift_with_reason", { p_shift_id: id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setCancelFor(null); setCancelReason(""); },
  });
  const openThreadM = useMutation({
    mutationFn: async (shiftId: string) => {
      const { error } = await supabase.rpc("open_shift_thread", { p_shift_id: shiftId });
      if (error) throw error;
    },
    onSuccess: () => router.push("/messages"),
  });

  const filtered = filter === "All" ? myShifts : myShifts.filter((s) => s.status === filter);
  const selected = myShifts.find((s) => s.id === selectedId) ?? null;
  const getApps = (id: string) => (appsQ.data ?? []).filter((a) => a.shift_id === id);
  const getAssigns = (id: string) => allAssignments.filter((a) => a.shift_id === id);
  const getTE = (assignmentId: string) => (teQ.data ?? []).find((t) => t.assignment_id === assignmentId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Shifts</h1>
          <p className="text-sm text-muted-foreground">
            {myShifts.length} total · {(appsQ.data ?? []).length} pending applicants
          </p>
        </div>
        <Link href="/employer/create-shift"><Button>+ Post shift</Button></Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === f ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {shiftsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!shiftsQ.isLoading && filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No shifts here.</p>
        )}
        {filtered.map((s) => {
          const apps = getApps(s.id);
          const assigns = getAssigns(s.id);
          return (
            <Card key={s.id} className="cursor-pointer transition-colors hover:border-primary/40" onClick={() => { setSelectedId(s.id); setExpandedApp(null); }}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.location_city ?? "—"} · {s.date} · {s.start_time}–{s.end_time}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ${s.hourly_rate}/hr · {s.workers_needed} needed
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {apps.length > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-1 text-xs font-semibold text-yellow-500">
                      <Users className="h-3 w-3" /> {apps.length}
                    </span>
                  )}
                  {assigns.length > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-500">
                      <CheckCircle className="h-3 w-3" /> {assigns.length}
                    </span>
                  )}
                  <Badge variant={STATUS_VARIANT[s.status] ?? "secondary"}>{s.status}</Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setSelectedId(null)}>
          <div className="my-8 w-full max-w-2xl rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.location_address}, {selected.location_city} · {selected.date} · {selected.start_time}–{selected.end_time}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[selected.status] ?? "secondary"}>{selected.status}</Badge>
            </div>

            {/* Applicants */}
            {getApps(selected.id).length > 0 && (
              <section className="mt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Applicants ({getApps(selected.id).length})
                </h3>
                <div className="space-y-2">
                  {getApps(selected.id).map((app) => {
                    const prof = profilesQ.data?.profiles.get(app.worker_user_id);
                    const rating = ratingsQ.data?.get(app.worker_user_id);
                    const isExp = expandedApp === app.id;
                    return (
                      <div key={app.id} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setExpandedApp(isExp ? null : app.id)}>
                            <div className="grid h-9 w-9 place-items-center rounded-full bg-muted text-sm font-semibold">
                              {workerName(app.worker_user_id).charAt(0)}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{workerName(app.worker_user_id)}</p>
                              <p className="text-xs text-muted-foreground">Applied {app.applied_at.split("T")[0]}</p>
                            </div>
                            {isExp ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </button>
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="outline" className="text-emerald-500" disabled={acceptM.isPending} onClick={() => acceptM.mutate(app.id)}>
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setRejectReason(""); setRejectFor({ id: app.id, name: workerName(app.worker_user_id) }); }}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {isExp && (
                          <div className="mt-3 space-y-2 border-t pt-3">
                            {(prof?.skills ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {(prof!.skills ?? []).map((sk) => <Badge key={sk} variant="secondary">{sk}</Badge>)}
                              </div>
                            )}
                            {rating && rating.total > 0 && (
                              <div className="flex items-center gap-1 text-xs">
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <Star key={n} className={`h-3.5 w-3.5 ${n <= Math.round(rating.avg) ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"}`} />
                                ))}
                                <span className="ml-1 text-muted-foreground">{rating.avg.toFixed(1)} ({rating.total})</span>
                              </div>
                            )}
                            {prof?.bio && <p className="line-clamp-2 text-xs text-muted-foreground">{prof.bio}</p>}
                            <Link href={`/worker/${app.worker_user_id}`} className="text-xs font-semibold text-primary hover:underline">
                              View full profile →
                            </Link>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Assignments */}
            {getAssigns(selected.id).length > 0 && (
              <section className="mt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assignments</h3>
                <div className="space-y-3">
                  {getAssigns(selected.id).map((ass) => {
                    const te = getTE(ass.id);
                    const clockHours = te?.start_timestamp && te?.end_timestamp ? calcHours(te.start_timestamp, te.end_timestamp) : null;
                    const preFilled = clockHours ? roundHalf(clockHours) : 0;
                    return (
                      <div key={ass.id} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <div className="grid h-9 w-9 place-items-center rounded-full bg-muted"><UserIcon className="h-4 w-4 text-primary" /></div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{workerName(ass.worker_user_id)}</p>
                            <p className="text-xs text-muted-foreground">${ass.confirmed_rate}/hr</p>
                          </div>
                          <Button size="sm" variant="outline" disabled={openThreadM.isPending} onClick={() => openThreadM.mutate(ass.shift_id)}>
                            <MessageCircle className="mr-1 h-3.5 w-3.5" /> Message
                          </Button>
                          <Badge variant={STATUS_VARIANT[ass.status] ?? "secondary"}>{ass.status}</Badge>
                        </div>

                        {ass.worker_confirmed === true && (
                          <p className="mt-2 flex items-center gap-1 text-xs text-emerald-500"><CheckCircle className="h-3.5 w-3.5" /> Worker confirmed attendance</p>
                        )}
                        {ass.worker_confirmed === false && (
                          <p className="mt-2 flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" /> Worker cancelled{ass.cancellation_reason ? `: ${ass.cancellation_reason}` : ""}</p>
                        )}

                        {/* Clock-in / out / confirm */}
                        <div className="mt-3">
                          {(!te || !te.start_timestamp) && !["Cancelled", "NoShow"].includes(ass.status) && (
                            <Button size="sm" variant="outline" className="w-full" disabled={clockInM.isPending} onClick={() => clockInM.mutate(ass.id)}>
                              <LogIn className="mr-1 h-3.5 w-3.5" /> Clock in worker
                            </Button>
                          )}
                          {te && te.start_timestamp && !te.end_timestamp && (
                            <div className="space-y-2">
                              <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Clocked in at {fmtTs(te.start_timestamp)}</p>
                              <Button size="sm" className="w-full" disabled={clockOutM.isPending} onClick={() => clockOutM.mutate({ assignmentId: ass.id, teId: te.id })}>
                                <LogOut className="mr-1 h-3.5 w-3.5" /> Clock out worker
                              </Button>
                            </div>
                          )}
                          {te && te.end_timestamp && te.employer_confirmed_hours == null && (
                            <div className="space-y-2 rounded-md bg-muted/40 p-3">
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3.5 w-3.5" /> Clocked: {fmtTs(te.start_timestamp!)} – {fmtTs(te.end_timestamp)} ({clockHours?.toFixed(2)}h)
                              </p>
                              {editHoursFor === ass.id ? (
                                <div className="space-y-2">
                                  <Input type="number" min={0} step={0.25} value={hoursValue} onChange={(e) => setHoursValue(e.target.value)} placeholder={String(preFilled)} />
                                  <div className="flex gap-2">
                                    <Button size="sm" className="flex-1" disabled={!hoursValue || Number(hoursValue) <= 0 || confirmHoursM.isPending}
                                      onClick={() => confirmHoursM.mutate({ teId: te.id, hours: Number(hoursValue), shiftId: ass.shift_id })}>
                                      Confirm
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditHoursFor(null)}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <Button size="sm" className="flex-1" disabled={confirmHoursM.isPending}
                                    onClick={() => confirmHoursM.mutate({ teId: te.id, hours: preFilled, shiftId: ass.shift_id })}>
                                    <CheckCircle className="mr-1 h-3.5 w-3.5" /> Confirm exact ({preFilled}h)
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => { setHoursValue(String(preFilled)); setEditHoursFor(ass.id); }}>Edit</Button>
                                </div>
                              )}
                            </div>
                          )}
                          {te?.employer_confirmed_hours != null && (
                            <p className="flex items-center gap-1 text-xs text-emerald-500"><CheckCircle className="h-3.5 w-3.5" /> {te.employer_confirmed_hours}h confirmed</p>
                          )}
                        </div>

                        {ass.status === "Scheduled" && (
                          <Button size="sm" variant="outline" className="mt-2 w-full text-destructive" onClick={() => { setNoShowFor(ass); setNoShowReason(""); }}>
                            <AlertCircle className="mr-1 h-3.5 w-3.5" /> Mark no-show
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Actions */}
            <div className="mt-6 space-y-2 border-t pt-4">
              {(() => {
                const ass = getAssigns(selected.id);
                const TERMINAL = ["Completed", "HoursConfirmed", "Confirmed", "Cancelled", "NoShow"];
                const allResolved = ass.length > 0 && ass.every((a) => TERMINAL.includes(a.status));
                const canComplete = ["Filled", "InProgress"].includes(selected.status) && allResolved;
                const canCancel = ["Posted", "Filled", "InProgress"].includes(selected.status);
                return (
                  <>
                    {canComplete && (
                      <Button className="w-full" disabled={completeM.isPending} onClick={() => completeM.mutate(selected.id)}>
                        <CheckCircle className="mr-1 h-4 w-4" /> Complete shift
                      </Button>
                    )}
                    {["Filled", "InProgress"].includes(selected.status) && !allResolved && (
                      <p className="text-center text-xs text-muted-foreground">Confirm hours or mark no-show for every worker before completing.</p>
                    )}
                    {canCancel && (
                      <Button variant="destructive" className="w-full" onClick={() => { setCancelFor(selected); setCancelReason(""); setSelectedId(null); }}>
                        Cancel shift
                      </Button>
                    )}
                  </>
                );
              })()}
              <Button variant="outline" className="w-full" asChild>
                <Link href={{
                  pathname: "/employer/create-shift",
                  query: {
                    title: selected.title,
                    category: selected.category ?? "",
                    address: selected.location_address ?? "",
                    city: selected.location_city ?? "",
                    hourlyRate: selected.hourly_rate ? String(selected.hourly_rate) : "",
                    minHours: String(selected.minimum_hours ?? ""),
                    workersNeeded: String(selected.workers_needed ?? ""),
                    requirements: selected.requirements ?? "",
                    notes: (selected.notes ?? "").replace("[URGENT] ", ""),
                  },
                }}>
                  <Copy className="mr-1 h-4 w-4" /> Duplicate shift
                </Link>
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Reject dialog */}
      {rejectFor && (
        <Dialog title={`Reject ${rejectFor.name}`} onClose={() => setRejectFor(null)}>
          <p className="text-xs text-muted-foreground">The worker sees this reason in their Applications list. Keep it professional. Minimum 10 characters.</p>
          <Label className="text-xs">Reason *</Label>
          <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Position filled" autoFocus />
          {rejectM.error && <p className="text-xs text-destructive">{(rejectM.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setRejectFor(null)}>Dismiss</Button>
            <Button size="sm" variant="destructive" disabled={rejectReason.trim().length < 10 || rejectM.isPending}
              onClick={() => rejectM.mutate({ id: rejectFor.id, reason: rejectReason.trim() })}>
              {rejectM.isPending ? "Rejecting…" : "Send rejection"}
            </Button>
          </div>
        </Dialog>
      )}

      {/* No-show dialog */}
      {noShowFor && (
        <Dialog title={`Mark no-show · ${workerName(noShowFor.worker_user_id)}`} onClose={() => setNoShowFor(null)}>
          <p className="text-xs text-muted-foreground">A specific reason is required. Logged in audit and affects the worker&apos;s record. Minimum 10 characters.</p>
          <Label className="text-xs">Reason *</Label>
          <Input value={noShowReason} onChange={(e) => setNoShowReason(e.target.value)} placeholder="e.g. Did not arrive at site" autoFocus />
          {noShowM.error && <p className="text-xs text-destructive">{(noShowM.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setNoShowFor(null)}>Dismiss</Button>
            <Button size="sm" variant="destructive" disabled={noShowReason.trim().length < 10 || noShowM.isPending}
              onClick={() => noShowM.mutate({ shiftId: noShowFor.shift_id, workerId: noShowFor.worker_user_id, reason: noShowReason.trim() })}>
              {noShowM.isPending ? "Marking…" : "Mark no-show"}
            </Button>
          </div>
        </Dialog>
      )}

      {/* Cancel dialog */}
      {cancelFor && (
        <Dialog title={`Cancel shift: ${cancelFor.title}`} onClose={() => setCancelFor(null)}>
          <p className="text-xs text-muted-foreground">This notifies all applicants and cannot be undone. Provide a specific reason (min 10 characters).</p>
          <Label className="text-xs">Reason *</Label>
          <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Shift no longer needed" autoFocus />
          {cancelM.error && <p className="text-xs text-destructive">{(cancelM.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setCancelFor(null)}>Dismiss</Button>
            <Button size="sm" variant="destructive" disabled={cancelReason.trim().length < 10 || cancelM.isPending}
              onClick={() => cancelM.mutate({ id: cancelFor.id, reason: cancelReason.trim() })}>
              {cancelM.isPending ? "Cancelling…" : "Confirm cancel"}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
