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

const spDate = (h: number): string => new Date(Date.now() + h * 3600e3).toISOString();
const SAMPLE_SP_JOBS: ServiceJob[] = [
  { id: "ex-spj-1", service_id: "ex-sl-2", status: "Requested", location_city: "Burnaby", location_address: "20 Port Rd", date_time_start: spDate(3), duration_hours: 3, total_price: 435, payment_status: "Pending", notes: "Reefer unit throwing an alarm.", check_in_ts: null, check_out_ts: null, customer_confirmed: false, created_at: spDate(-4), service_category: "IndustrialCleaning", customer_company: "Harbour Freight Ltd." },
  { id: "ex-spj-2", service_id: "ex-sl-2", status: "Scheduled", location_city: "Vancouver", location_address: "120 Industrial Ave", date_time_start: spDate(26), duration_hours: 4, total_price: 620, payment_status: "Held", notes: null, check_in_ts: null, check_out_ts: null, customer_confirmed: false, created_at: spDate(-26), service_category: "Forklift", customer_company: "Preview Logistics Co." },
  { id: "ex-spj-3", status: "Completed", service_id: "ex-sl-2", location_city: "Delta", location_address: "9200 River Rd", date_time_start: spDate(-40), duration_hours: 2, total_price: 290, payment_status: "Paid", notes: null, check_in_ts: spDate(-40), check_out_ts: spDate(-38), customer_confirmed: true, created_at: spDate(-96), service_category: "Labour", customer_company: "Annacis Island Distribution" },
];

interface ServiceJob {
  id: string;
  service_id: string;
  status: string;
  location_city: string | null;
  location_address: string | null;
  date_time_start: string | null;
  duration_hours: number | null;
  total_price: number | null;
  payment_status: string;
  notes: string | null;
  check_in_ts: string | null;
  check_out_ts: string | null;
  customer_confirmed: boolean;
  created_at: string;
  service_category?: string | null;
  customer_company?: string | null;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive" | "default"> = {
  Completed: "success",
  InProgress: "success",
  Scheduled: "warning",
  Accepted: "warning",
  Requested: "secondary",
  Cancelled: "destructive",
};

const CAT_LABEL: Record<string, string> = {
  Labour: "General Labour",
  Forklift: "Forklift Op.",
  PalletRework: "Pallet Rework",
  Devanning: "Devanning",
  LocalTruck: "Local Truck",
  IndustrialCleaning: "Industrial Cleaning",
};

