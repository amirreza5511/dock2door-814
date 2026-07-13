"use client";

import { useMemo, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Clock, Camera, FileText } from "lucide-react";
import { subcategoryLabel, serviceTypeLabel, isInsuranceType, type ServiceType } from "@/lib/serviceMarketplace";

const COMMISSION_RATE = 0.08;

const STATUS_BADGE: Record<string, "success" | "warning" | "secondary" | "outline"> = {
  Requested: "warning",
  Accepted: "outline",
  Scheduled: "outline",
  InProgress: "outline",
  Completed: "success",
  Cancelled: "secondary",
};

const QUOTE_LABEL: Record<string, string> = {
  none: "Direct request",
  requested: "Quote requested",
  quoted: "Quote sent",
  accepted: "Quote accepted",
  declined: "Quote declined",
};

interface JobRow {
  id: string;
  service_id: string;
  customer_company_id: string;
  provider_company_id: string | null;
  location_address: string | null;
  location_city: string | null;
  date_time_start: string | null;
  duration_hours: number | null;
  notes: string | null;
  total_price: number | null;
  status: string;
  quote_status: string | null;
  quoted_amount: number | null;
  quote_notes: string | null;
  cargo_value: number | null;
  invoice_id: string | null;
  service_listings: { service_type: ServiceType; title: string | null; subcategory: string | null; company: { name: string | null } | null } | null;
  customer: { name: string | null } | null;
}

interface Photo { id: string; url: string; kind: string | null; }
interface InvoiceLine { id: string; description: string; line_total: number | null; }
interface Invoice { id: string; invoice_number: string; subtotal_amount: number | null; tax_amount: number | null; commission_amount: number | null; total_amount: number | null; currency: string | null; status: string; }

