"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InvoiceRow {
  invoice_id: string;
  employer_company_id: string;
  invoice_number: string | null;
  status: string;
  subtotal_amount: number;
  total_amount: number;
  currency: string;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
}

interface CompanyBilling {
  id: string;
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address: string | null;
  billing_mode: string | null;
  payment_terms_days: number | null;
  billing_setup_completed_at: string | null;
}

export default function EmployerBillingPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);

  // Load active company (first active membership)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("company_users").select("company_id")
        .eq("user_id", user.id).eq("status", "Active").limit(1).maybeSingle();
      setCompanyId((data as { company_id: string } | null)?.company_id ?? null);
    })();
  }, [supabase]);

  const companyQ = useQuery({
    queryKey: ["employer", "company-billing", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyBilling | null> => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,billing_contact_name,billing_email,billing_phone,billing_address,billing_mode,payment_terms_days,billing_setup_completed_at")
        .eq("id", companyId!)
        .maybeSingle();
      if (error) throw error;
      return data as CompanyBilling | null;
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["employer", "invoices", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<InvoiceRow[]> => {
      const { data, error } = await supabase
        .from("employer_billing_overview")
        .select("*")
        .eq("employer_company_id", companyId!)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as InvoiceRow[];
    },
  });

  // Setup form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<"ManualInvoice" | "CardOnFile" | "StripeCheckout">("ManualInvoice");
  const [terms, setTerms] = useState("14");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!companyQ.data) return;
    setName(companyQ.data.billing_contact_name ?? "");
    setEmail(companyQ.data.billing_email ?? "");
    setPhone(companyQ.data.billing_phone ?? "");
    setAddress(companyQ.data.billing_address ?? "");
    setMode((companyQ.data.billing_mode as "ManualInvoice" | "CardOnFile" | "StripeCheckout") ?? "ManualInvoice");
    setTerms(String(companyQ.data.payment_terms_days ?? 14));
  }, [companyQ.data]);

  const saveSetup = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No company");
      if (name.trim().length < 2) throw new Error("Billing contact name required");
      if (!/.+@.+\..+/.test(email.trim())) throw new Error("Valid billing email required");
      const { error } = await supabase.rpc("company_update_billing", {
        p_company_id: companyId,
        p_contact_name: name.trim(),
        p_email: email.trim(),
        p_phone: phone.trim() || null,
        p_address: address.trim() || null,
        p_billing_mode: mode,
        p_payment_terms_days: Math.max(0, Math.min(90, Number(terms) || 14)),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employer", "company-billing", companyId] });
      setEditing(false);
    },
  });

  const payInvoice = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { invoice_id: invoiceId },
      });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("No checkout URL returned");
      window.open(url, "_blank");
    },
    onError: (e: unknown) => alert(e instanceof Error ? e.message : "Failed to start checkout"),
  });

  const setup = Boolean(companyQ.data?.billing_setup_completed_at);
  const invoices = invoicesQ.data ?? [];
  const unpaid = invoices.filter((i) => i.status !== "Paid" && i.status !== "Void");
  const unpaidTotal = unpaid.reduce((s, i) => s + i.total_amount, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing &amp; invoices</h1>
        <p className="text-sm text-muted-foreground">
          Set up billing so we can issue invoices for confirmed shift hours. Payment status is honest — only real payments show as Paid.
        </p>
      </div>

      {/* Setup status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Billing setup</CardTitle>
              <CardDescription>
                {setup ? "Configured — required for posting paid shifts." : "Not set up — required before posting paid shifts."}
              </CardDescription>
            </div>
            <Badge variant={setup ? "success" : "warning"}>{setup ? "Ready" : "Action needed"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!editing ? (
            <>
              {setup ? (
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><span className="text-muted-foreground">Contact: </span>{companyQ.data?.billing_contact_name}</div>
                  <div><span className="text-muted-foreground">Email: </span>{companyQ.data?.billing_email}</div>
                  <div><span className="text-muted-foreground">Phone: </span>{companyQ.data?.billing_phone ?? "—"}</div>
                  <div><span className="text-muted-foreground">Mode: </span>{companyQ.data?.billing_mode}</div>
                  <div><span className="text-muted-foreground">Terms: </span>Net {companyQ.data?.payment_terms_days ?? 14} days</div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No billing details on file.</p>
              )}
              <Button size="sm" variant={setup ? "outline" : "default"} onClick={() => setEditing(true)}>
                {setup ? "Edit billing details" : "Set up billing"}
              </Button>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs">Billing contact *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Billing email *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Billing address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mode</Label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "ManualInvoice" | "CardOnFile" | "StripeCheckout")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ManualInvoice">Manual invoice</option>
                  <option value="StripeCheckout">Stripe checkout</option>
                  <option value="CardOnFile">Card on file</option>
                </select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Payment terms (days)</Label><Input type="number" min={0} max={90} value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
              {saveSetup.error && <p className="col-span-full text-xs text-destructive">{(saveSetup.error as Error).message}</p>}
              <div className="col-span-full flex gap-2">
                <Button size="sm" disabled={saveSetup.isPending} onClick={() => saveSetup.mutate()}>{saveSetup.isPending ? "Saving…" : "Save"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Outstanding balance */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Outstanding balance</CardTitle>
              <CardDescription>{unpaid.length} unpaid invoice{unpaid.length === 1 ? "" : "s"}</CardDescription>
            </div>
            <span className={`text-2xl font-semibold ${unpaid.length > 0 ? "text-yellow-600" : "text-green-600"}`}>
              ${unpaidTotal.toFixed(2)}
            </span>
          </div>
        </CardHeader>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>Issued when you confirm worker hours after a shift.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoicesQ.isLoading ? (
            <p className="py-6 text-sm text-muted-foreground">Loading…</p>
          ) : invoices.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="space-y-2">
              {invoices.map((inv) => (
                <li key={inv.invoice_id} className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{inv.invoice_number ?? inv.invoice_id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.issued_at ? `Issued ${new Date(inv.issued_at).toLocaleDateString()}` : "Draft"}
                      {inv.due_date ? ` · Due ${inv.due_date}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">${inv.total_amount.toFixed(2)} {inv.currency}</span>
                    <Badge variant={inv.status === "Paid" ? "success" : inv.status === "Overdue" ? "destructive" : inv.status === "Void" ? "secondary" : "warning"}>
                      {inv.status}
                    </Badge>
                    {inv.status !== "Paid" && inv.status !== "Void" && companyQ.data?.billing_mode !== "ManualInvoice" && (
                      <Button size="sm" disabled={payInvoice.isPending} onClick={() => payInvoice.mutate(inv.invoice_id)}>
                        Pay
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {companyQ.data?.billing_mode === "ManualInvoice" && unpaid.length > 0 && (
            <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              You are on manual invoicing. Pay according to the invoice instructions; an admin will record receipt and mark it paid.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
