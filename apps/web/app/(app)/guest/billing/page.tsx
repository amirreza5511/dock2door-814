"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Receipt, CreditCard, CheckCircle2 } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { formatDate } from "@/lib/utils";

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  total_amount: number;
  currency: string;
  status: string;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
  requires_prepayment: boolean;
  created_at: string;
}

type Filter = "unpaid" | "paid" | "all";

const STATUS_CLASS: Record<string, string> = {
  Draft: "bg-white/10 text-muted-foreground",
  Issued: "bg-yellow-500/15 text-yellow-300",
  Paid: "bg-emerald-500/15 text-emerald-300",
  Overdue: "bg-red-500/15 text-red-300",
  Void: "bg-white/10 text-muted-foreground",
  Refunded: "bg-blue-500/15 text-blue-300",
};

/** Guest billing — every invoice is prepaid, with the guest surcharge included. */
export default function GuestBillingPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const companyId = useActiveCompanyId();
  const [filter, setFilter] = useState<Filter>("unpaid");
  const [payError, setPayError] = useState("");

  const q = useQuery({
    queryKey: ["guest", "invoices-full", companyId],
    enabled: !!companyId,
    refetchInterval: 20000,
    queryFn: async (): Promise<InvoiceRow[]> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,invoice_number,total_amount,currency,status,due_date,issued_at,paid_at,requires_prepayment,created_at")
        .eq("customer_company_id", companyId as string)
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data as InvoiceRow[] | null) ?? [];
    },
  });

  const payMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.rpc("guest_pay_invoice", { p_invoice_id: invoiceId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setPayError("");
      void qc.invalidateQueries({ queryKey: ["guest"] });
    },
    onError: (e: Error) => setPayError(e.message),
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const isOpen = (r: InvoiceRow) => !["Paid", "Void", "Refunded"].includes(r.status);
  const filtered = rows.filter((r) => (filter === "unpaid" ? isOpen(r) : filter === "paid" ? r.status === "Paid" : true));
  const unpaidTotal = rows.filter(isOpen).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Guest access</p>
        <h1 className="text-2xl font-semibold tracking-tight">Billing & prepay</h1>
        <p className="mt-1 text-sm text-muted-foreground">Prepaid invoices — the guest service surcharge is already included in each total.</p>
      </div>

      {unpaidTotal > 0 && (
        <Card className="border-yellow-500/40">
          <CardContent className="flex items-center gap-3 pt-6">
            <CreditCard className="h-5 w-5 text-yellow-400" />
            <p className="text-sm font-medium">Outstanding: ${unpaidTotal.toFixed(2)} — prepay to start services</p>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        {(["unpaid", "paid", "all"] as Filter[]).map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
            {f === "unpaid" ? "To pay" : f === "paid" ? "Paid" : "All"}
          </Button>
        ))}
      </div>

      {payError && <p className="text-sm text-red-400">{payError}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Invoices ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {filter === "unpaid" ? "Nothing to pay. When you order a service, the invoice appears here." : "No invoices yet."}
              </p>
            </div>
          ) : (
            filtered.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{inv.invoice_number ?? `Invoice ${inv.id.slice(0, 8)}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.issued_at ? `Issued ${formatDate(inv.issued_at)}` : "Draft"}
                    {inv.due_date ? ` · Due ${inv.due_date}` : ""}
                    {" · Total (incl. surcharge): "}
                    <span className="font-medium text-foreground">${Number(inv.total_amount).toFixed(2)} {inv.currency}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_CLASS[inv.status] ?? ""}>{inv.status}</Badge>
                  {isOpen(inv) ? (
                    <Button size="sm" disabled={payMutation.isPending} onClick={() => payMutation.mutate(inv.id)}>
                      <CreditCard className="mr-2 h-3.5 w-3.5" />{payMutation.isPending ? "Processing…" : "Prepay now"}
                    </Button>
                  ) : inv.status === "Paid" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />Paid{inv.paid_at ? ` ${formatDate(inv.paid_at)}` : ""}
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
