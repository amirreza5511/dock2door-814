"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, MapPin, CalendarDays } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { useExplore, useActionGuard } from "@/lib/explore-store";
import { SAMPLE_WORKER_SHIFTS } from "@/lib/explore-samples";

interface ShiftRow {
  id: string;
  title: string;
  category: string | null;
  location_city: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  hourly_rate: number | null;
  workers_needed: number | null;
  status: string;
  [k: string]: unknown;
}

interface RosterWorker {
  id: string;
  name: string;
  status: string;
  worker_user_id: string | null;
}

export default function AgencyShiftsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const companyId = useActiveCompanyId("EmploymentAgency");

  const [claimShift, setClaimShift] = useState<ShiftRow | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [claimError, setClaimError] = useState("");

  const shiftsQ = useQuery({
    queryKey: ["agency", "open-shifts"],
    enabled: !isExploring,
    queryFn: async (): Promise<ShiftRow[]> => {
      const { data, error } = await supabase
        .from("shift_posts")
        .select("*")
        .eq("status", "Posted")
        .order("date");
      if (error) throw error;
      return (data as ShiftRow[] | null) ?? [];
    },
  });

  const workersQ = useQuery({
    queryKey: ["agency", "linked-workers", companyId],
    enabled: !!companyId && !isExploring,
    queryFn: async (): Promise<RosterWorker[]> => {
      const { data, error } = await supabase
        .from("agency_workers")
        .select("id,name,status,worker_user_id")
        .eq("agency_company_id", companyId as string)
        .eq("status", "Active");
      if (error) return [];
      return ((data as RosterWorker[] | null) ?? []).filter((w) => !!w.worker_user_id);
    },
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!claimShift || !selectedWorker) throw new Error("Pick a worker");
      const { error } = await supabase.rpc("agency_claim_shift", {
        p_shift_id: claimShift.id,
        p_agency_worker_id: selectedWorker,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setClaimShift(null);
      setSelectedWorker(null);
      setClaimError("");
      void qc.invalidateQueries({ queryKey: ["agency"] });
    },
    onError: (e: Error) => setClaimError(e.message),
  });

  const shifts = useMemo(
    () => (isExploring ? (SAMPLE_WORKER_SHIFTS.map((s) => ({ ...s, workers_needed: 2 })) as unknown as ShiftRow[]) : (shiftsQ.data ?? [])),
    [shiftsQ.data, isExploring],
  );
  const workers = workersQ.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Employment Agency</p>
        <h1 className="text-2xl font-semibold tracking-tight">Open shifts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Claim a posted shift for one of your linked workers — Dock2Door invoices the employer and pays your agency.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Posted shifts ({shifts.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!isExploring && shiftsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : shifts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ClipboardList className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No open shifts right now — check back soon.</p>
            </div>
          ) : (
            shifts.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{s.title}</p>
                    {s.category && <Badge className="bg-blue-500/15 text-blue-300">{s.category}</Badge>}
                  </div>
                  <p className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                    {s.location_city ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{s.location_city}</span> : null}
                    {s.date ? <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{s.date} {s.start_time ?? ""}–{s.end_time ?? ""}</span> : null}
                    {s.hourly_rate ? <span>${Number(s.hourly_rate).toFixed(2)}/h</span> : null}
                  </p>
                </div>
                <Button size="sm" onClick={() => { if (!guard("Claim a shift for a worker")) return; setClaimShift(s); setSelectedWorker(null); setClaimError(""); }}>
                  Claim for worker
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!claimShift} onOpenChange={(o) => { if (!o) setClaimShift(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Claim “{claimShift?.title}”</DialogTitle></DialogHeader>
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked workers on your roster yet. Add workers (with their Dock2Door account email) on the My workers page first.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Which of your workers takes this shift?</p>
              {workers.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedWorker(w.id)}
                  className={`w-full rounded-lg border px-4 py-2.5 text-left text-sm transition-colors ${
                    selectedWorker === w.id ? "border-primary bg-primary/10 font-medium" : "border-white/10 bg-card/60 hover:border-white/20"
                  }`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          )}
          {claimError && <p className="text-sm text-red-400">{claimError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setClaimShift(null)}>Cancel</Button>
            <Button disabled={!selectedWorker || claimMutation.isPending} onClick={() => claimMutation.mutate()}>
              {claimMutation.isPending ? "Claiming…" : "Claim shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
