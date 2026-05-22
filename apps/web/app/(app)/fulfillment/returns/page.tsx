"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

interface ReturnRow {
  id: string;
  order_id: string;
  rma_number: string | null;
  reason: string;
  status: string;
  created_at: string;
}

interface OrderRow {
  id: string;
  reference_code: string | null;
}

// Valid return_status enum values from migration 0013:
// Requested, Approved, Rejected, Received, Refunded, Closed
const STATUS_TABS = ["all", "Requested", "Approved", "Rejected", "Received", "Refunded", "Closed"] as const;
type StatusTab = typeof STATUS_TABS[number];

function statusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Refunded" || s === "Closed") return "success";
  if (s === "Received") return "default";
  if (s === "Approved") return "warning";
  if (s === "Rejected") return "destructive";
  return "secondary"; // Requested
}

export default function FulfillmentReturnsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusTab>("all");
  const [showForm, setShowForm] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [activeTab, setActiveTab] = useState<"list" | "receive">("list");

  const returnsQ = useQuery({
    queryKey: ["fulfillment", "returns", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("return_authorizations")
        .select("id,order_id,rma_number,reason,status,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ReturnRow[];
    },
  });

  const ordersQ = useQuery({
    queryKey: ["fulfillment", "returns", "orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("id,reference_code")
        .limit(200);
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
    enabled: showForm,
  });

  const requestMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("request_rma", {
        p_order_id: orderId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", "returns"] });
      setShowForm(false);
      setOrderId("");
      setReason("");
    },
  });

  const updateStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("return_authorizations")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fulfillment", "returns"] }),
  });

  // Incoming = items actively being processed — Requested or Approved
  const incoming = (returnsQ.data ?? []).filter((r) =>
    ["Requested", "Approved"].includes(r.status)
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Returns (RMA)</h1>
          <p className="text-sm text-muted-foreground">
            Manage return authorizations, incoming returns, and refunds.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New RMA request"}
        </Button>
      </div>

      {/* New RMA form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Request return authorization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {requestMut.error && (
              <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {(requestMut.error as Error).message}
              </div>
            )}
            <div className="space-y-1">
              <Label>Order</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              >
                <option value="">Select an order…</option>
                {(ordersQ.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.reference_code ?? o.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Reason for return</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe the reason for this return…"
              />
            </div>
            <Button
              disabled={!orderId || !reason.trim() || requestMut.isPending}
              onClick={() => requestMut.mutate()}
            >
              {requestMut.isPending ? "Submitting…" : "Submit RMA request"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={activeTab === "list" ? "default" : "outline"}
          onClick={() => setActiveTab("list")}
        >
          All Returns
        </Button>
        <Button
          size="sm"
          variant={activeTab === "receive" ? "default" : "outline"}
          onClick={() => setActiveTab("receive")}
        >
          Incoming ({incoming.length})
        </Button>
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={statusFilter === t ? "default" : "outline"}
            onClick={() => setStatusFilter(t)}
          >
            {t === "all" ? "All" : t}
          </Button>
        ))}
      </div>

      {activeTab === "list" ? (
        <Card>
          <CardHeader>
            <CardTitle>Return authorizations</CardTitle>
            <CardDescription>{returnsQ.data?.length ?? 0} returns</CardDescription>
          </CardHeader>
          <CardContent>
            {returnsQ.isLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
            ) : (returnsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No returns found.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>RMA #</TH>
                    <TH>Order</TH>
                    <TH>Reason</TH>
                    <TH>Status</TH>
                    <TH>Created</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {(returnsQ.data ?? []).map((r) => (
                    <TR key={r.id}>
                      <TD className="font-mono text-sm">{r.rma_number ?? r.id.slice(0, 8)}</TD>
                      <TD className="font-mono text-xs">{r.order_id.slice(0, 8)}…</TD>
                      <TD className="text-sm max-w-xs truncate">{r.reason}</TD>
                      <TD>
                        <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      </TD>
                      <TD className="text-xs text-muted-foreground">{formatDate(r.created_at)}</TD>
                      <TD className="text-right space-x-2">
                        {/* Requested → Approve or Reject */}
                        {r.status === "Requested" && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              disabled={updateStatusMut.isPending}
                              onClick={() => updateStatusMut.mutate({ id: r.id, status: "Approved" })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={updateStatusMut.isPending}
                              onClick={() => updateStatusMut.mutate({ id: r.id, status: "Rejected" })}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {/* Approved → Mark Received or Close */}
                        {r.status === "Approved" && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              disabled={updateStatusMut.isPending}
                              onClick={() => updateStatusMut.mutate({ id: r.id, status: "Received" })}
                            >
                              Mark received
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updateStatusMut.isPending}
                              onClick={() => updateStatusMut.mutate({ id: r.id, status: "Closed" })}
                            >
                              Close
                            </Button>
                          </>
                        )}
                        {/* Received → Refund or Close */}
                        {r.status === "Received" && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              disabled={updateStatusMut.isPending}
                              onClick={() => updateStatusMut.mutate({ id: r.id, status: "Refunded" })}
                            >
                              Refund
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updateStatusMut.isPending}
                              onClick={() => updateStatusMut.mutate({ id: r.id, status: "Closed" })}
                            >
                              Close
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
      ) : (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Incoming returns ({incoming.length})</h2>
          {incoming.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No incoming returns at this time.
              </CardContent>
            </Card>
          ) : (
            incoming.map((r) => (
              <Card key={r.id} className="border-l-4 border-l-warning">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">
                      RMA {r.rma_number ?? r.id.slice(0, 8)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Order: {r.order_id.slice(0, 8)}… · {r.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(r.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    {r.status === "Approved" && (
                      <Button
                        size="sm"
                        disabled={updateStatusMut.isPending}
                        onClick={() => updateStatusMut.mutate({ id: r.id, status: "Received" })}
                      >
                        Mark received
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
