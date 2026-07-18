"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Plus, Anchor } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface MyRequestRow {
  id: string;
  title: string;
  mode: string;
  container_no: string;
  port_of_entry: string;
  eta: string | null;
  status: string;
  quote_amount: number;
  broker_name: string;
  created_at: string;
}

const STATUS_CLASS: Record<string, string> = {
  Submitted: "bg-yellow-500/15 text-yellow-300",
  Quoted: "bg-blue-500/15 text-blue-300",
  InProgress: "bg-primary/15 text-primary",
  DocsRequired: "bg-yellow-500/15 text-yellow-300",
  Cleared: "bg-emerald-500/15 text-emerald-300",
  Rejected: "bg-red-500/15 text-red-300",
  Cancelled: "bg-white/10 text-muted-foreground",
};

/** Shared customer-side clearance page — every business role and guests can request clearance. */
export default function ClearancePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"Import" | "Export">("Import");
  const [containerNo, setContainerNo] = useState("");
  const [blNumber, setBlNumber] = useState("");
  const [port, setPort] = useState("");
  const [eta, setEta] = useState("");
  const [value, setValue] = useState("");
  const [cargo, setCargo] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");

  const q = useQuery({
    queryKey: ["clearance", "mine"],
    refetchInterval: 20000,
    queryFn: async (): Promise<MyRequestRow[]> => {
      const { data, error } = await supabase.rpc("clearance_list_mine");
      if (error) return [];
      return (data as MyRequestRow[] | null) ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Give this shipment a short title");
      if (eta.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(eta.trim())) throw new Error("ETA must be YYYY-MM-DD");
      const { error } = await supabase.rpc("clearance_create_request", {
        p_title: title.trim(),
        p_mode: mode,
        p_container_no: containerNo.trim(),
        p_bl_number: blNumber.trim(),
        p_port: port.trim(),
        p_eta: eta.trim() || null,
        p_cargo_description: cargo.trim(),
        p_commercial_value: Number(value) || 0,
        p_currency: "CAD",
        p_incoterms: "",
        p_notes: notes.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setOpen(false);
      setTitle(""); setMode("Import"); setContainerNo(""); setBlNumber(""); setPort("");
      setEta(""); setValue(""); setCargo(""); setNotes(""); setFormError("");
      void qc.invalidateQueries({ queryKey: ["clearance"] });
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Customs clearance</p>
          <h1 className="text-2xl font-semibold tracking-tight">My clearance requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">Send documents & clear shipments with a licensed customs broker — all on Dock2Door.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />New request</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Requests ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Landmark className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No clearance requests yet. Submit your shipment details and a customs broker will quote and clear it.</p>
            </div>
          ) : (
            rows.map((r) => (
              <Link key={r.id} href={`/clearance/${r.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3 transition-colors hover:border-white/15">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Anchor className="h-3 w-3" />
                    {r.mode}{r.container_no ? ` · ${r.container_no}` : ""}{r.port_of_entry ? ` · ${r.port_of_entry}` : ""}
                    {r.broker_name ? ` · Broker: ${r.broker_name}` : ""}
                  </p>
                  {r.status === "Quoted" && Number(r.quote_amount) > 0 ? (
                    <p className="mt-0.5 text-xs font-medium text-emerald-300">Quote received: ${Number(r.quote_amount).toFixed(2)} — open to review</p>
                  ) : null}
                </div>
                <Badge className={STATUS_CLASS[r.status] ?? ""}>{r.status}</Badge>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request customs clearance</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1.5"><Label>Shipment title *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Electronics from Shanghai" /></div>
            <div className="flex gap-2">
              {(["Import", "Export"] as const).map((m) => (
                <Button key={m} type="button" variant={mode === m ? "default" : "outline"} size="sm" onClick={() => setMode(m)}>{m}</Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Container #</Label><Input value={containerNo} onChange={(e) => setContainerNo(e.target.value.toUpperCase())} /></div>
              <div className="space-y-1.5"><Label>BL number</Label><Input value={blNumber} onChange={(e) => setBlNumber(e.target.value.toUpperCase())} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Port of entry</Label><Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="Vancouver" /></div>
              <div className="space-y-1.5"><Label>ETA (YYYY-MM-DD)</Label><Input value={eta} onChange={(e) => setEta(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Commercial value (CAD)</Label><Input value={value} onChange={(e) => setValue(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Cargo description</Label><Textarea rows={2} value={cargo} onChange={(e) => setCargo(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Notes for the broker</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Submitting…" : "Submit to customs brokers"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
