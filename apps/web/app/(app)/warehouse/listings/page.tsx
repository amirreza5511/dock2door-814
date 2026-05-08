"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

interface ListingRow {
  id: string;
  name: string;
  warehouse_type: string;
  city: string | null;
  status: string;
  storage_rate_per_pallet: number | null;
  available_pallet_capacity: number | null;
  storage_term: string | null;
  created_at: string;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  Active: "success",
  Available: "success",
  PendingApproval: "warning",
  Draft: "secondary",
  Hidden: "secondary",
  Suspended: "destructive",
};

export default function WarehouseListingsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["warehouse", "listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_listings")
        .select("id, name, warehouse_type, city, status, storage_rate_per_pallet, available_pallet_capacity, storage_term, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ListingRow[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("warehouse_listings")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouse", "listings"] }),
  });

  const cols: Column<ListingRow>[] = [
    {
      key: "name",
      header: "Listing name",
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground">{r.warehouse_type} · {r.city ?? "—"}</div>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.name,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>,
      sortable: true,
      sortValue: (r) => r.status,
    },
    {
      key: "capacity",
      header: "Capacity",
      render: (r) => r.available_pallet_capacity != null ? `${r.available_pallet_capacity} pallets` : "—",
    },
    {
      key: "rate",
      header: "Rate / pallet",
      render: (r) =>
        r.storage_rate_per_pallet != null
          ? `$${Number(r.storage_rate_per_pallet).toFixed(2)} / ${r.storage_term ?? "mo"}`
          : "—",
    },
    {
      key: "created",
      header: "Created",
      render: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>,
      sortable: true,
      sortValue: (r) => r.created_at,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Link href={`/warehouse/listings/${r.id}/edit`}>
            <Button size="sm" variant="outline">Edit</Button>
          </Link>
          {r.status === "Draft" && (
            <Button size="sm" variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: r.id, status: "PendingApproval" })}>
              Submit
            </Button>
          )}
          {(r.status === "Active" || r.status === "Available") && (
            <Button size="sm" variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: r.id, status: "Hidden" })}>
              Hide
            </Button>
          )}
          {r.status === "Hidden" && (
            <Button size="sm"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: r.id, status: "Active" })}>
              Activate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Warehouse listings</h1>
          <p className="text-sm text-muted-foreground">Manage your storage listings.</p>
        </div>
        <Link href="/warehouse/listings/new">
          <Button>+ New listing</Button>
        </Link>
      </div>

      {setStatus.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(setStatus.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your listings</CardTitle>
          <CardDescription>{q.data?.length ?? 0} total</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={q.data ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            isLoading={q.isLoading}
            error={q.error as Error | null}
            searchPlaceholder="Search listings…"
            filters={[
              { value: "active", label: "Active", predicate: (r) => r.status === "Active" || r.status === "Available" },
              { value: "draft", label: "Draft", predicate: (r) => r.status === "Draft" },
              { value: "pending", label: "Pending approval", predicate: (r) => r.status === "PendingApproval" },
              { value: "hidden", label: "Hidden", predicate: (r) => r.status === "Hidden" },
            ]}
            emptyMessage="No listings yet. Create your first listing."
          />
        </CardContent>
      </Card>
    </div>
  );
}
