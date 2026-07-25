"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { useExplore, useActionGuard } from "@/lib/explore-store";

interface ListingRow {
  id: string;
  category: string;
  coverage_area: string[];
  hourly_rate: number;
  per_job_rate: number | null;
  minimum_hours: number;
  certifications: string | null;
  status: string;
  created_at: string;
}

const CAT_LABEL: Record<string, string> = {
  Labour: "General Labour",
  Forklift: "Forklift Op.",
  PalletRework: "Pallet Rework",
  Devanning: "Devanning",
  LocalTruck: "Local Truck",
  IndustrialCleaning: "Industrial Cleaning",
};

const SAMPLE_LISTINGS: ListingRow[] = [
  { id: "ex-spl-1", category: "Forklift", coverage_area: ["Vancouver", "Burnaby", "Richmond"], hourly_rate: 68, per_job_rate: null, minimum_hours: 3, certifications: "Forklift cert", status: "Available", created_at: new Date(Date.now() - 86400000 * 30).toISOString() },
  { id: "ex-spl-2", category: "Devanning", coverage_area: ["Delta", "Surrey"], hourly_rate: 52, per_job_rate: 480, minimum_hours: 4, certifications: null, status: "Available", created_at: new Date(Date.now() - 86400000 * 18).toISOString() },
  { id: "ex-spl-3", category: "IndustrialCleaning", coverage_area: ["Vancouver"], hourly_rate: 45, per_job_rate: null, minimum_hours: 2, certifications: "WHMIS", status: "PendingApproval", created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
  { id: "ex-spl-4", category: "PalletRework", coverage_area: ["Langley"], hourly_rate: 48, per_job_rate: null, minimum_hours: 2, certifications: null, status: "Draft", created_at: new Date(Date.now() - 86400000).toISOString() },
];

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  Active: "success",
  Available: "success",
  PendingApproval: "warning",
  Draft: "secondary",
  Hidden: "secondary",
  Suspended: "destructive",
};

