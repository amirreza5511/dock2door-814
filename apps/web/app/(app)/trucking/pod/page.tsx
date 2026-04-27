"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface POD {
  id: string;
  appointment_id: string | null;
  shipment_id: string | null;
  signer_name: string | null;
  signed_at: string | null;
  status: string | null;
  storage_path: string | null;
  notes: string | null;
  created_at: string;
}

export default function PodReviewPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const pods = useQuery({
    queryKey: ["trucking", "pods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pods")
        .select("id,appointment_id,shipment_id,signer_name,signed_at,status,storage_path,notes,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as POD[];
    },
  });

  const view = useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.functions.invoke("get-signed-url", {
        body: { bucket: "attachments", path },
      });
      if (error) throw error;
      const url = (data as { signedUrl?: string; url?: string } | null)?.signedUrl
        ?? (data as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank");
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("pods").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trucking", "pods"] }),
  });

  const cols: Column<POD>[] = [
    { key: "id", header: "POD", render: (p) => <span className="font-mono text-xs">{p.id.slice(0, 8)}</span> },
    { key: "ref", header: "Reference", render: (p) => p.appointment_id ?? p.shipment_id ?? "—" },
    { key: "signer", header: "Signer", render: (p) => p.signer_name ?? "—" },
    { key: "signed", header: "Signed", render: (p) => p.signed_at ? formatDate(p.signed_at) : "—", sortable: true, sortValue: (p) => p.signed_at },
    { key: "status", header: "Status", render: (p) => <Badge variant={p.status === "Approved" ? "success" : p.status === "Rejected" ? "destructive" : "warning"}>{p.status ?? "Pending"}</Badge> },
    { key: "actions", header: "", className: "text-right", render: (p) => (
      <div className="flex justify-end gap-2">
        {p.storage_path && <Button size="sm" variant="secondary" onClick={() => view.mutate(p.storage_path!)}>View</Button>}
        {p.status !== "Approved" && (
          <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: p.id, status: "Approved" })}>Approve</Button>
        )}
        {p.status !== "Rejected" && (
          <Button size="sm" variant="destructive" disabled={setStatus.isPending} onClick={() => {
            if (!window.confirm("Reject POD?")) return;
            setStatus.mutate({ id: p.id, status: "Rejected" });
          }}>Reject</Button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">POD review</h1>
        <p className="text-sm text-muted-foreground">Review proofs of delivery uploaded by drivers.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>PODs</CardTitle><CardDescription>{pods.data?.length ?? 0} records</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={pods.data ?? []}
            columns={cols}
            rowKey={(p) => p.id}
            isLoading={pods.isLoading}
            error={pods.error as Error | null}
            searchPlaceholder="Search signer, ref…"
            filters={[
              { value: "pending", label: "Pending", predicate: (p) => !p.status || p.status === "Pending" },
              { value: "approved", label: "Approved", predicate: (p) => p.status === "Approved" },
              { value: "rejected", label: "Rejected", predicate: (p) => p.status === "Rejected" },
            ]}
            emptyMessage="No PODs to review."
          />
        </CardContent>
      </Card>
    </div>
  );
}
