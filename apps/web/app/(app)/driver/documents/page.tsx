"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload, CheckCircle2, Clock, XCircle } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useExplore, useActionGuard } from "@/lib/explore-store";

interface DocRow {
  id: string;
  type: string;
  status: string;
  expiry_date: string | null;
  file_path: string | null;
  created_at: string;
}

const DOC_TYPES = [
  "Driver License",
  "CDL",
  "Insurance",
  "Vehicle Registration",
  "Operating Authority",
  "Medical Certificate",
  "Other",
];

function statusIcon(status: string) {
  if (status === "Approved") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "Rejected" || status === "Expired") return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-yellow-500" />;
}

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "Approved") return "default";
  if (status === "Rejected" || status === "Expired") return "outline";
  return "secondary";
}

export default function DriverDocumentsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [expiry, setExpiry] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const userQ = useQuery({
    queryKey: ["auth", "user"],
    enabled: !isExploring,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });
  const userId = userQ.data ?? null;

  const SAMPLE_DOCS: DocRow[] = useMemo(() => [
    { id: "ex-doc-1", type: "Driver License", status: "Approved", expiry_date: "2028-04-30", file_path: "x", created_at: new Date(Date.now() - 86400000 * 30).toISOString() },
    { id: "ex-doc-2", type: "CDL", status: "Approved", expiry_date: "2027-11-15", file_path: "x", created_at: new Date(Date.now() - 86400000 * 20).toISOString() },
    { id: "ex-doc-3", type: "Insurance", status: "Pending", expiry_date: "2026-12-31", file_path: "x", created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
  ], []);

  const docsQ = useQuery({
    queryKey: ["driver", "documents", userId],
    enabled: !!userId && !isExploring,
    queryFn: async (): Promise<DocRow[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("worker_certifications")
        .select("id,type,status,expiry_date,file_path,created_at")
        .eq("worker_user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as DocRow[] | null) ?? [];
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not authenticated");
      if (!pendingFile) throw new Error("Choose a file to upload");
      const { data: row, error: insertErr } = await supabase
        .from("worker_certifications")
        .insert({
          worker_user_id: userId,
          type: docType,
          expiry_date: expiry.trim() || null,
          file_path: "",
          certificate_file: "",
          notes: "",
        })
        .select("id")
        .single();
      if (insertErr || !row) throw new Error(insertErr?.message ?? "Unable to create document record");
      const certId = row.id as string;
      const safeName = pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/${certId}/${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("certifications")
        .upload(path, pendingFile, { contentType: pendingFile.type || "application/octet-stream", upsert: true });
      if (upErr) {
        await supabase.from("worker_certifications").delete().eq("id", certId);
        throw upErr;
      }
      const { error: updErr } = await supabase
        .from("worker_certifications")
        .update({ file_path: path, certificate_file: path })
        .eq("id", certId);
      if (updErr) throw updErr;
    },
    onSuccess: async () => {
      setPendingFile(null);
      setExpiry("");
      if (fileRef.current) fileRef.current.value = "";
      await qc.invalidateQueries({ queryKey: ["driver", "documents"] });
    },
  });

  const docs = isExploring ? SAMPLE_DOCS : (docsQ.data ?? []);
  const approved = useMemo(() => docs.filter((d) => d.status === "Approved").length, [docs]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Driver</p>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload your licenses and compliance documents. Our team reviews each one before it&apos;s approved.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          <p className="text-sm font-semibold">Upload a document</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Document type</Label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Expiry date (optional)</Label>
              <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>File (PDF or image)</Label>
            <Input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {upload.isError ? (
            <p className="text-sm text-red-500">{upload.error instanceof Error ? upload.error.message : "Upload failed"}</p>
          ) : null}
          <Button onClick={() => { if (!guard("Submit a document")) return; upload.mutate(); }} disabled={upload.isPending || (!isExploring && !pendingFile)}>
            <Upload className="mr-1.5 h-4 w-4" /> {upload.isPending ? "Uploading…" : "Submit for review"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Your documents ({docs.length})</h2>
        <span className="text-xs text-muted-foreground">{approved} approved</span>
      </div>

      {!isExploring && docsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No documents yet</p>
            <p className="text-sm text-muted-foreground">Upload your first document above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  {statusIcon(d.status)}
                  <div>
                    <p className="font-medium">{d.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.expiry_date ? `Expires ${d.expiry_date}` : "No expiry"}
                    </p>
                  </div>
                </div>
                <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
