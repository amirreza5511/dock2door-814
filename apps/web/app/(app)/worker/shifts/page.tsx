"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { useExplore, useActionGuard } from "@/lib/explore-store";

interface ShiftPostRef {
  id: string;
  title: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  hourly_rate: number | null;
}

interface Assignment {
  id: string;
  shift_id: string;
  status: string;
  worker_user_id: string;
  created_at: string | null;
  worker_confirmed: boolean | null;
  shift_posts: ShiftPostRef | ShiftPostRef[] | null;
}

interface FlatAssignment {
  id: string;
  shift_id: string;
  status: string;
  title: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  hourly_rate: number | null;
  created_at: string | null;
  worker_confirmed: boolean | null;
}

export default function WorkerShiftsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();

  const assignments = useQuery({
    queryKey: ["worker", "assignments"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("shift_assignments")
        .select("id,shift_id,status,worker_user_id,created_at,worker_confirmed,shift_posts!inner(id,title,date,start_time,end_time,hourly_rate)")
        .eq("worker_user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
  });

  const sampleFlat: FlatAssignment[] = isExploring ? [
    { id: "ex-as-1", shift_id: "ex-sp-1", status: "Scheduled", title: "Warehouse Loader", date: new Date().toISOString().slice(0, 10), start_time: "08:00", end_time: "16:00", hourly_rate: 24, created_at: new Date(Date.now() - 3600000 * 20).toISOString(), worker_confirmed: null },
    { id: "ex-as-2", shift_id: "ex-sp-2", status: "Scheduled", title: "Forklift Operator", date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), start_time: "07:00", end_time: "15:00", hourly_rate: 31, created_at: new Date(Date.now() - 3600000 * 10).toISOString(), worker_confirmed: true },
    { id: "ex-as-3", shift_id: "ex-sp-9", status: "Completed", title: "Order Picker (evening)", date: new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10), start_time: "16:00", end_time: "23:00", hourly_rate: 26, created_at: new Date(Date.now() - 86400000 * 4).toISOString(), worker_confirmed: true },
  ] : [];

  const flat: FlatAssignment[] = isExploring ? sampleFlat : (assignments.data ?? []).map((a) => {
    const s = Array.isArray(a.shift_posts) ? a.shift_posts[0] : a.shift_posts;
    return {
      id: a.id,
      shift_id: a.shift_id,
      status: a.status,
      title: s?.title ?? "Untitled shift",
      date: s?.date ?? null,
      start_time: s?.start_time ?? null,
      end_time: s?.end_time ?? null,
      hourly_rate: s?.hourly_rate ?? null,
      created_at: a.created_at,
      worker_confirmed: a.worker_confirmed,
    };
  });

  const confirmAttendance = useMutation({
    mutationFn: async ({ assignmentId, confirmed, reason }: { assignmentId: string; confirmed: boolean; reason?: string }) => {
      const { error } = await supabase.rpc("worker_confirm_attendance", {
        p_assignment_id: assignmentId,
        p_confirmed: confirmed,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "assignments"] }),
  });

  // Clock in/out is mobile-only — the mobile app captures device timestamp + (optional) location.
  // Web shows a clear, non-actionable message instead of buttons that would partially work.
  const cols: Column<FlatAssignment>[] = [
    { key: "title", header: "Shift", render: (a) => <span className="font-medium">{a.title}</span> },
    { key: "when", header: "When", render: (a) => `${a.date ?? "—"} ${a.start_time ?? ""} → ${a.end_time ?? ""}`.trim(), sortable: true, sortValue: (a) => a.date },
    { key: "rate", header: "Pay rate", render: (a) => a.hourly_rate ? `${Number(a.hourly_rate).toFixed(2)}/hr` : "—" },
    { key: "status", header: "Status", render: (a) => <Badge variant={a.status === "Completed" ? "success" : a.status === "InProgress" ? "default" : "warning"}>{a.status}</Badge>, sortable: true, sortValue: (a) => a.status },
    { key: "confirm", header: "Attendance", render: (a) => {
      if (a.status !== "Scheduled") return <span className="text-xs text-muted-foreground">—</span>;
      if (a.worker_confirmed === true) return <Badge variant="success">Confirmed</Badge>;
      if (a.worker_confirmed === false) return <Badge variant="destructive">Declined</Badge>;
      return <span className="text-xs text-amber-600">Not confirmed</span>;
    } },
    { key: "actions", header: "", className: "text-right", render: (a) => (
      <div className="flex justify-end gap-2">
        {a.status === "Scheduled" && a.worker_confirmed === null && (
          <>
            <Button size="sm" disabled={confirmAttendance.isPending}
              onClick={() => { if (!guard("Confirm attendance")) return; confirmAttendance.mutate({ assignmentId: a.id, confirmed: true }); }}>Confirm</Button>
            <Button size="sm" variant="outline" disabled={confirmAttendance.isPending}
              onClick={() => {
                if (!guard("Decline a shift")) return;
                const reason = window.prompt("Reason for declining this shift (the employer will see this):");
                if (!reason || reason.trim().length < 5) return;
                confirmAttendance.mutate({ assignmentId: a.id, confirmed: false, reason: reason.trim() });
              }}>Decline</Button>
          </>
        )}
        {a.status === "Scheduled" && a.worker_confirmed === true && (
          <span className="text-xs text-amber-600" title="Clock-in is mobile-only">Use the mobile app to clock in</span>
        )}
        {a.status === "Scheduled" && a.worker_confirmed === false && (
          <span className="text-xs text-muted-foreground">Declined</span>
        )}
        {a.status === "InProgress" && (
          <span className="text-xs text-amber-600" title="Clock-out is mobile-only">Use the mobile app to clock out</span>
        )}
      </div>
    ) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My shifts</h1>
        <p className="text-sm text-muted-foreground">Confirm attendance, view status, and withdraw applications here. Clock-in / clock-out is available in the mobile app only — it captures device timestamps (and location where available) at the moment you tap.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Assignments</CardTitle><CardDescription>{flat.length} total</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={flat}
            columns={cols}
            rowKey={(a) => a.id}
            isLoading={!isExploring && assignments.isLoading}
            error={isExploring ? null : (assignments.error as Error | null)}
            searchPlaceholder="Search shift…"
            filters={[
              { value: "active", label: "Active", predicate: (a) => a.status === "Scheduled" || a.status === "InProgress" },
              { value: "completed", label: "Completed", predicate: (a) => a.status === "Completed" },
            ]}
          />
          {confirmAttendance.error && (
            <p className="mt-3 text-sm text-red-600">{(confirmAttendance.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