export default function MarketplaceOrderPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const fileRef = useRef<HTMLInputElement>(null);

  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [uploading, setUploading] = useState(false);

  const meQ = useQuery({
    queryKey: ["me", "company"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      return (data?.company_id as string | undefined) ?? null;
    },
  });

  const jobQ = useQuery({
    queryKey: ["marketplace", "order", jobId],
    queryFn: async () => {
      const select =
        "id, service_id, customer_company_id, provider_company_id, location_address, location_city, date_time_start, duration_hours, notes, total_price, status, quote_status, quoted_amount, quote_notes, cargo_value, invoice_id, " +
        "service_listings:service_listings!service_jobs_service_id_fkey(service_type, title, subcategory, company:companies(name)), " +
        "customer:companies!service_jobs_customer_company_id_fkey(name)";
      const { data, error } = await supabase.from("service_jobs").select(select).eq("id", jobId).single();
      if (error) throw error;
      return data as unknown as JobRow;
    },
  });

  const photosQ = useQuery({
    queryKey: ["marketplace", "order", jobId, "photos"],
    queryFn: async () => {
      const { data } = await supabase.from("service_job_photos").select("id,url,kind").eq("job_id", jobId).order("created_at", { ascending: true });
      return (data ?? []) as Photo[];
    },
  });

  const job = jobQ.data;
  const invoiceQ = useQuery({
    queryKey: ["marketplace", "order", jobId, "invoice", job?.invoice_id],
    enabled: !!job?.invoice_id,
    queryFn: async () => {
      const [{ data: inv }, { data: lines }] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", job!.invoice_id!).single(),
        supabase.from("invoice_lines").select("id,description,line_total").eq("invoice_id", job!.invoice_id!).order("sort_order", { ascending: true }),
      ]);
      return { invoice: inv as Invoice, lines: (lines ?? []) as InvoiceLine[] };
    },
  });

  const myCompany = meQ.data ?? null;
  const isProvider = !!myCompany && myCompany === job?.provider_company_id;
  const isCustomer = !!myCompany && myCompany === job?.customer_company_id;
  const insurance = job?.service_listings ? isInsuranceType(job.service_listings.service_type) : false;
  const quoteStatus = job?.quote_status ?? "none";
  const quotedAmount = job?.quoted_amount ?? null;
  const commission = quotedAmount != null ? Math.round(quotedAmount * COMMISSION_RATE * 100) / 100 : 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["marketplace", "order", jobId] });
  };

  const sendQuote = useMutation({
    mutationFn: async () => {
      const amt = Number(quoteAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid quote amount.");
      const { error } = await supabase.rpc("send_service_quote", {
        p_job_id: jobId, p_amount: amt, p_notes: quoteNote, p_commission_rate: COMMISSION_RATE,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const respondQuote = useMutation({
    mutationFn: async (accept: boolean) => {
      const { error } = await supabase.rpc("respond_service_quote", { p_job_id: jobId, p_accept: accept });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const transition = useMutation({
    mutationFn: async (next: "Accepted" | "InProgress" | "Completed") => {
      const { error } = await supabase.rpc("transition_service_job", {
        p_job_id: jobId, p_next_status: next, p_reason: null,
        p_check_in: next === "InProgress", p_check_out: next === "Completed",
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const generateInvoice = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("invoice_service_job", { p_job_id: jobId, p_tax_rate: 0, p_commission_rate: COMMISSION_RATE });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("provider_set_invoice_status", { p_invoice_id: job!.invoice_id!, p_status: "Paid", p_method: "manual" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketplace", "order", jobId, "invoice"] }),
  });

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      const path = `${jobId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("job-photos").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("job-photos").getPublicUrl(path);
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("service_job_photos").insert({ job_id: jobId, url: pub.publicUrl, kind: "progress", uploaded_by: user?.id ?? null });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["marketplace", "order", jobId, "photos"] });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const photos = useMemo(() => photosQ.data ?? [], [photosQ.data]);

  if (jobQ.isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Loading order…</p>;
  if (jobQ.isError || !job) return <p className="py-16 text-center text-sm text-muted-foreground">Order not found.</p>;

  const title = job.service_listings?.title || subcategoryLabel(job.service_listings?.subcategory) || "Marketplace order";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {job.service_listings ? serviceTypeLabel(job.service_listings.service_type) : "Order"} · {isProvider ? "Incoming" : "Your request"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="warning">{QUOTE_LABEL[quoteStatus] ?? quoteStatus}</Badge>
          <Badge variant={STATUS_BADGE[job.status] ?? "secondary"}>{job.status}</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5"><Building2 className="h-4 w-4" /> {isProvider ? `Customer: ${job.customer?.name ?? "Customer"}` : `Provider: ${job.service_listings?.company?.name ?? "Provider"}`}</div>
          {(job.location_city || job.location_address) && (
            <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {[job.location_address, job.location_city].filter(Boolean).join(", ")}</div>
          )}
          <div className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {job.date_time_start ? new Date(job.date_time_start).toLocaleString() : "—"}{insurance ? "" : ` · ${job.duration_hours ?? 0}h`}</div>
          {insurance && job.cargo_value ? <div>Declared cargo value: ${job.cargo_value.toLocaleString()}</div> : null}
          {job.notes ? <p className="pt-1 text-foreground">{job.notes}</p> : null}
        </CardContent>
      </Card>

      {/* Quote */}
      {quoteStatus === "requested" && isProvider && (
        <Card>
          <CardHeader><CardTitle>Send an official quote</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5"><Label>Quote amount ($)</Label><Input type="number" min={0} value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value)} placeholder="1200" /></div>
            <div className="space-y-1.5"><Label>Note to customer</Label><Textarea value={quoteNote} onChange={(e) => setQuoteNote(e.target.value)} rows={2} placeholder="Includes delivery & operator" /></div>
            {Number(quoteAmount) > 0 && <p className="text-xs text-muted-foreground">Platform commission ({Math.round(COMMISSION_RATE * 100)}%): ${(Number(quoteAmount) * COMMISSION_RATE).toFixed(2)}</p>}
            <div className="flex gap-2">
              <Button disabled={sendQuote.isPending} onClick={() => sendQuote.mutate()}>{sendQuote.isPending ? "Sending…" : "Send quote"}</Button>
              <Button variant="secondary" disabled={respondQuote.isPending} onClick={() => respondQuote.mutate(false)}>Decline request</Button>
            </div>
            {sendQuote.error && <p className="text-sm text-red-600">{(sendQuote.error as Error).message}</p>}
          </CardContent>
        </Card>
      )}

      {quoteStatus === "requested" && isCustomer && (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">The provider is reviewing your request and will send an official price shortly.</CardContent></Card>
      )}

      {(quoteStatus === "quoted" || quoteStatus === "accepted") && quotedAmount != null && (
        <Card>
          <CardHeader><CardTitle>Official quote</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold text-emerald-500">${quotedAmount.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground">incl. ${commission.toFixed(2)} platform fee</span>
            </div>
            {job.quote_notes ? <p className="text-sm">{job.quote_notes}</p> : null}
            {quoteStatus === "quoted" && isCustomer && (
              <div className="flex gap-2">
                <Button disabled={respondQuote.isPending} onClick={() => respondQuote.mutate(true)}>Accept</Button>
                <Button variant="secondary" disabled={respondQuote.isPending} onClick={() => respondQuote.mutate(false)}>Decline</Button>
              </div>
            )}
            {quoteStatus === "quoted" && isProvider && <p className="text-sm text-muted-foreground">Waiting for the customer to accept your quote.</p>}
            {quoteStatus === "accepted" && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Quote accepted{isProvider ? " — progress the job below." : " — the provider will start the work."}</p>}
          </CardContent>
        </Card>
      )}

      {/* Provider progress */}
      {isProvider && quoteStatus !== "requested" && quoteStatus !== "declined" && job.status !== "Cancelled" && (
        <Card>
          <CardHeader><CardTitle>Job progress</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {job.status === "Requested" && quoteStatus === "accepted" && <Button disabled={transition.isPending} onClick={() => transition.mutate("Accepted")}>Accept & schedule</Button>}
            {(job.status === "Accepted" || job.status === "Scheduled") && <Button disabled={transition.isPending} onClick={() => transition.mutate("InProgress")}>Start work (check in)</Button>}
            {job.status === "InProgress" && <Button disabled={transition.isPending} onClick={() => transition.mutate("Completed")}>Mark completed</Button>}
            {transition.error && <p className="text-sm text-red-600">{(transition.error as Error).message}</p>}
          </CardContent>
        </Card>
      )}

      {/* Photos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Job photos</CardTitle>
          {(isProvider || isCustomer) && (
            <>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
              <Button variant="secondary" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Camera className="mr-1 h-4 w-4" /> {uploading ? "Uploading…" : "Add"}
              </Button>
            </>
          )}
        </CardHeader>
        <CardContent>
          {photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos yet. Capture before/after evidence here.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {photos.map((p) => (
                <div key={p.id} className="w-28">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.kind ?? "job photo"} className="h-28 w-28 rounded-lg object-cover" />
                  {p.kind && <p className="mt-1 text-xs capitalize text-muted-foreground">{p.kind}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoice */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Invoice</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {job.invoice_id && invoiceQ.data ? (
            <>
              <div className="flex items-center justify-between">
                <span className="font-medium">{invoiceQ.data.invoice.invoice_number}</span>
                <Badge variant={invoiceQ.data.invoice.status === "Paid" ? "success" : "warning"}>{invoiceQ.data.invoice.status}</Badge>
              </div>
              {invoiceQ.data.lines.map((ln) => (
                <div key={ln.id} className="flex justify-between border-b border-border py-1.5 text-sm">
                  <span className="text-muted-foreground">{ln.description}</span>
                  <span>${Number(ln.line_total ?? 0).toFixed(2)}</span>
                </div>
              ))}
              <div className="space-y-1 pt-1 text-sm">
                <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>${Number(invoiceQ.data.invoice.subtotal_amount ?? 0).toFixed(2)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>${Number(invoiceQ.data.invoice.tax_amount ?? 0).toFixed(2)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Platform commission</span><span>${Number(invoiceQ.data.invoice.commission_amount ?? 0).toFixed(2)}</span></div>
                <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold"><span>Total</span><span className="text-emerald-500">${Number(invoiceQ.data.invoice.total_amount ?? 0).toFixed(2)} {invoiceQ.data.invoice.currency ?? "CAD"}</span></div>
              </div>
              {isProvider && invoiceQ.data.invoice.status !== "Paid" && (
                <Button disabled={markPaid.isPending} onClick={() => markPaid.mutate()}>{markPaid.isPending ? "Saving…" : "Mark as paid"}</Button>
              )}
            </>
          ) : isProvider && job.status === "Completed" ? (
            <Button disabled={generateInvoice.isPending} onClick={() => generateInvoice.mutate()}>{generateInvoice.isPending ? "Generating…" : "Generate invoice"}</Button>
          ) : (
            <p className="text-sm text-muted-foreground">{job.status === "Completed" ? "The provider will issue an invoice for this job." : "An invoice can be issued once the job is completed."}</p>
          )}
          {generateInvoice.error && <p className="text-sm text-red-600">{(generateInvoice.error as Error).message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
