"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Globe, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { FREIGHT_MODE_LABEL, formatMoney, type FreightMode } from "@/lib/global-freight";

interface PendingQuote {
  id: string; reference_code: string; title: string; freight_mode: FreightMode;
  origin_country: string; origin_city: string; dest_country: string; dest_city: string;
  weight: number; weight_unit: string; pieces: number; commodity: string;
  declared_value: number; currency: string; needs_container_pickup: boolean;
  customer_name: string; status: string; created_at: string;
}

export default function AdminFreightReviewPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [reject, setReject] = useState<PendingQuote | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin", "freight-review"],
    queryFn: async (): Promise<PendingQuote[]> => {
      const { data, error: e } = await supabase.rpc("freight_admin_list", { p_scope: "pending" });
      if (e) throw e;
      return (data as PendingQuote[] | null) ?? [];
    },
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.rpc("freight_approve_quote", { p_quote_id: id });
      if (e) throw e;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "freight-review"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Could not approve."),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, r }: { id: string; r: string }) => {
      const { error: e } = await supabase.rpc("freight_reject_quote", { p_quote_id: id, p_reason: r });
      if (e) throw e;
    },
    onSuccess: () => { setReject(null); setReason(""); qc.invalidateQueries({ queryKey: ["admin", "freight-review"] }); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not reject."),
  });

  const quotes = q.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Globe className="h-6 w-6 text-blue-400" /> Freight review</h1>
        <p className="mt-1 text-sm text-muted-foreground">Approve or reject new international freight requests before they open for quotes.</p>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : quotes.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle className="h-8 w-8 text-emerald-400" />
          <p className="text-sm text-muted-foreground">No requests waiting for review.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {quotes.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-muted-foreground">{r.reference_code}</span>
                  <Badge className="bg-amber-500/15 text-amber-300">Pending review</Badge>
                </div>
                <div>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.customer_name} · {FREIGHT_MODE_LABEL[r.freight_mode]} · {r.origin_city || r.origin_country} → {r.dest_city || r.dest_country} · {r.weight} {r.weight_unit} · {r.pieces} pcs
                    {r.commodity ? ` · ${r.commodity}` : ""}
                    {r.declared_value ? ` · ${formatMoney(r.declared_value, r.currency)}` : ""}
                    {r.needs_container_pickup ? " · needs ground pickup" : ""} · {formatDate(r.created_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveMut.mutate(r.id)} disabled={approveMut.isPending}>
                    {approveMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1.5 h-4 w-4" />} Approve
                  </Button>
                  <Button size="sm" variant="secondary" className="text-red-400" onClick={() => { setError(null); setReject(r); }}>
                    <XCircle className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!reject} onOpenChange={(v) => { if (!v) { setReject(null); setReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject request</DialogTitle></DialogHeader>
          <p className="truncate text-sm text-muted-foreground">{reject?.title}</p>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shared with the customer)" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setReject(null); setReason(""); }}>Cancel</Button>
            <Button className="text-red-400" variant="secondary" disabled={rejectMut.isPending || !reason.trim()} onClick={() => reject && rejectMut.mutate({ id: reject.id, r: reason.trim() })}>
              {rejectMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />} Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
