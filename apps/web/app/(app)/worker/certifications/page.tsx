"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface Cert {
  id: string;
  type: string;
  status: string;
  expiry_date: string | null;
  notes: string | null;
  file_path: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const TYPES = ["Forklift", "HighReach", "WHMIS", "FirstAid", "Other"];

export default function WorkerCertificationsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [type, setType] = useState("Forklift");
  const [expiry, setExpiry] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const certs = useQuery({
    queryKey: ["worker", "certifications"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("worker_certifications")
        .select("id,type,status,expiry_date,notes,file_path,reviewed_at,created_at")
        .eq("worker_user_id", u.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Cert[];
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file first.");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in.");
      const { data: row, error: rowErr } = await supabase
        .from("worker_certifications")
        .insert({ worker_user_id: u.user.id, type, expiry_date: expiry || null })
        .select("id")
        .single();
      if (rowErr) throw rowErr;
      const certId = (row as { id: string }).id;
      const path = `${u.user.id}/${certId}/${file.name}`;
      const up = await supabase.storage.from("certifications").upload(path, file, { upsert: false });
      if (up.error) {
        await supabase.from("worker_certifications").delete().eq("id", certId);
        throw up.error;
      }
      const { error: patchErr } = await supabase
        .from("worker_certifications")
        .update({ file_path: path })
        .eq("id", certId);
      if (patchErr) throw patchErr;
    },
    onSuccess: () => {
      setFile(null); setExpiry("");
      qc.invalidateQueries({ queryKey: ["worker", "certifications"] });
    },
  });

  const view = useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.functions.invoke("get-signed-url", {
        body: { bucket: "certifications", path },
      });
      if (error) throw error;
      const url = (data as { signedUrl?: string; url?: string } | null)?.signedUrl
        ?? (data as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank");
    },
  });

  const cols: Column<Cert>[] = [
    { key: "type", header: "Type", render: (c) => c.type },
    { key: "status", header: "Status", render: (c) => <Badge variant={c.status === "Approved" ? "success" : c.status === "Rejected" ? "destructive" : "warning"}>{c.status}</Badge>, sortable: true, sortValue: (c) => c.status },
    { key: "expiry", header: "Expiry", render: (c) => c.expiry_date ?? "—" },
    { key: "reviewed", header: "Reviewed", render: (c) => c.reviewed_at ? formatDate(c.reviewed_at) : "—" },
    { key: "notes", header: "Notes", render: (c) => c.notes ?? "—" },
    { key: "actions", header: "", className: "text-right", render: (c) => (
      c.file_path ? <Button size="sm" variant="secondary" onClick={() => view.mutate(c.file_path!)}>View file</Button> : null
    ) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Certifications</h1>
        <p className="text-sm text-muted-foreground">Upload your certs. Admin reviews before they unlock relevant shifts.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Upload</CardTitle><CardDescription>PDF or image. Status is set to Pending until admin review.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); upload.mutate(); }}>
            <div>
              <Label>Type</Label>
              <select className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><Label>Expiry</Label><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
            <div><Label>File</Label><Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <div className="md:col-span-3 flex items-center gap-2">
              <Button type="submit" disabled={!file || upload.isPending}>Submit</Button>
              {upload.error && <span className="text-sm text-red-600">{(upload.error as Error).message}</span>}
              {upload.isSuccess && <span className="text-sm text-emerald-600">Submitted.</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>My certifications</CardTitle><CardDescription>{certs.data?.length ?? 0} total</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={certs.data ?? []}
            columns={cols}
            rowKey={(c) => c.id}
            isLoading={certs.isLoading}
            error={certs.error as Error | null}
            filters={[
              { value: "pending", label: "Pending", predicate: (c) => c.status === "Pending" },
              { value: "approved", label: "Approved", predicate: (c) => c.status === "Approved" },
              { value: "rejected", label: "Rejected", predicate: (c) => c.status === "Rejected" },
            ]}
            emptyMessage="No certifications uploaded."
          />
        </CardContent>
      </Card>
    </div>
  );
}
