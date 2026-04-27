"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface ListingRow {
  id: string;
  title: string;
  status: string;
  price_per_pallet: number | null;
  city: string | null;
  state: string | null;
  created_at: string;
}

export default function WarehouseListingsPage() {
  const supabase = getBrowserSupabase();
  const q = useQuery({
    queryKey: ["warehouse", "listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_listings")
        .select("id, title, status, price_per_pallet, city, state, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ListingRow[];
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Warehouse listings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Your listings</CardTitle>
          <CardDescription>{q.data?.length ?? 0} listings</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (q.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No listings yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Location</TH>
                  <TH>Status</TH>
                  <TH>Price / pallet</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {(q.data ?? []).map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.title}</TD>
                    <TD>
                      {r.city ?? "—"}
                      {r.state ? `, ${r.state}` : ""}
                    </TD>
                    <TD>
                      <Badge variant={r.status === "Active" ? "success" : "warning"}>{r.status}</Badge>
                    </TD>
                    <TD>{r.price_per_pallet != null ? `$${Number(r.price_per_pallet).toFixed(2)}` : "—"}</TD>
                    <TD>{formatDate(r.created_at)}</TD>
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
