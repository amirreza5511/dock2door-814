"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Radar, ChevronRight } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { useExplore } from "@/lib/explore-store";

const SAMPLE_SHIPMENTS: ShipmentRow[] = [
  { id: "ex-shp-1a2b3c4d", status: "EnRoute", carrier_code: "HARB", service_level: "FTL", tracking_code: "D2D-48210", created_at: new Date(Date.now() - 6 * 3600e3).toISOString() },
  { id: "ex-shp-5e6f7a8b", status: "Scheduled", carrier_code: "HARB", service_level: "Reefer", tracking_code: "D2D-48244", created_at: new Date(Date.now() - 20 * 3600e3).toISOString() },
  { id: "ex-shp-9c0d1e2f", status: "Delivered", carrier_code: "MAPL", service_level: "LTL", tracking_code: "D2D-48099", created_at: new Date(Date.now() - 72 * 3600e3).toISOString() },
];

interface ShipmentRow {
  id: string;
  status: string;
  carrier_code: string | null;
  service_level: string | null;
  tracking_code: string | null;
  created_at: string;
}

export default function TruckingDispatchPage() {
  const { isExploring } = useExplore();
  const supabase = getBrowserSupabase();
  const q = useQuery({
    enabled: !isExploring,
    queryKey: ["trucking", "shipments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,status,carrier_code,service_level,tracking_code,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ShipmentRow[];
    },
  });

  const rows = isExploring ? SAMPLE_SHIPMENTS : (q.data ?? []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dispatch</h1>

      <Link href="/trucking/dispatch" className="block">
        <Card className="border-primary/40 transition-colors hover:bg-accent/40">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-primary">
              <Radar className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Live dispatch board</p>
              <p className="text-xs text-muted-foreground">See every truck live on the map and track each driver.</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Active shipments</CardTitle>
          <CardDescription>{rows.length} shipments</CardDescription>
        </CardHeader>
        <CardContent>
          {!isExploring && q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shipments yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Shipment</TH>
                  <TH>Status</TH>
                  <TH>Carrier</TH>
                  <TH>Tracking</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-mono text-xs">{s.id.slice(0, 8)}</TD>
                    <TD>
                      <Badge>{s.status}</Badge>
                    </TD>
                    <TD>{`${s.carrier_code ?? "—"} ${s.service_level ?? ""}`}</TD>
                    <TD className="font-mono text-xs">{s.tracking_code ?? "—"}</TD>
                    <TD>{formatDate(s.created_at)}</TD>
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
