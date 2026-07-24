"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const SAMPLE_INVOICES: InvoiceRow[] = [
  { id: "ex-inv-1", invoice_number: "INV-20481", status: "Paid", total_amount: 3300, due_date: null, issued_at: new Date(Date.now() - 86400000 * 20).toISOString(), paid_at: new Date(Date.now() - 86400000 * 12).toISOString() },
  { id: "ex-inv-2", invoice_number: "INV-20502", status: "Issued", total_amount: 1044, due_date: new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10), issued_at: new Date(Date.now() - 86400000 * 4).toISOString(), paid_at: null },
  { id: "ex-inv-3", invoice_number: "INV-20460", status: "Overdue", total_amount: 2700, due_date: new Date(Date.now() - 86400000 * 4).toISOString().slice(0, 10), issued_at: new Date(Date.now() - 86400000 * 30).toISOString(), paid_at: null },
];
const SAMPLE_COMPANY: CompanyRow = { id: "explore-company", name: "Preview Logistics Co.", stripe_connect_account_id: null, stripe_connect_onboarded: false };

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string;
  total_amount: number | null;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
}

interface CompanyRow {
  id: string;
  name: string;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean | null;
}

function invoiceStatusVariant(s: string): "success" | "warning" | "destructive" | "secondary" | "default" {
  if (s === "Paid") return "success";
  if (s === "Overdue") return "destructive";
  if (s === "Issued") return "warning";
  if (s === "Voided") return "secondary";
  return "default";
}

export default function WarehouseBillingPage() {
  const supabase = getBrowserSupabase();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const [onboardLoading, setOnboardLoading] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);

  const companyQ = useQuery({
    queryKey: ["warehouse", "billing", "company"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: cu } = await supabase
        .from("company_users")
        .select("company_id, companies(id, name, stripe_connect_account_id, stripe_connect_onboarded)")
        .eq("user_id", user.id)
        .limit(1)
        .single();
      if (!cu) return null;
      return (cu as any).companies as CompanyRow | null;
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["warehouse", "billing", "invoices"],
    queryFn: async () => {
      const company = companyQ.data;
      if (!company) return [];
      const { data, error } = await supabase
        .from("invoices")
        .select("id,invoice_number,status,total_amount,due_date,issued_at,paid_at")
        .eq("provider_company_id", company.id)
        .order("issued_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as InvoiceRow[];
    },
    enabled: Boolean(companyQ.data) && !isExploring,
  });

  const invoices = isExploring ? SAMPLE_INVOICES : (invoicesQ.data ?? []);
  const company = isExploring ? SAMPLE_COMPANY : companyQ.data;
  const isOnboarded = company?.stripe_connect_onboarded ?? false;

  const handleOnboard = async () => {
    if (!guard("Connect Stripe payouts")) return;
    setOnboardLoading(true);
    setOnboardError(null);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-onboard", {
        body: { companyId: company?.id },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else if (data?.onboarded) {
        window.location.reload();
      }
    } catch (err) {
      setOnboardError(err instanceof Error ? err.message : "Failed to start Stripe Connect onboarding");
    } finally {
      setOnboardLoading(false);
    }
  };

  const handleDashboard = async () => {
    if (!guard("Open Stripe dashboard")) return;
    setOnboardLoading(true);
    setOnboardError(null);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-dashboard", {
        body: { companyId: company?.id },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err) {
      setOnboardError(err instanceof Error ? err.message : "Failed to open Stripe dashboard");
    } finally {
      setOnboardLoading(false);
    }
  };

  const totalPaid = invoices
    .filter((i) => i.status === "Paid")
    .reduce((s, i) => s + (i.total_amount ?? 0), 0);

  const totalPending = invoices
    .filter((i) => i.status === "Issued" || i.status === "Overdue")
    .reduce((s, i) => s + (i.total_amount ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Earnings & Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Stripe Connect status, invoices, and payouts for your warehouse business.
        </p>
      </div>

      {onboardError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {onboardError}
        </div>
      )}

      {/* Stripe Connect status */}
      <Card>
        <CardHeader>
          <CardTitle>Stripe Connect</CardTitle>
          <CardDescription>
            Connect your Stripe account to receive payouts from warehouse bookings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge variant={isOnboarded ? "success" : "warning"}>
              {isOnboarded ? "Onboarded" : "Not connected"}
            </Badge>
            {company?.stripe_connect_account_id && (
              <span className="text-xs text-muted-foreground font-mono">
                {company.stripe_connect_account_id}
              </span>
            )}
          </div>

          {isOnboarded ? (
            <Button variant="outline" disabled={onboardLoading} onClick={handleDashboard}>
              {onboardLoading ? "Opening…" : "Open Stripe Dashboard →"}
            </Button>
          ) : (
            <Button disabled={onboardLoading || !company} onClick={handleOnboard}>
              {onboardLoading ? "Redirecting…" : "Start Stripe Connect onboarding →"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total paid</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalPaid.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending / outstanding</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalPending.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total invoices</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{invoices.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>All invoices for your warehouse operations.</CardDescription>
        </CardHeader>
        <CardContent>
          {!isExploring && invoicesQ.isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No invoices yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice #</TH>
                  <TH>Status</TH>
                  <TH>Total</TH>
                  <TH>Due</TH>
                  <TH>Issued</TH>
                  <TH>Paid</TH>
                </TR>
              </THead>
              <TBody>
                {invoices.map((inv) => (
                  <TR key={inv.id}>
                    <TD className="font-mono text-sm">{inv.invoice_number ?? inv.id.slice(0, 8)}</TD>
                    <TD>
                      <Badge variant={invoiceStatusVariant(inv.status)}>{inv.status}</Badge>
                    </TD>
                    <TD>${Number(inv.total_amount ?? 0).toFixed(2)}</TD>
                    <TD className="text-xs text-muted-foreground">{inv.due_date ?? "—"}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(inv.issued_at)}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(inv.paid_at)}</TD>
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
