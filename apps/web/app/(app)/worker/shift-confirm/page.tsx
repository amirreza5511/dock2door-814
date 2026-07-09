"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Building2, CheckCircle2, Clock, DollarSign, MapPin, XCircle } from "lucide-react";

interface ShiftPostRef {
  title: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  location_address: string | null;
  location_city: string | null;
  employer_company_id: string | null;
}

interface AssignmentDetail {
  id: string;
  shift_id: string;
  confirmed_rate: number | null;
  status: string;
  worker_confirmed: boolean | null;
  shift_posts: ShiftPostRef | ShiftPostRef[] | null;
  companyName: string | null;
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  try {
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
  } catch {
    return t;
  }
}

function formatDate(d: string | null): string {
  if (!d) return "";
  try {
    const dt = new Date(d + "T00:00:00");
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}`;
  } catch {
    return d;
  }
}

export default function WorkerShiftConfirmPage() {
  const supabase = getBrowserSupabase();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const assignmentId = params.get("assignmentId") ?? "";

  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const assignmentQ = useQuery({
    queryKey: ["shift-confirm", assignmentId],
    enabled: Boolean(assignmentId),
    queryFn: async (): Promise<AssignmentDetail | null> => {
      const { data, error } = await supabase
        .from("shift_assignments")
        .select(
          "id,shift_id,confirmed_rate,status,worker_confirmed,shift_posts(title,date,start_time,end_time,location_address,location_city,employer_company_id)",
        )
        .eq("id", assignmentId)
        .single();
      if (error) throw new Error(error.message);
      const sp = Array.isArray(data?.shift_posts) ? data?.shift_posts[0] : data?.shift_posts;
      let companyName: string | null = null;
      if (sp?.employer_company_id) {
        const { data: co } = await supabase
          .from("companies")
          .select("name")
          .eq("id", sp.employer_company_id)
          .single();
        companyName = (co as { name: string } | null)?.name ?? null;
      }
      return { ...(data as unknown as AssignmentDetail), companyName };
    },
    staleTime: 30_000,
  });

  const assignment = assignmentQ.data;
  const shift = useMemo(() => {
    const sp = assignment?.shift_posts;
    return Array.isArray(sp) ? sp[0] : sp;
  }, [assignment]);

  const confirmAttendance = useMutation({
    mutationFn: async ({ confirmed, reason }: { confirmed: boolean; reason?: string }) => {
      const { error } = await supabase.rpc("worker_confirm_attendance", {
        p_assignment_id: assignmentId,
        p_confirmed: confirmed,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["worker", "assignments"] });
      await qc.invalidateQueries({ queryKey: ["shift-confirm", assignmentId] });
      router.push("/worker/shifts");
    },
  });

  if (!assignmentId) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-sm text-muted-foreground">No shift selected.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push("/worker/shifts")}>Back to my shifts</Button>
      </div>
    );
  }

  if (assignmentQ.isLoading) {
    return <div className="mx-auto max-w-lg py-16 text-center text-sm text-muted-foreground">Loading shift…</div>;
  }

  if (!assignment || !shift) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-sm text-muted-foreground">Shift not found.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push("/worker/shifts")}>Back to my shifts</Button>
      </div>
    );
  }

  if (assignment.worker_confirmed === true) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 text-xl font-semibold">Already confirmed!</h1>
        <p className="mt-1 text-sm text-muted-foreground">You&apos;ve confirmed attendance for this shift.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push("/worker/shifts")}>Back to my shifts</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Confirm attendance</h1>
        <p className="text-sm text-muted-foreground">Let the employer know if you can make this shift.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{shift.title ?? "Shift"}</CardTitle>
          {assignment.companyName ? <CardDescription>{assignment.companyName}</CardDescription> : null}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {assignment.companyName ? (
            <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /><span>{assignment.companyName}</span></div>
          ) : null}
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-blue-500" /><span>{formatDate(shift.date)} · {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}</span></div>
          <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span>{[shift.location_address, shift.location_city].filter(Boolean).join(", ") || "—"}</span></div>
          <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-emerald-500" /><span>${Number(assignment.confirmed_rate ?? 0).toFixed(2)}/hr</span></div>
          <Badge variant="warning">{assignment.status}</Badge>
        </CardContent>
      </Card>

      {!showCancelForm ? (
        <div className="space-y-3">
          <Button
            className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
            disabled={confirmAttendance.isPending}
            onClick={() => confirmAttendance.mutate({ confirmed: true })}
          >
            <CheckCircle2 className="h-5 w-5" /> Yes, I&apos;ll be there
          </Button>
          <Button
            className="w-full gap-2"
            variant="outline"
            onClick={() => setShowCancelForm(true)}
          >
            <XCircle className="h-5 w-5" /> I can&apos;t make it
          </Button>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">Why can&apos;t you make it?</CardTitle>
            <CardDescription>This notifies the employer so they can find a replacement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Family emergency, illness, transportation issue…"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="destructive"
                disabled={confirmAttendance.isPending || cancelReason.trim().length < 5}
                onClick={() => confirmAttendance.mutate({ confirmed: false, reason: cancelReason.trim() })}
              >
                Submit cancellation
              </Button>
              <Button variant="ghost" onClick={() => { setShowCancelForm(false); setCancelReason(""); }}>Go back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {confirmAttendance.error && (
        <p className="text-sm text-red-600">{(confirmAttendance.error as Error).message}</p>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Please confirm at least 12 hours before your shift. Late cancellations affect your reliability score.
      </p>
    </div>
  );
}
