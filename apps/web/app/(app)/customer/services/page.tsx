"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

interface ServiceListing {
  id: string;
  category: string;
  coverage_area: string[];
  hourly_rate: number;
  per_job_rate: number | null;
  minimum_hours: number;
  certifications: string | null;
  status: string;
  company_name?: string | null;
}

interface ServiceJob {
  id: string;
  service_id: string;
  status: string;
  location_city: string | null;
  date_time_start: string | null;
  duration_hours: number | null;
  total_price: number | null;
  payment_status: string;
  notes: string | null;
  check_in_ts: string | null;
  check_out_ts: string | null;
  created_at: string;
  service_category?: string | null;
  company_name?: string | null;
}

const CAT_LABEL: Record<string, string> = {
  Labour: "General Labour",
  Forklift: "Forklift Op.",
  PalletRework: "Pallet Rework",
  Devanning: "Devanning",
  LocalTruck: "Local Truck",
  IndustrialCleaning: "Industrial Cleaning",
};

const CAT_COLOR: Record<string, string> = {
  Labour: "bg-slate-100 text-slate-800",
  Forklift: "bg-amber-100 text-amber-800",
  PalletRework: "bg-orange-100 text-orange-800",
  Devanning: "bg-blue-100 text-blue-800",
  LocalTruck: "bg-cyan-100 text-cyan-800",
  IndustrialCleaning: "bg-green-100 text-green-800",
};

const JOB_STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  Completed: "success",
  InProgress: "success",
  Scheduled: "warning",
  Accepted: "warning",
  Requested: "secondary",
  Cancelled: "destructive",
};

