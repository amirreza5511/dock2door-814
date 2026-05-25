"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

interface ShiftRow {
  id: string;
  title: string;
  category: string;
  status: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  hourly_rate: number | null;
  workers_needed: number | null;
  location_city: string | null;
  requirements: string | null;
  created_at: string;
}

interface ApplicationRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  applied_at: string;
  shift_title?: string;
  worker_name?: string;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  Posted: "success",
  Filled: "success",
  Draft: "secondary",
  InProgress: "default" as any,
  Completed: "secondary",
  Cancelled: "destructive",
};

const PAGE_SIZE = 50;

export default function EmployerPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"shifts" | "applications">("shifts");

  // Cancel confirmation state
  const [cancelTarget, setCancelTarget] = useState<{ id: string; title: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Reject applicant state — reason required
  const [rejectTarget, setRejectTarget] = useState<{ id: string; workerName: string; shiftTitle: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Worker qualifications drawer
  const [qualsFor, setQualsFor] = useState<{ workerId: string; workerName: string } | null>(null);

  // Pagination
  const [shiftsPage, setShiftsPage] = useState(1);
  const [appsPage, setAppsPage] = useState(1);

  const shiftsQ = useQuery({
    queryKey: ["employer", "shifts", shiftsPage],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_posts")
        .select("id,title,category,status,date,start_time,end_time,hourly_rate,workers_needed,location_city,requirements,created_at")
        .order("date", { ascending: false })
        .range(0, shiftsPage * PAGE_SIZE - 1);
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
  });

  const appsQ = useQuery({
    queryKey: ["employer", "applications", appsPage],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // 1) Get this user's active companies
      const { data: memberships, error: memErr } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .eq("status", "Active");
      if (memErr) throw memErr;
      const companyIds = (memberships ?? []).map((m: { company_id: string }) => m.company_id);
      if (companyIds.length === 0) return [];

      // 2) Fetch shifts owned by those companies
      const { data: shifts, error: shiftErr } = await supabase
        .from("shift_posts")
        .select("id, title, employer_company_id")
        .in("employer_company_id", companyIds);
      if (shiftErr) throw shiftErr;
      const shiftMap = new Map<string, string>();
      for (const s of shifts ?? []) shiftMap.set(s.id, s.title ?? "—");
      const shiftIds = Array.from(shiftMap.keys());
      if (shiftIds.length === 0) return [];

      // 3) Fetch applications scoped to this employer's shifts
      const { data: apps, error: appErr } = await supabase
        .from("shift_applications")
        .select("id, shift_id, worker_user_id, status, applied_at")
        .in("shift_id", shiftIds)
        .order("applied_at", { ascending: false })
        .range(0, appsPage * PAGE_SIZE - 1);
      if (appErr) throw appErr;

      // 4) Fetch worker names manually (avoid fragile FK embedding)
      const workerIds = Array.from(new Set((apps ?? []).map((a) => a.worker_user_id)));
      const nameMap = new Map<string, string>();
      if (workerIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", workerIds);
        for (const p of profs ?? []) nameMap.set(p.id, p.name ?? "Unknown");
      }

      return (apps ?? []).map((a) => ({
        id: a.id,
        shift_id: a.shift_id,
        worker_user_id: a.worker_user_id,
        status: a.status,
        applied_at: a.applied_at,
        shift_title: shiftMap.get(a.shift_id) ?? "—",
        worker_name: nameMap.get(a.worker_user_id) ?? "Unknown",
      })) as ApplicationRow[];
    },
  });

  const acceptApp = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("employer_accept_applicant", { p_application_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employer", "applications"] });
      qc.invalidateQueries({ queryKey: ["employer", "shifts"] });
    },
  });

  const rejectApp = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("employer_reject_applicant", {
        p_application_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employer", "applications"] });
      setRejectTarget(null);
      setRejectReason("");
    },
  });

  // Safe approved-qualifications summary — RPC enforces caller's right to see this worker.
  const qualsQ = useQuery({
    queryKey: ["employer", "worker-quals", qualsFor?.workerId],
    enabled: !!qualsFor?.workerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("employer_worker_qualifications_summary", {
        p_worker_user_id: qualsFor!.workerId,
      });
      if (error) throw error;
      return (data ?? []) as { cert_type: string; status: string; expiry_date: string | null }[];
    },
  });

  const closeShift = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("cancel_shift_with_reason", {
        p_shift_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employer", "shifts"] });
      setCancelTarget(null);
      setCancelReason("");
    },
  });

  const shiftCols: Column<ShiftRow>[] = [
    {
      key: "title",
      header: "Shift",
      render: (s) => (
        <div>
          <div className="font-medium">{s.title}</div>
          <div className="text-xs text-muted-foreground">{s.category} · {s.location_city ?? "—"}</div>
        </div>
      ),
      sortable: true,
      sortValue: (s) => s.title,
    },
    {
      key: "status",
      header: "Status",
      render: (s) => <Badge variant={STATUS_VARIANT[s.status] ?? "secondary"}>{s.status}</Badge>,
      sortable: true,
      sortValue: (s) => s.status,
    },
    {
      key: "when",
      header: "Date / time",
      render: (s) => (
        <span className="text-xs">
          {s.date ?? "—"} {s.start_time ?? ""}{s.start_time && s.end_time ? " → " : ""}{s.end_time ?? ""}
        </span>
      ),
      sortable: true,
      sortValue: (s) => s.date,
    },
    {
      key: "workers",
      header: "Workers",
      render: (s) => s.workers_needed != null ? `${s.workers_needed}` : "—",
    },
    {
      key: "rate",
      header: "Rate",
      render: (s) => s.hourly_rate != null ? `$${Number(s.hourly_rate).toFixed(2)}/hr` : "—",
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (s) => (
        <div className="flex justify-end gap-2">
          {(s.status === "Posted" || s.status === "Draft") && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => { setCancelTarget({ id: s.id, title: s.title }); setCancelReason(""); }}
            >
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  const appCols: Column<ApplicationRow>[] = [
    {
      key: "worker",
      header: "Worker",
      render: (a) => <span className="font-medium">{a.worker_name}</span>,
      sortable: true,
      sortValue: (a) => a.worker_name,
    },
    {
      key: "shift",
      header: "Shift",
      render: (a) => <span className="text-sm">{a.shift_title}</span>,
      sortable: true,
      sortValue: (a) => a.shift_title,
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <Badge variant={
          a.status === "Accepted" ? "success" :
          a.status === "Rejected" ? "destructive" :
          "warning"
        }>{a.status}</Badge>
      ),
      sortable: true,
      sortValue: (a) => a.status,
    },
    {
      key: "applied",
      header: "Applied",
      render: (a) => <span className="text-xs text-muted-foreground">{formatDate(a.applied_at)}</span>,
      sortable: true,
      sortValue: (a) => a.applied_at,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (a) => a.status === "Applied" ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline"
            onClick={() => setQualsFor({ workerId: a.worker_user_id, workerName: a.worker_name ?? "Worker" })}>
            Quals
          </Button>
          <Button size="sm" disabled={acceptApp.isPending}
            onClick={() => acceptApp.mutate(a.id)}>Accept</Button>
          <Button size="sm" variant="destructive"
            onClick={() => {
              setRejectReason("");
              setRejectTarget({ id: a.id, workerName: a.worker_name ?? "Worker", shiftTitle: a.shift_title ?? "" });
            }}>Reject</Button>
        </div>
      ) : null,
    },
  ];

  const pendingApps = (appsQ.data ?? []).filter((a) => a.status === "Applied").length;
  const hasMoreShifts = (shiftsQ.data?.length ?? 0) === shiftsPage * PAGE_SIZE;
  const hasMoreApps = (appsQ.data?.length ?? 0) === appsPage * PAGE_SIZE;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Labour</h1>
          <p className="text-sm text-muted-foreground">Manage your shifts and worker applications.</p>
        </div>
        <Link href="/employer/create-shift">
          <Button>+ Post shift</Button>
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Total shifts", value: shiftsQ.data?.length ?? 0 },
          { label: "Active shifts", value: (shiftsQ.data ?? []).filter((s) => s.status === "Posted").length },
          { label: "Pending applications", value: pendingApps },
          { label: "Filled shifts", value: (shiftsQ.data ?? []).filter((s) => s.status === "Filled").length },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Quick links */}
      <div className="flex gap-3">
        <Link href="/employer/browse-workers">
          <Button variant="outline">Browse workers</Button>
        </Link>
        <Link href="/employer/calendar">
          <Button variant="outline">Labour calendar</Button>
        </Link>
      </div>

      {/* Reject applicant dialog — reason required */}
      {rejectTarget && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium text-destructive">
            Reject <span className="font-semibold">{rejectTarget.workerName}</span>
            {rejectTarget.shiftTitle ? <> for &quot;{rejectTarget.shiftTitle}&quot;</> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            The worker will be notified with this reason. Keep it professional and non-discriminatory
            (e.g. &ldquo;Position filled&rdquo;, &ldquo;Missing required certification&rdquo;). Minimum 5 characters.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason *</Label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Position has been filled"
              className="text-sm"
              autoFocus
            />
          </div>
          {rejectApp.error && (
            <p className="text-xs text-destructive">{(rejectApp.error as Error).message}</p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={rejectReason.trim().length < 5 || rejectApp.isPending}
              onClick={() => rejectApp.mutate({ id: rejectTarget.id, reason: rejectReason.trim() })}
            >
              {rejectApp.isPending ? "Rejecting…" : "Confirm reject"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Worker qualifications modal (safe summary; no file paths) */}
      {qualsFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setQualsFor(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold">{qualsFor.workerName}</h2>
                <p className="text-xs text-muted-foreground">Approved qualifications only</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setQualsFor(null)}>✕</Button>
            </div>
            {qualsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : qualsQ.error ? (
              <p className="text-sm text-destructive">{(qualsQ.error as Error).message}</p>
            ) : (qualsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved qualifications on file.</p>
            ) : (
              <ul className="space-y-2">
                {(qualsQ.data ?? []).map((q) => (
                  <li key={q.cert_type} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="font-medium">{q.cert_type}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="success">{q.status}</Badge>
                      {q.expiry_date && (
                        <span className="text-xs text-muted-foreground">exp. {q.expiry_date}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Cancel confirmation dialog */}
      {cancelTarget && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium text-destructive">
            Cancel shift: <span className="font-semibold">{cancelTarget.title}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            This will notify all applicants and cannot be undone. Please provide a reason.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason *</Label>
            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Shift no longer needed, reorganisation…"
              className="text-sm"
              autoFocus
            />
          </div>
          {closeShift.error && (
            <p className="text-xs text-destructive">{(closeShift.error as Error).message}</p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={!cancelReason.trim() || closeShift.isPending}
              onClick={() => closeShift.mutate({ id: cancelTarget.id, reason: cancelReason.trim() })}
            >
              {closeShift.isPending ? "Cancelling…" : "Confirm cancel"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCancelTarget(null); setCancelReason(""); }}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 border-b">
        {(["shifts", "applications"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "shifts" ? "Shifts" : `Applications${pendingApps > 0 ? ` (${pendingApps})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "shifts" && (
        <Card>
          <CardHeader>
            <CardTitle>Posted shifts</CardTitle>
            <CardDescription>{shiftsQ.data?.length ?? 0} loaded</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DataTable
              rows={shiftsQ.data ?? []}
              columns={shiftCols}
              rowKey={(s) => s.id}
              isLoading={shiftsQ.isLoading}
              error={shiftsQ.error as Error | null}
              searchPlaceholder="Search shifts…"
              filters={[
                { value: "active", label: "Active", predicate: (s) => s.status === "Posted" },
                { value: "filled", label: "Filled", predicate: (s) => s.status === "Filled" },
                { value: "completed", label: "Completed", predicate: (s) => s.status === "Completed" },
              ]}
              emptyMessage="No shifts yet. Post your first shift."
            />
            {hasMoreShifts && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" onClick={() => setShiftsPage((p) => p + 1)}>
                  Load more shifts
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "applications" && (
        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>{appsQ.data?.length ?? 0} loaded · {pendingApps} pending</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DataTable
              rows={appsQ.data ?? []}
              columns={appCols}
              rowKey={(a) => a.id}
              isLoading={appsQ.isLoading}
              error={appsQ.error as Error | null}
              searchPlaceholder="Search workers or shifts…"
              filters={[
                { value: "pending", label: "Pending", predicate: (a) => a.status === "Applied" },
                { value: "accepted", label: "Accepted", predicate: (a) => a.status === "Accepted" },
                { value: "rejected", label: "Rejected", predicate: (a) => a.status === "Rejected" },
              ]}
              emptyMessage="No applications yet."
            />
            {hasMoreApps && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" onClick={() => setAppsPage((p) => p + 1)}>
                  Load more applications
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
