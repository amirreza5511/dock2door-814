"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface ShipmentRow {
  id: string;
  status: string;
  carrier_code: string | null;
  service_level: string | null;
  tracking_code: string | null;
  created_at: string;
}

export default function TruckingDispatchPage() {
  const supabase = getBrowserSupabase();
  const q = useQuery({
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dispatch</h1>
      <Card>
        <CardHeader>
          <CardTitle>Active shipments</CardTitle>
          <CardDescription>{q.data?.length ?? 0} shipments</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (q.data ?? []).length === 0 ? (
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
                {(q.data ?? []).map((s) => (
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
