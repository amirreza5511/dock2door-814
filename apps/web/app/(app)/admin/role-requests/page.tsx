"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Layers, CheckCircle, XCircle, Building2, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/relationships";
import type { UserRole } from "@/lib/types";

interface RoleRequest {
  id: string; company_id: string; company_name: string; company_type: string;
  requested_role: string; note: string; status: string; created_at: string;
}

export default function AdminRoleRequestsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [reject, setReject] = useState<RoleRequest | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-role-requests"],
    queryFn: async (): Promise<RoleRequest[]> => {
      const { data, error } = await supabase.rpc("list_role_requests", { p_status: "Pending" });
      if (error) throw new Error(error.message);
      return (data ?? []) as RoleRequest[];
    },
  });

  const reviewMut = useMutation({
    mutationFn: async ({ id, approve, r }: { id: string; approve: boolean; r?: string }) => {
      const { error } = await supabase.rpc("admin_review_role_request", {
        p_request_id: id, p_approve: approve, p_reason: r ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-role-requests"] });
      setReject(null); setReason(""); setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const items = q.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Layers className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Role requests</h1>
          <p className="text-sm text-muted-foreground">Businesses asking to take on an additional compatible role.</p>
        </div>
        {items.length > 0 && <Badge className="ml-auto">{items.length} pending</Badge>}
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {q.isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle className="h-8 w-8 text-emerald-500" />
            <p className="font-semibold">No pending role requests</p>
            <p className="text-sm text-muted-foreground">All clear.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{it.company_name}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {ROLE_LABEL[it.company_type as UserRole] ?? it.company_type} wants to add{" "}
                  <span className="font-semibold text-foreground">{ROLE_LABEL[it.requested_role as UserRole] ?? it.requested_role}</span>
                  {" · "}Requested {formatDate(it.created_at)}
                </p>
                {it.note && <p className="text-sm italic text-muted-foreground">“{it.note}”</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" disabled={reviewMut.isPending} onClick={() => { setReject(it); setReason(""); }}>
                    <XCircle className="mr-1 h-4 w-4" />Reject
                  </Button>
                  <Button size="sm" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ id: it.id, approve: true })}>
                    <CheckCircle className="mr-1 h-4 w-4" />Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={reject !== null} onOpenChange={(o) => { if (!o) setReject(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reject {ROLE_LABEL[reject?.requested_role as UserRole] ?? reject?.requested_role} for {reject?.company_name}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejection (required)…"
            rows={3}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={reviewMut.isPending || !reason.trim()}
              onClick={() => reject && reviewMut.mutate({ id: reject.id, approve: false, r: reason.trim() })}
            >
              {reviewMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
