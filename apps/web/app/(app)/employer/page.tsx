"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export default function EmployerPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"shifts" | "applications">("shifts");

  const shiftsQ = useQuery({
    queryKey: ["employer", "shifts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_posts")
        .select("id,title,category,status,date,start_time,end_time,hourly_rate,workers_needed,location_city,requirements,created_at")
        .order("date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
  });

  const appsQ = useQuery({
    queryKey: ["employer", "applications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_applications")
        .select(`id, shift_id, worker_user_id, status, applied_at,
          shift_posts!inner(title),
          profiles!inner(name)`)
        .order("applied_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((a: any) => ({
        id: a.id,
        shift_id: a.shift_id,
        worker_user_id: a.worker_user_id,
        status: a.status,
        applied_at: a.applied_at,
        shift_title: a.shift_posts?.title ?? "—",
        worker_name: a.profiles?.name ?? "Unknown",
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
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("employer_reject_applicant", { p_application_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employer", "applications"] }),
  });

  const closeShift = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shift_posts").update({ status: "Cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employer", "shifts"] }),
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
            <Button size="sm" variant="destructive"
              disabled={closeShift.isPending}
              onClick={() => closeShift.mutate(s.id)}>
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
          <Button size="sm" disabled={acceptApp.isPending}
            onClick={() => acceptApp.mutate(a.id)}>Accept</Button>
          <Button size="sm" variant="destructive" disabled={rejectApp.isPending}
            onClick={() => rejectApp.mutate(a.id)}>Reject</Button>
        </div>
      ) : null,
    },
  ];

  const pendingApps = (appsQ.data ?? []).filter((a) => a.status === "Applied").length;

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
            <CardDescription>{shiftsQ.data?.length ?? 0} total</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {tab === "applications" && (
        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>{appsQ.data?.length ?? 0} total · {pendingApps} pending</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
