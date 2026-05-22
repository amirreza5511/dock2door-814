"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

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
  assigned_at: string | null;
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
  assigned_at: string | null;
}

export default function WorkerShiftsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const assignments = useQuery({
    queryKey: ["worker", "assignments"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("shift_assignments")
        .select("id,shift_id,status,worker_user_id,assigned_at,shift_posts!inner(id,title,date,start_time,end_time,hourly_rate)")
        .eq("worker_user_id", u.user.id)
        .order("assigned_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
  });

  const flat: FlatAssignment[] = (assignments.data ?? []).map((a) => {
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
      assigned_at: a.assigned_at,
    };
  });

  const clockIn = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase.rpc("worker_clock_in", { p_assignment_id: assignmentId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "assignments"] }),
  });

  const clockOut = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase.rpc("worker_clock_out", { p_assignment_id: assignmentId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "assignments"] }),
  });

  const cols: Column<FlatAssignment>[] = [
    { key: "title", header: "Shift", render: (a) => <span className="font-medium">{a.title}</span> },
    { key: "when", header: "When", render: (a) => `${a.date ?? "—"} ${a.start_time ?? ""} → ${a.end_time ?? ""}`.trim(), sortable: true, sortValue: (a) => a.date },
    { key: "rate", header: "Pay rate", render: (a) => a.hourly_rate ? `${Number(a.hourly_rate).toFixed(2)}/hr` : "—" },
    { key: "status", header: "Status", render: (a) => <Badge variant={a.status === "Completed" ? "success" : a.status === "InProgress" ? "default" : "warning"}>{a.status}</Badge>, sortable: true, sortValue: (a) => a.status },
    { key: "actions", header: "", className: "text-right", render: (a) => (
      <div className="flex justify-end gap-2">
        {a.status === "Scheduled" && <Button size="sm" disabled={clockIn.isPending} onClick={() => clockIn.mutate(a.id)}>Clock in</Button>}
        {a.status === "InProgress" && <Button size="sm" disabled={clockOut.isPending} onClick={() => clockOut.mutate(a.id)}>Clock out</Button>}
      </div>
    ) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My shifts</h1>
        <p className="text-sm text-muted-foreground">Clock-in / clock-out is enforced server-side and requires required certifications to be approved.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Assignments</CardTitle><CardDescription>{flat.length} total</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={flat}
            columns={cols}
            rowKey={(a) => a.id}
            isLoading={assignments.isLoading}
            error={assignments.error as Error | null}
            searchPlaceholder="Search shift…"
            filters={[
              { value: "active", label: "Active", predicate: (a) => a.status === "Scheduled" || a.status === "InProgress" },
              { value: "completed", label: "Completed", predicate: (a) => a.status === "Completed" },
            ]}
          />
          {(clockIn.error || clockOut.error) && (
            <p className="mt-3 text-sm text-red-600">{((clockIn.error || clockOut.error) as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
