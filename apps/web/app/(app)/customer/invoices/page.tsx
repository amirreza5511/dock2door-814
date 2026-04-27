"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

interface Invoice {
  id: string;
  invoice_number: string | null;
  status: string;
  total: number | null;
  currency: string | null;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
}

export default function CustomerInvoicesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const invoices = useQuery({
    queryKey: ["customer", "invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,invoice_number,status,total,currency,issued_at,due_date,paid_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });

  const checkout = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { invoice_id: invoiceId },
      });
      if (error) throw error;
      const url = (data as { url?: string; checkout_url?: string } | null)?.url
        ?? (data as { checkout_url?: string } | null)?.checkout_url;
      if (url) window.open(url, "_blank");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer", "invoices"] }),
  });

  const cols: Column<Invoice>[] = [
    { key: "num", header: "Invoice", render: (i) => <span className="font-medium">{i.invoice_number ?? i.id.slice(0, 8)}</span> },
    { key: "status", header: "Status", render: (i) => <Badge variant={i.status === "Paid" ? "success" : i.status === "Overdue" ? "destructive" : "warning"}>{i.status}</Badge>, sortable: true, sortValue: (i) => i.status },
    { key: "total", header: "Total", render: (i) => i.total != null ? `${Number(i.total).toFixed(2)} ${i.currency ?? ""}` : "—", sortable: true, sortValue: (i) => i.total },
    { key: "issued", header: "Issued", render: (i) => i.issued_at ? formatDate(i.issued_at) : "—" },
    { key: "due", header: "Due", render: (i) => i.due_date ?? "—" },
    { key: "paid", header: "Paid", render: (i) => i.paid_at ? formatDate(i.paid_at) : "—" },
    { key: "actions", header: "", className: "text-right", render: (i) => (
      i.status !== "Paid" && i.status !== "Voided" ? (
        <Button size="sm" disabled={checkout.isPending} onClick={() => checkout.mutate(i.id)}>Pay now</Button>
      ) : null
    ) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        <p className="text-sm text-muted-foreground">Pay open invoices through Stripe Checkout.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Billing</CardTitle><CardDescription>{invoices.data?.length ?? 0} invoices</CardDescription></CardHeader>
        <CardContent>
          <DataTable
            rows={invoices.data ?? []}
            columns={cols}
            rowKey={(i) => i.id}
            isLoading={invoices.isLoading}
            error={invoices.error as Error | null}
            searchPlaceholder="Search invoice…"
            filters={[
              { value: "open", label: "Open", predicate: (i) => i.status === "Issued" || i.status === "Overdue" },
              { value: "paid", label: "Paid", predicate: (i) => i.status === "Paid" },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
