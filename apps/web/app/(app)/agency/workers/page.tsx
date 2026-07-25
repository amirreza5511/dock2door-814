"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Users } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { useExplore, useActionGuard } from "@/lib/explore-store";

interface WorkerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  hourly_cost: number | null;
  status: string;
  worker_user_id: string | null;
  created_at: string;
}

const SAMPLE_WORKERS: WorkerRow[] = [
  { id: "ex-aw-1", name: "Marcus Lee", email: "marcus@previewco.com", phone: "+1 604 555 0182", hourly_cost: 26, status: "Active", worker_user_id: "ex-u-1", created_at: new Date(Date.now() - 86400000 * 40).toISOString() },
  { id: "ex-aw-2", name: "Priya Sharma", email: "priya@previewco.com", phone: "+1 604 555 0146", hourly_cost: 29, status: "Active", worker_user_id: "ex-u-2", created_at: new Date(Date.now() - 86400000 * 25).toISOString() },
  { id: "ex-aw-3", name: "Dan Kowalski", email: "dan@previewco.com", phone: null, hourly_cost: 24, status: "Invited", worker_user_id: null, created_at: new Date(Date.now() - 86400000 * 3).toISOString() },
];

const STATUS_CLASS: Record<string, string> = {
  Active: "bg-emerald-500/15 text-emerald-300",
  Invited: "bg-yellow-500/15 text-yellow-300",
  Removed: "bg-white/10 text-muted-foreground",
};

export default function AgencyWorkersPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const companyId = useActiveCompanyId("EmploymentAgency");

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [hourlyCost, setHourlyCost] = useState("");
  const [formError, setFormError] = useState("");

  const q = useQuery({
    queryKey: ["agency", "workers-full", companyId],
    enabled: !!companyId && !isExploring,
    queryFn: async (): Promise<WorkerRow[]> => {
      const { data, error } = await supabase
        .from("agency_workers")
        .select("*")
        .eq("agency_company_id", companyId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as WorkerRow[] | null) ?? [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("agency_add_worker", {
        p_name: name.trim(),
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
        p_hourly_cost: Number(hourlyCost) || 0,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setOpen(false);
      setName(""); setEmail(""); setPhone(""); setHourlyCost(""); setFormError("");
      void qc.invalidateQueries({ queryKey: ["agency"] });
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("agency_workers")
        .update({ status })
        .eq("id", id)
        .eq("agency_company_id", companyId as string);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agency"] }),
  });

  const rows = isExploring ? SAMPLE_WORKERS : (q.data ?? []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Employment Agency</p>
          <h1 className="text-2xl font-semibold tracking-tight">My workers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your roster. Workers with a Dock2Door account link automatically by email.</p>
        </div>
        <Button onClick={() => { if (!guard("Add a worker")) return; setOpen(true); }}><UserPlus className="mr-2 h-4 w-4" />Add worker</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Roster ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!isExploring && q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No workers yet. Add your first worker — if they have a Dock2Door account they link instantly.</p>
            </div>
          ) : (
            rows.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{w.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {w.email || "No email"}{w.phone ? ` · ${w.phone}` : ""}
                    {w.hourly_cost ? ` · $${Number(w.hourly_cost).toFixed(2)}/h cost` : ""}
                    {w.worker_user_id ? " · Linked account" : " · Not linked yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_CLASS[w.status] ?? ""}>{w.status}</Badge>
                  {w.status !== "Removed" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { if (!guard("Remove a worker")) return; statusMutation.mutate({ id: w.id, status: "Removed" }); }}
                    >
                      Remove
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { if (!guard("Restore a worker")) return; statusMutation.mutate({ id: w.id, status: w.worker_user_id ? "Active" : "Invited" }); }}
                    >
                      Restore
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a worker</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Full name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Kaur" /></div>
            <div className="space-y-1.5"><Label>Email (links their account)</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="worker@email.com" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" /></div>
            <div className="space-y-1.5"><Label>Hourly cost you pay them ($)</Label><Input value={hourlyCost} onChange={(e) => setHourlyCost(e.target.value)} placeholder="25" /></div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "Adding…" : "Add worker"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
