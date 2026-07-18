"use client";

import { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Send, Upload } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RequestRow {
  id: string;
  title: string;
  mode: string;
  container_no: string;
  bl_number: string;
  port_of_entry: string;
  eta: string | null;
  cargo_description: string;
  commercial_value: number;
  currency: string;
  notes: string;
  status: string;
  quote_amount: number;
  quote_note: string;
  entry_number: string;
  reject_reason: string;
  [k: string]: unknown;
}

interface DocRow {
  id: string;
  name: string;
  doc_type: string;
  file_path: string;
  status: string;
  note: string;
}

interface MessageRow {
  id: string;
  sender_name: string;
  body: string;
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

/** Customer-side clearance detail — quote review, document uploads and broker chat. */
export default function ClearanceDetailPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const params = useParams<{ requestId: string }>();
  const id = params.requestId;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadSlot, setUploadSlot] = useState<DocRow | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  const requestQ = useQuery({
    queryKey: ["clearance", "request", id],
    enabled: !!id,
    refetchInterval: 15000,
    queryFn: async (): Promise<RequestRow | null> => {
      const { data, error } = await supabase.from("clearance_requests").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as RequestRow | null) ?? null;
    },
  });

  const docsQ = useQuery({
    queryKey: ["clearance", "docs", id],
    enabled: !!id,
    refetchInterval: 15000,
    queryFn: async (): Promise<DocRow[]> => {
      const { data, error } = await supabase.from("clearance_documents").select("*").eq("request_id", id).order("created_at");
      if (error) return [];
      return (data as DocRow[] | null) ?? [];
    },
  });

  const messagesQ = useQuery({
    queryKey: ["clearance", "messages", id],
    enabled: !!id,
    refetchInterval: 5000,
    queryFn: async (): Promise<MessageRow[]> => {
      const { data, error } = await supabase.from("clearance_messages").select("*").eq("request_id", id).order("created_at");
      if (error) return [];
      return (data as MessageRow[] | null) ?? [];
    },
  });

  const runRpc = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown> }) => {
      const { error } = await supabase.rpc(fn, args);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["clearance"] });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id ?? "user";
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${id}/${userId}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from("clearance-docs").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw new Error(upErr.message);
      const { error } = await supabase.rpc("clearance_submit_document", {
        p_request_id: id,
        p_file_path: path,
        p_name: uploadSlot?.name ?? file.name,
        p_doc_type: uploadSlot?.doc_type ?? "Other",
        p_document_id: uploadSlot?.id ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setUploadSlot(null);
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["clearance"] });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const openDoc = async (doc: DocRow) => {
    if (!doc.file_path) return;
    const { data, error } = await supabase.storage.from("clearance-docs").createSignedUrl(doc.file_path, 300);
    if (!error && data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const request = requestQ.data;
  const docs = useMemo(() => docsQ.data ?? [], [docsQ.data]);
  const messages = useMemo(() => messagesQ.data ?? [], [messagesQ.data]);

  if (!request) {
    return <p className="text-sm text-muted-foreground">{requestQ.isLoading ? "Loading…" : "Request not found."}</p>;
  }

  const closed = ["Cleared", "Rejected", "Cancelled"].includes(request.status);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadMutation.mutate(f);
          e.target.value = "";
        }}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Customs clearance</p>
          <h1 className="text-2xl font-semibold tracking-tight">{request.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{request.mode} clearance</p>
        </div>
        <Badge className={STATUS_CLASS[request.status] ?? ""}>{request.status}</Badge>
      </div>

      {actionError && <p className="text-sm text-red-400">{actionError}</p>}

      {request.status === "Quoted" && Number(request.quote_amount) > 0 && (
        <Card className="border-emerald-500/40">
          <CardContent className="pt-6">
            <p className="text-sm font-medium">Quote received</p>
            <p className="mt-1 text-2xl font-bold text-emerald-300">${Number(request.quote_amount).toFixed(2)} {request.currency}</p>
            {request.quote_note ? <p className="mt-1 text-xs text-muted-foreground">{request.quote_note}</p> : null}
            <Button
              className="mt-3"
              disabled={runRpc.isPending}
              onClick={() => runRpc.mutate({ fn: "clearance_accept_quote", args: { p_request_id: id } })}
            >
              Accept quote & start clearance
            </Button>
          </CardContent>
        </Card>
      )}

      {request.status === "Cleared" && (
        <Card className="border-emerald-500/40">
          <CardContent className="pt-6">
            <p className="font-medium text-emerald-300">✓ Shipment cleared customs</p>
            {request.entry_number ? <p className="mt-1 text-xs text-muted-foreground">Entry number: {request.entry_number}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">The brokerage invoice was issued to your company.</p>
          </CardContent>
        </Card>
      )}

      {request.status === "Rejected" && request.reject_reason && (
        <Card className="border-red-500/40">
          <CardContent className="pt-6">
            <p className="font-medium text-red-300">Declined by broker</p>
            <p className="mt-1 text-xs text-muted-foreground">{request.reject_reason}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Shipment</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {[
                ["Container", request.container_no],
                ["BL number", request.bl_number],
                ["Port", request.port_of_entry],
                ["ETA", request.eta ?? ""],
                ["Value", Number(request.commercial_value) > 0 ? `$${Number(request.commercial_value).toLocaleString()} ${request.currency}` : ""],
                ["Cargo", request.cargo_description],
                ["Notes", request.notes],
              ].filter(([, v]) => !!v).map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{k}</span>
                  <span className="text-xs">{v}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {!closed && (
            <Button
              variant="outline"
              className="w-full text-red-300"
              disabled={runRpc.isPending}
              onClick={() => runRpc.mutate({ fn: "clearance_cancel_request", args: { p_request_id: id } })}
            >
              Cancel this request
            </Button>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Documents</CardTitle>
              {!closed && (
                <Button size="sm" variant="outline" disabled={uploadMutation.isPending} onClick={() => { setUploadSlot(null); fileInputRef.current?.click(); }}>
                  <Upload className="mr-2 h-3.5 w-3.5" />{uploadMutation.isPending ? "Uploading…" : "Add document"}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {docs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No documents yet. Your broker will request what they need — or add your commercial invoice, packing list and BL now.
                </p>
              ) : (
                docs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-card/60 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm"><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{d.name}</p>
                      {d.note ? <p className="text-xs text-muted-foreground">{d.note}</p> : null}
                    </div>
                    <Badge className={
                      d.status === "Accepted" ? "bg-emerald-500/15 text-emerald-300"
                        : d.status === "Rejected" ? "bg-red-500/15 text-red-300"
                        : d.status === "Uploaded" ? "bg-blue-500/15 text-blue-300"
                        : "bg-yellow-500/15 text-yellow-300"
                    }>{d.status}</Badge>
                    {d.file_path ? <Button variant="outline" size="sm" onClick={() => void openDoc(d)}>View</Button> : null}
                    {(d.status === "Requested" || d.status === "Rejected") && !closed ? (
                      <Button size="sm" disabled={uploadMutation.isPending} onClick={() => { setUploadSlot(d); fileInputRef.current?.click(); }}>
                        Upload
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Messages</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">No messages yet — talk to your broker here.</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className="rounded-lg bg-muted/40 px-3 py-2">
                      <p className="text-xs font-semibold text-primary">{m.sender_name || "User"}</p>
                      <p className="text-sm">{m.body}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Message your broker…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && message.trim()) {
                      runRpc.mutate({ fn: "clearance_send_message", args: { p_request_id: id, p_body: message.trim() } });
                      setMessage("");
                    }
                  }}
                />
                <Button
                  disabled={!message.trim() || runRpc.isPending}
                  onClick={() => {
                    runRpc.mutate({ fn: "clearance_send_message", args: { p_request_id: id, p_body: message.trim() } });
                    setMessage("");
                  }}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