export default function ServiceProviderPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ServiceJob | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  const jobsQ = useQuery({
    queryKey: ["service-provider", "jobs"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_jobs")
        .select(`id, service_id, status, location_city, location_address, date_time_start, duration_hours,
          total_price, payment_status, notes, check_in_ts, check_out_ts, customer_confirmed, created_at,
          service_listings!inner(category, companies!inner(name))`)
        .order("date_time_start", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((j: any) => ({
        ...j,
        service_category: j.service_listings?.category ?? null,
        customer_company: j.service_listings?.companies?.name ?? null,
      })) as ServiceJob[];
    },
  });

  const jobs = isExploring ? SAMPLE_SP_JOBS : (jobsQ.data ?? []);

  const transition = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      if (isExploring) throw new Error("explore");
      const { error } = await supabase.rpc("transition_service_job", {
        p_job_id: id,
        p_new_status: status,
        p_reason: reason ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-provider", "jobs"] });
      setSelected(null);
    },
  });

  const stats = {
    pending: jobs.filter((j) => j.status === "Requested").length,
    active: jobs.filter((j) => ["Accepted","Scheduled","InProgress"].includes(j.status)).length,
    completed: jobs.filter((j) => j.status === "Completed").length,
    revenue: jobs.filter((j) => j.payment_status === "Paid").reduce((s, j) => s + Number(j.total_price ?? 0), 0),
  };

  const cols: Column<ServiceJob>[] = [
    {
      key: "service",
      header: "Service",
      render: (j) => (
        <div>
          <div className="font-medium">{CAT_LABEL[j.service_category ?? ""] ?? j.service_category ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{j.customer_company ?? "—"}</div>
        </div>
      ),
      sortable: true,
      sortValue: (j) => j.customer_company,
    },
    {
      key: "status",
      header: "Status",
      render: (j) => <Badge variant={STATUS_VARIANT[j.status] ?? "secondary"}>{j.status}</Badge>,
      sortable: true,
      sortValue: (j) => j.status,
    },
    {
      key: "when",
      header: "Scheduled",
      render: (j) => j.date_time_start
        ? new Date(j.date_time_start).toLocaleString("en-CA", { dateStyle: "short", timeStyle: "short" })
        : "—",
      sortable: true,
      sortValue: (j) => j.date_time_start,
    },
    {
      key: "location",
      header: "Location",
      render: (j) => j.location_city ?? "—",
    },
    {
      key: "duration",
      header: "Hours",
      render: (j) => j.duration_hours ?? "—",
    },
    {
      key: "price",
      header: "Total",
      render: (j) => j.total_price != null ? `$${Number(j.total_price).toFixed(2)}` : "—",
    },
    {
      key: "created",
      header: "Requested",
      render: (j) => <span className="text-xs text-muted-foreground">{formatDate(j.created_at)}</span>,
      sortable: true,
      sortValue: (j) => j.created_at,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (j) => <Button size="sm" variant="outline" onClick={() => setSelected(j)}>Manage</Button>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service jobs</h1>
          <p className="text-sm text-muted-foreground">Manage incoming service requests and active jobs.</p>
        </div>
        <Link href="/service-provider/listings">
          <Button variant="outline">Manage listings</Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Pending requests", value: stats.pending },
          { label: "Active jobs", value: stats.active },
          { label: "Completed", value: stats.completed },
          { label: "Revenue collected", value: `$${stats.revenue.toFixed(2)}` },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All jobs</CardTitle>
          <CardDescription>{jobs.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={jobs}
            columns={cols}
            rowKey={(j) => j.id}
            isLoading={!isExploring && jobsQ.isLoading}
            error={jobsQ.error as Error | null}
            searchPlaceholder="Search customer or service…"
            filters={[
              { value: "pending", label: "Pending", predicate: (j) => j.status === "Requested" },
              { value: "active", label: "Active", predicate: (j) => ["Accepted","Scheduled","InProgress"].includes(j.status) },
              { value: "completed", label: "Completed", predicate: (j) => j.status === "Completed" },
              { value: "cancelled", label: "Cancelled", predicate: (j) => j.status === "Cancelled" },
            ]}
            emptyMessage="No jobs yet."
          />
        </CardContent>
      </Card>

      {/* Job management modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{CAT_LABEL[selected.service_category ?? ""] ?? selected.service_category}</h2>
                <p className="text-sm text-muted-foreground">{selected.customer_company} · {selected.location_city}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setDeclineReason(""); }}>✕</Button>
            </div>

            {transition.error && (
              <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {(transition.error as Error).message}
              </div>
            )}

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Status</div>
                  <Badge variant={STATUS_VARIANT[selected.status] ?? "secondary"}>{selected.status}</Badge>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Payment</div>
                  <Badge variant={selected.payment_status === "Paid" ? "success" : "secondary"}>{selected.payment_status}</Badge>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Scheduled</div>
                  <div>{selected.date_time_start ? new Date(selected.date_time_start).toLocaleString("en-CA") : "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Duration</div>
                  <div>{selected.duration_hours ?? "—"} hours</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Total</div>
                  <div className="font-medium">{selected.total_price != null ? `$${Number(selected.total_price).toFixed(2)}` : "—"}</div>
                </div>
                {selected.check_in_ts && (
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Checked in</div>
                    <div>{new Date(selected.check_in_ts).toLocaleTimeString()}</div>
                  </div>
                )}
              </div>

              {selected.notes && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Notes</div>
                  <p>{selected.notes}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {selected.status === "Requested" && (
                  <>
                    <Button className="flex-1" disabled={transition.isPending}
                      onClick={() => { if (guard("Accept this job")) transition.mutate({ id: selected.id, status: "Accepted" }); }}>Accept</Button>
                    <Button variant="destructive" className="flex-1" disabled={transition.isPending}
                      onClick={() => setDeclineReason(declineReason === "__open__" ? "" : "__open__")}>Decline</Button>
                  </>
                )}
                {selected.status === "Requested" && declineReason === "__open__" && (
                  <div className="w-full rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
                    <p className="text-xs font-medium text-red-700">Reason for declining *</p>
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                        placeholder="e.g. not available on that date…"
                        value={declineReason === "__open__" ? "" : declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                      />
                      <button
                        className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        disabled={!declineReason || declineReason === "__open__" || transition.isPending}
                        onClick={() => {
                          if (!declineReason || declineReason === "__open__") return;
                          transition.mutate({ id: selected.id, status: "Cancelled", reason: declineReason });
                          setDeclineReason("");
                        }}
                      >Confirm</button>
                      <button className="rounded border border-border px-3 py-1.5 text-xs" onClick={() => setDeclineReason("")}>✕</button>
                    </div>
                  </div>
                )}
                {selected.status === "Accepted" && (
                  <Button className="flex-1" disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: selected.id, status: "Scheduled" })}>Mark Scheduled</Button>
                )}
                {selected.status === "Scheduled" && (
                  <Button className="flex-1" disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: selected.id, status: "InProgress" })}>Check in / Start</Button>
                )}
                {selected.status === "InProgress" && (
                  <Button className="flex-1" disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: selected.id, status: "Completed" })}>Mark Completed</Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
