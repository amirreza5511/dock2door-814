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

interface ShipmentRow {
  id: string;
  status: string;
  tracking_code: string | null;
  carrier_code: string | null;
  created_at: string;
  weight_kg: number | null;
  label_url: string | null;
}

interface RateQuote {
  id: string;
  carrier_code: string;
  service_level: string;
  service_name: string;
  rate_amount: string | number;
  currency: string;
  est_delivery_days: number | null;
  est_delivery_date: string | null;
  carrier_rate_id: string;
}

const CARRIER_LABELS: Record<string, string> = {
  canada_post: "Canada Post",
  ups: "UPS",
  fedex: "FedEx",
  dhl: "DHL",
  purolator: "Purolator",
  easypost: "EasyPost",
  shippo: "Shippo",
};

function shipmentStatusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Delivered") return "success";
  if (s === "LabelPurchased" || s === "InTransit") return "default";
  if (s === "Pending") return "warning";
  if (s === "Failed") return "destructive";
  return "secondary";
}

export default function FulfillmentRateShopPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);

  const shipmentsQ = useQuery({
    queryKey: ["fulfillment", "rate-shop", "shipments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,status,tracking_code,carrier_code,created_at,weight_kg,label_url")
        .in("status", ["Pending", "RateShopPending"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ShipmentRow[];
    },
  });

  const quotesQ = useQuery({
    queryKey: ["fulfillment", "rate-shop", "quotes", selectedShipmentId],
    queryFn: async () => {
      if (!selectedShipmentId) return [];
      const { data, error } = await supabase
        .from("rate_quotes")
        .select("id,carrier_code,service_level,service_name,rate_amount,currency,est_delivery_days,est_delivery_date,carrier_rate_id")
        .eq("shipment_id", selectedShipmentId)
        .order("rate_amount", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RateQuote[];
    },
    enabled: Boolean(selectedShipmentId),
  });

  const rateShopMut = useMutation({
    mutationFn: async (shipmentId: string) => {
      const { data, error } = await supabase.functions.invoke("rate-shop-shipment", {
        body: { shipmentId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fulfillment", "rate-shop", "quotes", selectedShipmentId] });
    },
  });

  const purchaseMut = useMutation({
    mutationFn: async ({ shipmentId, rateQuoteId }: { shipmentId: string; rateQuoteId: string }) => {
      const { data, error } = await supabase.functions.invoke("purchase-shipping-label", {
        body: { shipment_id: shipmentId, rate_quote_id: rateQuoteId },
      });
      if (error) throw error;
      return data as { tracking_code: string; label_url: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["fulfillment", "rate-shop", "shipments"] });
      setSelectedQuoteId(null);
      if (data?.label_url) {
        window.open(data.label_url, "_blank");
      }
    },
  });

  const selectedShipment = (shipmentsQ.data ?? []).find((s) => s.id === selectedShipmentId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rate Shopping</h1>
        <p className="text-sm text-muted-foreground">
          Compare rates from Canada Post, UPS, DHL, FedEx, Purolator, EasyPost, and Shippo.
        </p>
      </div>

      {purchaseMut.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(purchaseMut.error as Error).message}
        </div>
      )}

      {rateShopMut.error && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Rate shop error: {(rateShopMut.error as Error).message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending shipments */}
        <Card>
          <CardHeader>
            <CardTitle>Shipments awaiting label</CardTitle>
            <CardDescription>Select a shipment to view or fetch rates</CardDescription>
          </CardHeader>
          <CardContent>
            {shipmentsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (shipmentsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No shipments pending rate shop.
              </p>
            ) : (
              <div className="space-y-2">
                {(shipmentsQ.data ?? []).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedShipmentId(s.id); setSelectedQuoteId(null); }}
                    className={`w-full text-left rounded border px-3 py-3 transition-colors ${
                      selectedShipmentId === s.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm">{s.id.slice(0, 8)}…</span>
                      <Badge variant={shipmentStatusVariant(s.status)}>{s.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.weight_kg ? `${s.weight_kg} kg` : "Weight TBD"} · {formatDate(s.created_at)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rate quotes */}
        <Card>
          <CardHeader>
            <CardTitle>Rate comparison</CardTitle>
            <CardDescription>
              {selectedShipmentId
                ? `Shipment ${selectedShipmentId.slice(0, 8)}…`
                : "Select a shipment to see rates"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedShipmentId && (
              <Button
                variant="outline"
                size="sm"
                disabled={rateShopMut.isPending}
                onClick={() => rateShopMut.mutate(selectedShipmentId)}
              >
                {rateShopMut.isPending ? "Fetching rates…" : "↺ Refresh rates"}
              </Button>
            )}

            {!selectedShipmentId ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Select a shipment on the left to compare rates.
              </p>
            ) : quotesQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading quotes…</p>
            ) : (quotesQ.data ?? []).length === 0 ? (
              <div className="py-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">No rates fetched yet.</p>
                <Button size="sm" onClick={() => rateShopMut.mutate(selectedShipmentId!)}>
                  Fetch rates now
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {(quotesQ.data ?? []).map((q) => (
                  <div
                    key={q.id}
                    onClick={() => setSelectedQuoteId(q.id)}
                    className={`rounded border px-4 py-3 cursor-pointer transition-colors ${
                      selectedQuoteId === q.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">
                          {CARRIER_LABELS[q.carrier_code] ?? q.carrier_code}
                        </p>
                        <p className="text-xs text-muted-foreground">{q.service_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">
                          ${Number(q.rate_amount).toFixed(2)}
                          <span className="text-xs font-normal ml-1">{q.currency}</span>
                        </p>
                        {q.est_delivery_days && (
                          <p className="text-xs text-muted-foreground">
                            ~{q.est_delivery_days} days
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {selectedQuoteId && (
                  <div className="pt-2 flex justify-end">
                    <Button
                      disabled={purchaseMut.isPending}
                      onClick={() =>
                        purchaseMut.mutate({
                          shipmentId: selectedShipmentId!,
                          rateQuoteId: selectedQuoteId,
                        })
                      }
                    >
                      {purchaseMut.isPending ? "Purchasing label…" : "Purchase label →"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* All shipments history */}
      <Card>
        <CardHeader>
          <CardTitle>All shipments</CardTitle>
          <CardDescription>Full shipment history with label and tracking info</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Shipment ID</TH>
                <TH>Carrier</TH>
                <TH>Tracking</TH>
                <TH>Status</TH>
                <TH>Created</TH>
                <TH>Label</TH>
              </TR>
            </THead>
            <TBody>
              {(shipmentsQ.data ?? []).map((s) => (
                <TR key={s.id}>
                  <TD>
                    <button
                      className="font-mono text-xs hover:underline text-primary"
                      onClick={() => setSelectedShipmentId(s.id)}
                    >
                      {s.id.slice(0, 8)}…
                    </button>
                  </TD>
                  <TD className="text-sm">{s.carrier_code ? CARRIER_LABELS[s.carrier_code] ?? s.carrier_code : "—"}</TD>
                  <TD className="font-mono text-xs">{s.tracking_code ?? "—"}</TD>
                  <TD>
                    <Badge variant={shipmentStatusVariant(s.status)}>{s.status}</Badge>
                  </TD>
                  <TD className="text-xs text-muted-foreground">{formatDate(s.created_at)}</TD>
                  <TD>
                    {s.label_url ? (
                      <a
                        href={s.label_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline text-primary"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
