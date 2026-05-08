"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
  created_at: string;
  customer_company?: string | null;
}

interface PayoutRow {
  id: string;
  status: string;
  amount: number | null;
  currency: string | null;
  scheduled_for: string | null;
  paid_out_at: string | null;
  created_at: string;
}

const INV_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  paid: "success",
  overdue: "destructive",
  issued: "warning",
  draft: "secondary",
  void: "secondary",
};

const PAYOUT_VARIANT: Record<string, "success" | "warning" | "secondary"> = {
  paid: "success",
  pending: "warning",
  processing: "warning",
  failed: "secondary",
};

export default function TruckingFinancePage() {
  const supabase = getBrowserSupabase();

  const invoicesQ = useQuery({
    queryKey: ["trucking", "finance", "invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(`id, invoice_number, status, subtotal, tax, total, due_date, issued_at, paid_at, created_at,
          companies!customer_company_id(name)`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((i: any) => ({
        ...i,
        customer_company: i.companies?.name ?? null,
      })) as InvoiceRow[];
    },
  });

  const payoutsQ = useQuery({
    queryKey: ["trucking", "finance", "payouts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payouts")
        .select("id, status, amount, currency, scheduled_for, paid_out_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [];
      return (data ?? []) as PayoutRow[];
    },
  });

  const stats = {
    revenue: (invoicesQ.data ?? []).filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total ?? 0), 0),
    outstanding: (invoicesQ.data ?? []).filter((i) => i.status === "issued").reduce((s, i) => s + Number(i.total ?? 0), 0),
    pendingPayouts: (payoutsQ.data ?? []).filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.amount ?? 0), 0),
    overdue: (invoicesQ.data ?? []).filter((i) => i.status === "overdue").length,
  };

  const invCols: Column<InvoiceRow>[] = [
    {
      key: "invoice",
      header: "Invoice #",
      render: (i) => (
        <div>
          <div className="font-mono font-medium text-sm">{i.invoice_number}</div>
          <div className="text-xs text-muted-foreground">{i.customer_company ?? "—"}</div>
        </div>
      ),
      sortable: true,
      sortValue: (i) => i.invoice_number,
    },
    {
      key: "status",
      header: "Status",
      render: (i) => <Badge variant={INV_VARIANT[i.status] ?? "secondary"}>{i.status}</Badge>,
      sortable: true,
      sortValue: (i) => i.status,
    },
    {
      key: "total",
      header: "Total",
      render: (i) => i.total != null ? `$${Number(i.total).toFixed(2)}` : "—",
      sortable: true,
      sortValue: (i) => i.total,
    },
    {
      key: "due",
      header: "Due date",
      render: (i) => i.due_date ? (
        <span className={new Date(i.due_date) < new Date() && i.status !== "paid" ? "text-red-600 font-medium" : ""}>
          {i.due_date}
        </span>
      ) : "—",
      sortable: true,
      sortValue: (i) => i.due_date,
    },
    {
      key: "paid",
      header: "Paid on",
      render: (i) => i.paid_at ? <span className="text-xs text-muted-foreground">{formatDate(i.paid_at)}</span> : "—",
    },
    {
      key: "issued",
      header: "Issued",
      render: (i) => <span className="text-xs text-muted-foreground">{formatDate(i.issued_at ?? i.created_at)}</span>,
      sortable: true,
      sortValue: (i) => i.issued_at ?? i.created_at,
    },
  ];

  const payoutCols: Column<PayoutRow>[] = [
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge variant={PAYOUT_VARIANT[p.status] ?? "secondary"}>{p.status}</Badge>,
      sortable: true,
      sortValue: (p) => p.status,
    },
    {
      key: "amount",
      header: "Amount",
      render: (p) => p.amount != null ? `$${Number(p.amount).toFixed(2)} ${p.currency?.toUpperCase() ?? "CAD"}` : "—",
      sortable: true,
      sortValue: (p) => p.amount,
    },
    {
      key: "scheduled",
      header: "Scheduled for",
      render: (p) => p.scheduled_for ? <span className="text-xs">{p.scheduled_for}</span> : "—",
    },
    {
      key: "paid_out",
      header: "Paid out",
      render: (p) => p.paid_out_at ? <span className="text-xs text-muted-foreground">{formatDate(p.paid_out_at)}</span> : "—",
    },
    {
      key: "created",
      header: "Created",
      render: (p) => <span className="text-xs text-muted-foreground">{formatDate(p.created_at)}</span>,
      sortable: true,
      sortValue: (p) => p.created_at,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">Invoices, payments, and payouts for your trucking operations.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Collected revenue", value: `$${stats.revenue.toFixed(2)}` },
          { label: "Outstanding invoices", value: `$${stats.outstanding.toFixed(2)}` },
          { label: "Pending payouts", value: `$${stats.pendingPayouts.toFixed(2)}` },
          { label: "Overdue invoices", value: stats.overdue },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-2xl">{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>{invoicesQ.data?.length ?? 0} total</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={invoicesQ.data ?? []}
            columns={invCols}
            rowKey={(i) => i.id}
            isLoading={invoicesQ.isLoading}
            error={invoicesQ.error as Error | null}
            searchPlaceholder="Search invoice number or company…"
            filters={[
              { value: "outstanding", label: "Outstanding", predicate: (i) => i.status === "issued" },
              { value: "paid", label: "Paid", predicate: (i) => i.status === "paid" },
              { value: "overdue", label: "Overdue", predicate: (i) => i.status === "overdue" },
            ]}
            emptyMessage="No invoices found."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payouts</CardTitle>
          <CardDescription>{payoutsQ.data?.length ?? 0} total</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={payoutsQ.data ?? []}
            columns={payoutCols}
            rowKey={(p) => p.id}
            isLoading={false}
            searchPlaceholder="Search payouts…"
            filters={[
              { value: "pending", label: "Pending", predicate: (p) => p.status === "pending" },
              { value: "paid", label: "Paid", predicate: (p) => p.status === "paid" },
            ]}
            emptyMessage="No payouts found."
          />
        </CardContent>
      </Card>
    </div>
  );
}