export default function CustomerServicesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"browse" | "jobs">("browse");
  const [booking, setBooking] = useState<ServiceListing | null>(null);
  const [form, setForm] = useState({ date_time: "", duration: 4, city: "Vancouver", address: "", notes: "" });

  const listingsQ = useQuery({
    queryKey: ["customer", "service-listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_listings")
        .select("id, category, coverage_area, hourly_rate, per_job_rate, minimum_hours, certifications, status, companies!inner(name)")
        .in("status", ["Active", "Available"])
        .order("category");
      if (error) throw error;
      return (data ?? []).map((l: any) => ({ ...l, company_name: l.companies?.name ?? null })) as ServiceListing[];
    },
  });

  const jobsQ = useQuery({
    queryKey: ["customer", "service-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_jobs")
        .select(`id, service_id, status, location_city, date_time_start, duration_hours, total_price, payment_status, notes, check_in_ts, check_out_ts, created_at,
          service_listings!inner(category, companies!inner(name))`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((j: any) => ({
        ...j,
        service_category: j.service_listings?.category ?? null,
        company_name: j.service_listings?.companies?.name ?? null,
      })) as ServiceJob[];
    },
  });

  const requestJob = useMutation({
    mutationFn: async () => {
      if (!booking) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: cu } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();
      if (!cu?.company_id) throw new Error("No company associated. Complete onboarding first.");
      const companyId = cu.company_id;
      const totalPrice = Number(booking.hourly_rate) * form.duration;
      const { error } = await supabase.from("service_jobs").insert({
        service_id: booking.id,
        customer_company_id: companyId,
        location_city: form.city.trim(),
        location_address: form.address.trim(),
        date_time_start: new Date(form.date_time).toISOString(),
        duration_hours: form.duration,
        notes: form.notes.trim(),
        total_price: totalPrice,
        status: "Requested",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer", "service-jobs"] }); setBooking(null); setTab("jobs"); },
  });

  const jobCols: Column<ServiceJob>[] = [
    { key: "service", header: "Service", render: (j) => (
        <div><div className="font-medium">{j.company_name ?? "—"}</div><div className="text-xs text-muted-foreground">{CAT_LABEL[j.service_category ?? ""] ?? j.service_category ?? "—"}</div></div>
    ), sortable: true, sortValue: (j) => j.company_name },
    { key: "status", header: "Status", render: (j) => <Badge variant={JOB_STATUS_VARIANT[j.status] ?? "secondary"}>{j.status}</Badge>, sortable: true, sortValue: (j) => j.status },
    { key: "when", header: "Scheduled", render: (j) => j.date_time_start ? new Date(j.date_time_start).toLocaleString("en-CA", { dateStyle: "short", timeStyle: "short" }) : "—" },
    { key: "duration", header: "Hours", render: (j) => j.duration_hours ?? "—" },
    { key: "price", header: "Total", render: (j) => j.total_price != null ? `$${Number(j.total_price).toFixed(2)}` : "—" },
    { key: "payment", header: "Payment", render: (j) => <Badge variant={j.payment_status === "Paid" ? "success" : "secondary"}>{j.payment_status}</Badge> },
    { key: "created", header: "Requested", render: (j) => <span className="text-xs text-muted-foreground">{formatDate(j.created_at)}</span>, sortable: true, sortValue: (j) => j.created_at },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
        <p className="text-sm text-muted-foreground">Book labour, forklift, and logistics services for your warehouse needs.</p>
      </div>

      <div className="flex gap-1 border-b">
        {(["browse", "jobs"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t === "browse" ? "Browse services" : "My jobs"}
          </button>
        ))}
      </div>

      {tab === "browse" && (
        <>
          {listingsQ.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(listingsQ.data ?? []).map((l) => (
                <Card key={l.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div><CardTitle className="text-base">{l.company_name}</CardTitle>
                        <CardDescription className="mt-0.5">{l.coverage_area?.slice(0,3).join(", ") || "—"}</CardDescription></div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CAT_COLOR[l.category] ?? "bg-muted text-muted-foreground"}`}>{CAT_LABEL[l.category] ?? l.category}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-2">
                    <div className="text-sm font-medium">${Number(l.hourly_rate).toFixed(2)}/hr · min {l.minimum_hours}h</div>
                    {l.per_job_rate && <div className="text-sm text-muted-foreground">or ${Number(l.per_job_rate).toFixed(2)} flat</div>}
                    {l.certifications && <div className="text-xs text-muted-foreground">{l.certifications}</div>}
                    <div className="mt-auto">
                      <Button size="sm" className="w-full" onClick={() => { setBooking(l); setForm({ date_time: "", duration: Math.max(l.minimum_hours, 1), city: "Vancouver", address: "", notes: "" }); }}>
                        Book now
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {(listingsQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground col-span-3">No services available right now.</p>}
            </div>
          }
        </>
      )}

      {tab === "jobs" && (
        <Card>
          <CardHeader><CardTitle>My service jobs</CardTitle><CardDescription>{jobsQ.data?.length ?? 0} total</CardDescription></CardHeader>
          <CardContent>
            <DataTable rows={jobsQ.data ?? []} columns={jobCols} rowKey={(j) => j.id} isLoading={jobsQ.isLoading} error={jobsQ.error as Error | null}
              searchPlaceholder="Search service or company…"
              filters={[
                { value: "active", label: "Active", predicate: (j) => ["Requested","Accepted","Scheduled","InProgress"].includes(j.status) },
                { value: "completed", label: "Completed", predicate: (j) => j.status === "Completed" },
              ]} emptyMessage="No service jobs yet." />
          </CardContent>
        </Card>
      )}

      {/* Booking modal */}
      {booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBooking(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div><h2 className="text-lg font-semibold">{CAT_LABEL[booking.category] ?? booking.category}</h2>
                <p className="text-sm text-muted-foreground">{booking.company_name} · ${Number(booking.hourly_rate).toFixed(2)}/hr</p></div>
              <Button variant="ghost" size="sm" onClick={() => setBooking(null)}>✕</Button>
            </div>
            {requestJob.error && <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{(requestJob.error as Error).message}</div>}
            <div className="space-y-4">
              <div className="space-y-1.5"><Label>Date &amp; time *</Label><Input type="datetime-local" value={form.date_time} onChange={(e) => setForm(f => ({ ...f, date_time: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Duration (hours) *</Label><Input type="number" min={booking.minimum_hours} step={0.5} value={form.duration} onChange={(e) => setForm(f => ({ ...f, duration: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>City</Label><Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Notes</Label><textarea rows={2} value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></div>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex justify-between">
                <span className="text-muted-foreground">Estimated total</span>
                <span className="font-medium">${(Number(booking.hourly_rate) * form.duration).toFixed(2)}</span>
              </div>
              <Button className="w-full" disabled={!form.date_time || requestJob.isPending} onClick={() => requestJob.mutate()}>
                {requestJob.isPending ? "Requesting…" : "Request service"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
