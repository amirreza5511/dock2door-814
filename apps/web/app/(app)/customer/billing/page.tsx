"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { DollarSign, Clock, CheckCircle2 } from "lucide-react";

interface Invoice {
  id: string;
  invoice_number: string | null;
  status: string;
  total_amount: number | null;
  currency: string | null;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
}

interface Payment {
  id: string;
  amount: number | null;
  currency: string | null;
  status: string;
  category: string | null;
  created_at: string;
}

/** Customer › Billing. Web mirror of expo/app/customer/billing.tsx (pay invoices + payment history). */
export default function CustomerBillingPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const invoicesQ = useQuery({
    queryKey: ["customer", "billing", "invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,invoice_number,status,total_amount,currency,issued_at,due_date,paid_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });

  const paymentsQ = useQuery({
    queryKey: ["customer", "billing", "payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id,amount,currency,status,category,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Payment[];
    },
  });

  const totals = useMemo(() => {
    const rows = invoicesQ.data ?? [];
    const outstanding = rows.filter((i) => i.status !== "Paid" && i.status !== "Voided").reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
    const paid = rows.filter((i) => i.status === "Paid").reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
    return { outstanding, paid };
  }, [invoicesQ.data]);

  const checkout = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: { invoice_id: invoiceId } });
      if (error) throw error;
      const url = (data as { url?: string; checkout_url?: string } | null)?.url ?? (data as { checkout_url?: string } | null)?.checkout_url;
      if (url) window.open(url, "_blank");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer", "billing"] }),
  });

  const invoiceCols: Column<Invoice>[] = [
    { key: "num", header: "Invoice", render: (i) => <span className="font-medium">{i.invoice_number ?? i.id.slice(0, 8)}</span> },
    { key: "status", header: "Status", render: (i) => <Badge variant={i.status === "Paid" ? "success" : i.status === "Overdue" ? "destructive" : "warning"}>{i.status}</Badge>, sortable: true, sortValue: (i) => i.status },
    { key: "total", header: "Total", className: "text-right", render: (i) => i.total_amount != null ? `$${Number(i.total_amount).toFixed(2)} ${i.currency ?? ""}` : "—", sortable: true, sortValue: (i) => i.total_amount },
    { key: "issued", header: "Issued", render: (i) => (i.issued_at ? formatDate(i.issued_at) : "—") },
    { key: "due", header: "Due", render: (i) => i.due_date ?? "—" },
    { key: "actions", header: "", className: "text-right", render: (i) => (
      i.status !== "Paid" && i.status !== "Voided" ? (
        <Button size="sm" disabled={checkout.isPending} onClick={() => checkout.mutate(i.id)}>Pay now</Button>
      ) : null
    ) },
  ];

  const paymentCols: Column<Payment>[] = [
    { key: "id", header: "Payment", render: (p) => <span className="font-mono text-xs">{p.id.slice(0, 8)}</span> },
    { key: "category", header: "For", render: (p) => p.category ?? "—" },
    { key: "amount", header: "Amount", className: "text-right", render: (p) => p.amount != null ? `$${Number(p.amount).toFixed(2)} ${p.currency ?? ""}` : "—", sortable: true, sortValue: (p) => p.amount },
    { key: "status", header: "Status", render: (p) => <Badge variant={p.status === "Paid" || p.status === "Succeeded" ? "success" : p.status === "Failed" ? "destructive" : "warning"}>{p.status}</Badge> },
    { key: "date", header: "Date", render: (p) => formatDate(p.created_at) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">Pay open invoices through Stripe Checkout and review your payment history.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-amber-500/15 text-amber-500"><Clock className="h-5 w-5" /></div>
            <div><div className="text-sm text-muted-foreground">Outstanding</div><div className="text-2xl font-semibold text-amber-500">${totals.outstanding.toFixed(2)}</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-emerald-500/15 text-emerald-500"><CheckCircle2 className="h-5 w-5" /></div>
            <div><div className="text-sm text-muted-foreground">Paid to date</div><div className="text-2xl font-semibold text-emerald-500">${totals.paid.toFixed(2)}</div></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-4 w-4" /> Invoices</CardTitle>
          <CardDescription>{invoicesQ.data?.length ?? 0} invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={invoicesQ.data ?? []}
            columns={invoiceCols}
            rowKey={(i) => i.id}
            isLoading={invoicesQ.isLoading}
            error={invoicesQ.error as Error | null}
            searchPlaceholder="Search invoice…"
            filters={[
              { value: "open", label: "Open", predicate: (i) => i.status === "Issued" || i.status === "Overdue" },
              { value: "paid", label: "Paid", predicate: (i) => i.status === "Paid" },
            ]}
            emptyMessage="No invoices yet."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>{paymentsQ.data?.length ?? 0} payments</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={paymentsQ.data ?? []}
            columns={paymentCols}
            rowKey={(p) => p.id}
            isLoading={paymentsQ.isLoading}
            error={paymentsQ.error as Error | null}
            searchPlaceholder="Search payment…"
            emptyMessage="No payments recorded yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
