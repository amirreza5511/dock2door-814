"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface CertRow {
  id: string;
  worker_user_id: string;
  type: string;
  status: string;
  expiry_date: string | null;
  file_path: string | null;
  notes: string | null;
  created_at: string;
}

const FILTERS = ["Pending", "Approved", "Rejected", "Expired"] as const;

export default function AdminCertificationsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Pending");

  const certsQuery = useQuery({
    queryKey: ["admin", "certifications", filter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_certifications")
        .select("id, worker_user_id, type, status, expiry_date, file_path, notes, created_at")
        .eq("status", filter)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as CertRow[];
    },
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_approve_certification", { cert_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "certifications"] }),
  });

  const reject = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_reject_certification", {
        cert_id: input.id,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "certifications"] }),
  });

  const openSigned = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.functions.invoke("get-signed-url", {
      body: { bucket: "certifications", path },
    });
    if (error) {
      window.alert(error.message);
      return;
    }
    const url = (data as { signedUrl?: string; url?: string } | null)?.signedUrl
      ?? (data as { url?: string } | null)?.url;
    if (url) window.open(url, "_blank");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Worker Certifications</h1>
          <p className="text-sm text-muted-foreground">Approve, reject, and review compliance documents.</p>
        </div>
        <div className="flex gap-1 rounded-md border p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "rounded px-3 py-1 text-sm " +
                (filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{filter} certifications</CardTitle>
          <CardDescription>{certsQuery.data?.length ?? 0} items</CardDescription>
        </CardHeader>
        <CardContent>
          {certsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (certsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No certifications in this status.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Worker</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Expiry</TH>
                  <TH>Submitted</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(certsQuery.data ?? []).map((c) => (
                  <TR key={c.id}>
                    <TD className="font-mono text-xs">{c.worker_user_id.slice(0, 8)}</TD>
                    <TD>{c.type}</TD>
                    <TD>
                      <Badge variant={c.status === "Approved" ? "success" : c.status === "Pending" ? "warning" : "destructive"}>
                        {c.status}
                      </Badge>
                    </TD>
                    <TD>{c.expiry_date ?? "—"}</TD>
                    <TD>{formatDate(c.created_at)}</TD>
                    <TD className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => openSigned(c.file_path)} disabled={!c.file_path}>
                        View
                      </Button>
                      {c.status === "Pending" && (
                        <>
                          <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(c.id)}>
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={reject.isPending}
                            onClick={() => {
                              const reason = window.prompt("Reason for rejection?");
                              if (!reason) return;
                              reject.mutate({ id: c.id, reason });
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