export default function ServiceProviderListingsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const [editing, setEditing] = useState<ListingRow | null>(null);
  const [form, setForm] = useState({ hourly_rate: 0, per_job_rate: 0, minimum_hours: 1, certifications: "" });

  const listingsQ = useQuery({
    queryKey: ["service-provider", "listings"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_listings")
        .select("id, category, coverage_area, hourly_rate, per_job_rate, minimum_hours, certifications, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ListingRow[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["service-provider", "listings"] });

  /**
   * Submit Draft/Rejected listing for admin review → PendingApproval.
   * Routes through provider_submit_service_listing RPC (0051) — audited, state-machine enforced.
   */
  const submitM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("provider_submit_service_listing", { p_listing_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  /**
   * Withdraw PendingApproval listing back to Draft.
   * Routes through provider_withdraw_service_listing RPC (0051) — audited, state-machine enforced.
   */
  const withdrawM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("provider_withdraw_service_listing", { p_listing_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  /**
   * Hide an Available/Active listing.
   * Routes through provider_hide_service_listing RPC (0055) — audited.
   * Provider cannot self-approve; only admins can set Available via admin_set_service_listing_status.
   */
  const hideM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("provider_hide_service_listing", { p_listing_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  /**
   * Unhide a Hidden listing → Available.
   * Routes through provider_unhide_service_listing RPC (0055) — audited.
   */
  const unhideM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("provider_unhide_service_listing", { p_listing_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const updateRates = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("service_listings")
        .update({
          hourly_rate: form.hourly_rate,
          per_job_rate: form.per_job_rate || null,
          minimum_hours: form.minimum_hours,
          certifications: form.certifications.trim() || null,
        })
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  // Aggregate any mutation error for display under the table
  const mutationError =
    submitM.error ?? withdrawM.error ?? hideM.error ?? unhideM.error;
  const mutationPending =
    submitM.isPending || withdrawM.isPending || hideM.isPending || unhideM.isPending;

  const cols: Column<ListingRow>[] = [
    {
      key: "service",
      header: "Service",
      render: (l) => (
        <div>
          <div className="font-medium">{CAT_LABEL[l.category] ?? l.category}</div>
          <div className="text-xs text-muted-foreground">{l.coverage_area?.slice(0, 3).join(", ") || "—"}</div>
        </div>
      ),
      sortable: true,
      sortValue: (l) => l.category,
    },
    {
      key: "status",
      header: "Status",
      render: (l) => <Badge variant={STATUS_VARIANT[l.status] ?? "secondary"}>{l.status}</Badge>,
      sortable: true,
      sortValue: (l) => l.status,
    },
    {
      key: "rate",
      header: "Rate",
      render: (l) => (
        <div>
          <div>${Number(l.hourly_rate).toFixed(2)}/hr · min {l.minimum_hours}h</div>
          {l.per_job_rate && <div className="text-xs text-muted-foreground">${Number(l.per_job_rate).toFixed(2)} flat</div>}
        </div>
      ),
    },
    {
      key: "certs",
      header: "Certifications",
      render: (l) => l.certifications ?? "—",
    },
    {
      key: "created",
      header: "Created",
      render: (l) => <span className="text-xs text-muted-foreground">{formatDate(l.created_at)}</span>,
      sortable: true,
      sortValue: (l) => l.created_at,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (l) => (
        <div className="flex justify-end gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!guard("Edit listing rates")) return;
              setEditing(l);
              setForm({ hourly_rate: Number(l.hourly_rate), per_job_rate: Number(l.per_job_rate ?? 0), minimum_hours: l.minimum_hours, certifications: l.certifications ?? "" });
            }}>
            Edit rates
          </Button>

          {/* Draft / Rejected → PendingApproval (via provider_submit_service_listing) */}
          {(l.status === "Draft" || l.status === "Rejected") && (
            <Button size="sm" variant="secondary" disabled={mutationPending}
              onClick={() => { if (!guard("Submit a listing for review")) return; submitM.mutate(l.id); }}>
              Submit for review
            </Button>
          )}

          {/* PendingApproval → Draft (via provider_withdraw_service_listing) */}
          {l.status === "PendingApproval" && (
            <Button size="sm" variant="outline" disabled={mutationPending}
              onClick={() => { if (!guard("Withdraw a listing")) return; withdrawM.mutate(l.id); }}>
              Withdraw
            </Button>
          )}

          {/* Available / Active → Hidden (via provider_hide_service_listing) */}
          {(l.status === "Available" || l.status === "Active") && (
            <Button size="sm" variant="secondary" disabled={mutationPending}
              onClick={() => { if (!guard("Hide a listing")) return; hideM.mutate(l.id); }}>
              Hide
            </Button>
          )}

          {/* Hidden → Available (via provider_unhide_service_listing) */}
          {l.status === "Hidden" && (
            <Button size="sm" disabled={mutationPending}
              onClick={() => { if (!guard("Unhide a listing")) return; unhideM.mutate(l.id); }}>
              Unhide
            </Button>
          )}

          {/* Suspended — provider cannot self-unsuspend; must contact admin */}
          {l.status === "Suspended" && (
            <span className="text-xs text-muted-foreground italic">Contact admin to reinstate</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service listings</h1>
          <p className="text-sm text-muted-foreground">Manage your service offerings.</p>
        </div>
        <Link href="/service-provider/create-listing">
          <Button>+ New listing</Button>
        </Link>
      </div>

      {mutationError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {(mutationError as Error).message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your listings</CardTitle>
          <CardDescription>
            {(isExploring ? SAMPLE_LISTINGS : listingsQ.data ?? []).length} total · Listings must be approved by an admin before becoming visible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={isExploring ? SAMPLE_LISTINGS : (listingsQ.data ?? [])}
            columns={cols}
            rowKey={(l) => l.id}
            isLoading={!isExploring && listingsQ.isLoading}
            error={isExploring ? null : (listingsQ.error as Error | null)}
            searchPlaceholder="Search listings…"
            filters={[
              { value: "active", label: "Active", predicate: (l) => l.status === "Active" || l.status === "Available" },
              { value: "draft", label: "Draft", predicate: (l) => l.status === "Draft" },
              { value: "pending", label: "Pending", predicate: (l) => l.status === "PendingApproval" },
              { value: "hidden", label: "Hidden", predicate: (l) => l.status === "Hidden" },
            ]}
            emptyMessage="No listings yet."
          />
        </CardContent>
      </Card>

      {/* Edit rates modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold">Edit rates — {CAT_LABEL[editing.category] ?? editing.category}</h2>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>✕</Button>
            </div>
            {updateRates.error && (
              <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {(updateRates.error as Error).message}
              </div>
            )}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Hourly rate ($)</label>
                <input type="number" min={0} step={0.5} value={form.hourly_rate}
                  onChange={(e) => setForm(f => ({ ...f, hourly_rate: Number(e.target.value) }))}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Flat per-job rate ($, optional)</label>
                <input type="number" min={0} step={5} value={form.per_job_rate}
                  onChange={(e) => setForm(f => ({ ...f, per_job_rate: Number(e.target.value) }))}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Minimum hours</label>
                <input type="number" min={1} value={form.minimum_hours}
                  onChange={(e) => setForm(f => ({ ...f, minimum_hours: Number(e.target.value) }))}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Certifications</label>
                <input value={form.certifications}
                  onChange={(e) => setForm(f => ({ ...f, certifications: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                  placeholder="e.g. Forklift cert required" />
              </div>
              <Button className="w-full" disabled={updateRates.isPending} onClick={() => updateRates.mutate()}>
                {updateRates.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
