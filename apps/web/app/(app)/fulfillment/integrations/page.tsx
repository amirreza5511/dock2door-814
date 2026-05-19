"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface Connection {
  id: string;
  channel_kind: string;
  status: string;
  external_account_id: string | null;
  shop_domain: string | null;
  marketplace_id: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface SyncLog {
  id: string;
  connection_id: string;
  kind: string;
  result: string;
  message: string | null;
  created_at: string;
}

interface ChannelOrder {
  id: string;
  channel_kind: string;
  external_order_id: string;
  status: string;
  total_amount: number | null;
  currency: string | null;
  fulfillment_pushed_at: string | null;
  fulfillment_push_error: string | null;
  ordered_at: string | null;
  created_at: string;
}

export default function IntegrationsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);
  const [disconnectReason, setDisconnectReason] = useState("");

  const connections = useQuery({
    queryKey: ["channel", "connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_connections_public")
        .select("id,channel_kind,status,external_account_id,shop_domain,marketplace_id,last_synced_at,last_error,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Connection[];
    },
  });

  const logs = useQuery({
    queryKey: ["channel", "sync_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_sync_logs")
        .select("id,connection_id,kind,result,message,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as SyncLog[];
    },
  });

  const channelOrders = useQuery({
    queryKey: ["channel", "orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_orders")
        .select("id,channel_kind,external_order_id,status,total_amount,currency,fulfillment_pushed_at,fulfillment_push_error,ordered_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ChannelOrder[];
    },
  });

  const syncNow = useMutation({
    mutationFn: async (c: Connection) => {
      const fn = c.channel_kind === "shopify" ? "shopify-sync-orders" : "amazon-sync-orders";
      const { error } = await supabase.functions.invoke(fn, { body: { connection_id: c.id } });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel"] });
    },
  });

  const disconnect = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("channel_connection_disconnect", { p_connection_id: id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channel", "connections"] }),
  });

  const retryFulfillment = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc("channel_retry_fulfillment_push", { p_channel_order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channel", "orders"] }),
  });

  const connectionCols: Column<Connection>[] = [
    { key: "channel", header: "Channel", render: (c) => <Badge variant={c.channel_kind === "shopify" ? "default" : "secondary"}>{c.channel_kind}</Badge> },
    { key: "account", header: "Account", render: (c) => c.shop_domain ?? c.marketplace_id ?? c.external_account_id ?? "—" },
    { key: "status", header: "Status", render: (c) => <Badge variant={c.status === "active" ? "success" : c.status === "error" ? "destructive" : "warning"}>{c.status}</Badge>, sortable: true, sortValue: (c) => c.status },
    { key: "last_sync", header: "Last sync", render: (c) => c.last_synced_at ? formatDate(c.last_synced_at) : "—" },
    { key: "error", header: "Error", render: (c) => c.last_error ? <span className="text-xs text-red-600">{c.last_error.slice(0, 80)}</span> : "—" },
    { key: "actions", header: "", className: "text-right", render: (c) => (
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={syncNow.isPending} onClick={() => syncNow.mutate(c)}>Sync now</Button>
        <Button size="sm" variant="destructive" onClick={() => { setDisconnectTarget(c); setDisconnectReason(""); }}>Disconnect</Button>
      </div>
    ) },
  ];

  const orderCols: Column<ChannelOrder>[] = [
    { key: "channel", header: "Channel", render: (o) => <Badge variant="secondary">{o.channel_kind}</Badge> },
    { key: "ext", header: "Channel order", render: (o) => <span className="font-mono text-xs">{o.external_order_id}</span> },
    { key: "status", header: "Status", render: (o) => <Badge>{o.status}</Badge>, sortable: true, sortValue: (o) => o.status },
    { key: "total", header: "Total", render: (o) => o.total_amount ? `${Number(o.total_amount).toFixed(2)} ${o.currency ?? ""}` : "—" },
    { key: "ordered", header: "Ordered", render: (o) => o.ordered_at ? formatDate(o.ordered_at) : formatDate(o.created_at) },
    { key: "sync", header: "Fulfillment sync", render: (o) => (
      o.fulfillment_pushed_at ? <Badge variant="success">synced</Badge>
        : o.fulfillment_push_error ? <Badge variant="destructive">failed</Badge>
        : <Badge variant="secondary">pending</Badge>
    ) },
    { key: "actions", header: "", className: "text-right", render: (o) => (
      o.fulfillment_push_error ? (
        <Button size="sm" disabled={retryFulfillment.isPending} onClick={() => retryFulfillment.mutate(o.id)}>Retry</Button>
      ) : null
    ) },
  ];

  const logCols: Column<SyncLog>[] = [
    { key: "kind", header: "Kind", render: (l) => <Badge variant="secondary">{l.kind}</Badge> },
    { key: "result", header: "Result", render: (l) => <Badge variant={l.result === "success" ? "success" : l.result === "error" ? "destructive" : "warning"}>{l.result}</Badge> },
    { key: "message", header: "Message", render: (l) => l.message ?? "—" },
    { key: "when", header: "When", render: (l) => formatDate(l.created_at), sortable: true, sortValue: (l) => l.created_at },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales channel integrations</h1>
        <p className="text-sm text-muted-foreground">Shopify and Amazon connections, orders, and sync state.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
          <CardDescription>Use the mobile app to authorize new stores. Sync, retry, and disconnect from here.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={connections.data ?? []}
            columns={connectionCols}
            rowKey={(c) => c.id}
            isLoading={connections.isLoading}
            error={connections.error as Error | null}
            emptyMessage="No connected stores yet."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Channel orders</CardTitle><CardDescription>Imported orders + outbound fulfillment status.</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={channelOrders.data ?? []}
            columns={orderCols}
            rowKey={(o) => o.id}
            isLoading={channelOrders.isLoading}
            error={channelOrders.error as Error | null}
            searchPlaceholder="Search channel order id…"
            filters={[
              { value: "failed", label: "Sync failed", predicate: (o) => !!o.fulfillment_push_error },
              { value: "synced", label: "Synced", predicate: (o) => !!o.fulfillment_pushed_at },
              { value: "pending", label: "Sync pending", predicate: (o) => !o.fulfillment_pushed_at && !o.fulfillment_push_error },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sync log</CardTitle><CardDescription>Most recent 100 events.</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={logs.data ?? []}
            columns={logCols}
            rowKey={(l) => l.id}
            isLoading={logs.isLoading}
            error={logs.error as Error | null}
            filters={[
              { value: "error", label: "Errors", predicate: (l) => l.result === "error" },
              { value: "success", label: "Success", predicate: (l) => l.result === "success" },
            ]}
            emptyMessage="No sync events yet."
          />
        </CardContent>
      </Card>
      {disconnectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDisconnectTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-base">Disconnect integration</h3>
            <p className="text-sm text-muted-foreground">
              Disconnect <span className="font-medium capitalize">{disconnectTarget.channel_kind}</span> store{disconnectTarget.shop_domain ? ` (${disconnectTarget.shop_domain})` : ""}? Orders already imported will be kept.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="disc-reason">Reason *</Label>
              <Input
                id="disc-reason"
                placeholder="e.g. switching to a different channel…"
                value={disconnectReason}
                onChange={(e) => setDisconnectReason(e.target.value)}
              />
            </div>
            {disconnect.error && (
              <p className="text-sm text-red-600">{(disconnect.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDisconnectTarget(null)}>Cancel</Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!disconnectReason.trim() || disconnect.isPending}
                onClick={() =>
                  disconnect.mutate(
                    { id: disconnectTarget.id, reason: disconnectReason.trim() },
                    { onSuccess: () => setDisconnectTarget(null) },
                  )
                }
              >
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
