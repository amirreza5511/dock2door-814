"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

interface ManifestRow {
  id: string;
  carrier_code: string;
  status: "Open" | "Closed" | "Submitted" | "Failed";
  manifest_number: string | null;
  manifest_url: string | null;
  shipment_count: number;
  failed_reason: string | null;
  created_at: string;
  submitted_at: string | null;
}

interface ShipmentRow {
  id: string;
  carrier_code: string | null;
  tracking_code: string | null;
  status: string;
  manifest_id: string | null;
  provider_company_id: string | null;
}

function manifestStatusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Submitted") return "success";
  if (s === "Open") return "default";
  if (s === "Closed") return "secondary";
  if (s === "Failed") return "destructive";
  return "secondary";
}

export default function FulfillmentManifestPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const companyQ = useQuery({
    queryKey: ["fulfillment", "manifest", "company"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: cu } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();
      return cu?.company_id ?? null;
    },
  });

  const manifestsQ = useQuery({
    queryKey: ["fulfillment", "manifests"],
    queryFn: async () => {
      const companyId = companyQ.data;
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("shipping_manifests")
        .select("id,carrier_code,status,manifest_number,manifest_url,shipment_count,failed_reason,created_at,submitted_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ManifestRow[];
    },
    enabled: Boolean(companyQ.data),
  });

  const shipmentsQ = useQuery({
    queryKey: ["fulfillment", "manifest-shipments"],
    queryFn: async () => {
      const companyId = companyQ.data;
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("shipments")
        .select("id,carrier_code,tracking_code,status,manifest_id,provider_company_id")
        .eq("provider_company_id", companyId)
        .eq("status", "LabelPurchased")
        .is("manifest_id", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ShipmentRow[];
    },
    enabled: Boolean(companyQ.data),
  });

  const manifestable = useMemo(
    () => (shipmentsQ.data ?? []).filter((s) => s.status === "LabelPurchased" && !s.manifest_id),
    [shipmentsQ.data]
  );

  const groupedByCarrier = useMemo(() => {
    const g: Record<string, ShipmentRow[]> = {};
    for (const s of manifestable) {
      const c = (s.carrier_code ?? "UNKNOWN").toUpperCase();
      if (!g[c]) g[c] = [];
      g[c].push(s);
    }
    return g;
  }, [manifestable]);

  const createMut = useMutation({
    mutationFn: async ({ carrierCode, shipmentIds }: { carrierCode: string; shipmentIds: string[] }) => {
      const { data, error } = await supabase.functions.invoke("create-manifest", {
        body: {
          companyId: companyQ.data,
          carrierCode,
          shipmentIds,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", "manifests"] });
      qc.invalidateQueries({ queryKey: ["fulfillment", "manifest-shipments"] });
      setSelected({});
    },
  });

  const handleCreateManifest = (carrier: string) => {
    const ids = (groupedByCarrier[carrier] ?? [])
      .filter((s) => selected[s.id])
      .map((s) => s.id);
    if (ids.length === 0) {
      alert("Select at least one shipment to include in this manifest.");
      return;
    }
    createMut.mutate({ carrierCode: carrier, shipmentIds: ids });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Outbound Manifest</h1>
        <p className="text-sm text-muted-foreground">
          Group label-purchased shipments into carrier manifests for end-of-day submission.
        </p>
      </div>

      {createMut.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(createMut.error as Error).message}
        </div>
      )}

      {/* Manifestable shipments grouped by carrier */}
      {Object.keys(groupedByCarrier).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold">Ready to manifest ({manifestable.length} shipments)</h2>
          {Object.entries(groupedByCarrier).map(([carrier, shipments]) => (
            <Card key={carrier}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{carrier}</CardTitle>
                  <Button
                    size="sm"
                    disabled={createMut.isPending}
                    onClick={() => handleCreateManifest(carrier)}
                  >
                    {createMut.isPending ? "Creating…" : `Close manifest (${shipments.filter((s) => selected[s.id]).length} selected)`}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <TR>
                      <TH>
                        <input
                          type="checkbox"
                          onChange={(e) => {
                            const next = { ...selected };
                            for (const s of shipments) next[s.id] = e.target.checked;
                            setSelected(next);
                          }}
                          checked={shipments.every((s) => selected[s.id])}
                        />
                      </TH>
                      <TH>Shipment ID</TH>
                      <TH>Tracking</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {shipments.map((s) => (
                      <TR key={s.id}>
                        <TD>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[s.id])}
                            onChange={(e) => setSelected((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                          />
                        </TD>
                        <TD className="font-mono text-xs">{s.id.slice(0, 8)}…</TD>
                        <TD className="font-mono text-xs">{s.tracking_code ?? "—"}</TD>
                        <TD>
                          <Badge variant="secondary">{s.status}</Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {Object.keys(groupedByCarrier).length === 0 && !shipmentsQ.isLoading && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No shipments ready for manifest. Shipments must have a label purchased (status = LabelPurchased) and no existing manifest.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Manifests history */}
      <Card>
        <CardHeader>
          <CardTitle>Manifest history</CardTitle>
          <CardDescription>{manifestsQ.data?.length ?? 0} manifests</CardDescription>
        </CardHeader>
        <CardContent>
          {manifestsQ.isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : (manifestsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No manifests created yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Manifest #</TH>
                  <TH>Carrier</TH>
                  <TH>Status</TH>
                  <TH>Shipments</TH>
                  <TH>Created</TH>
                  <TH>Submitted</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(manifestsQ.data ?? []).map((m) => (
                  <TR key={m.id}>
                    <TD className="font-mono text-sm">{m.manifest_number ?? m.id.slice(0, 8)}</TD>
                    <TD className="uppercase text-sm">{m.carrier_code}</TD>
                    <TD>
                      <Badge variant={manifestStatusVariant(m.status)}>{m.status}</Badge>
                    </TD>
                    <TD>{m.shipment_count}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(m.created_at)}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(m.submitted_at)}</TD>
                    <TD>
                      {m.manifest_url && (
                        <a
                          href={m.manifest_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline text-primary"
                        >
                          Download
                        </a>
                      )}
                      {m.failed_reason && (
                        <span className="text-xs text-destructive">{m.failed_reason}</span>
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
