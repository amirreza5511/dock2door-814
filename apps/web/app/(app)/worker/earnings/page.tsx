"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DollarSign, Clock } from "lucide-react";

interface EarningRow {
  payable_id: string;
  worker_user_id: string;
  shift_id: string;
  shift_title: string | null;
  shift_date: string | null;
  confirmed_hours: number;
  hourly_rate: number;
  gross_pay: number;
  status: "Pending" | "Approved" | "Paid" | "Cancelled";
  paid_at: string | null;
  invoice_id: string | null;
  invoice_status: string | null;
  employer_name: string | null;
}

export default function WorkerEarningsPage() {
  const supabase = getBrowserSupabase();

  const earnings = useQuery({
    queryKey: ["worker", "earnings"],
    queryFn: async (): Promise<EarningRow[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("worker_earnings_overview")
        .select("*")
        .eq("worker_user_id", u.user.id)
        .order("shift_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EarningRow[];
    },
  });

  const totals = useMemo(() => {
    const rows = earnings.data ?? [];
    const paid = rows.filter((r) => r.status === "Paid").reduce((s, r) => s + Number(r.gross_pay), 0);
    const pending = rows
      .filter((r) => r.status !== "Paid" && r.status !== "Cancelled")
      .reduce((s, r) => s + Number(r.gross_pay), 0);
    return { paid, pending };
  }, [earnings.data]);

  const cols: Column<EarningRow>[] = [
    { key: "shift", header: "Shift", render: (r) => <span className="font-medium">{r.shift_title ?? "Shift"}</span> },
    { key: "employer", header: "Employer", render: (r) => r.employer_name ?? "—" },
    { key: "date", header: "Date", render: (r) => r.shift_date ?? "—", sortable: true, sortValue: (r) => r.shift_date },
    { key: "hours", header: "Hours", render: (r) => `${r.confirmed_hours}h × $${Number(r.hourly_rate).toFixed(2)}` },
    { key: "gross", header: "Gross pay", className: "text-right", render: (r) => <span className="font-semibold">${Number(r.gross_pay).toFixed(2)}</span>, sortable: true, sortValue: (r) => Number(r.gross_pay) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "Paid" ? "success" : r.status === "Approved" ? "default" : r.status === "Cancelled" ? "destructive" : "warning"}>
          {r.status}
        </Badge>
      ),
      sortable: true,
      sortValue: (r) => r.status,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Earnings</h1>
        <p className="text-sm text-muted-foreground">An honest record of your confirmed hours and pay. Amounts reflect hours confirmed by your employer.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-emerald-500/15 text-emerald-500">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Paid</div>
              <div className="text-2xl font-semibold text-emerald-500">${totals.paid.toFixed(2)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-amber-500/15 text-amber-500">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Pending</div>
              <div className="text-2xl font-semibold text-amber-500">${totals.pending.toFixed(2)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pay history</CardTitle>
          <CardDescription>{(earnings.data ?? []).length} entries</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={earnings.data ?? []}
            columns={cols}
            rowKey={(r) => r.payable_id}
            isLoading={earnings.isLoading}
            error={earnings.error as Error | null}
            searchPlaceholder="Search shift…"
            filters={[
              { value: "unpaid", label: "Unpaid", predicate: (r) => r.status !== "Paid" && r.status !== "Cancelled" },
              { value: "paid", label: "Paid", predicate: (r) => r.status === "Paid" },
            ]}
            emptyMessage="No earnings yet. Complete a shift and your employer will confirm your hours."
          />
        </CardContent>
      </Card>
    </div>
  );
}
