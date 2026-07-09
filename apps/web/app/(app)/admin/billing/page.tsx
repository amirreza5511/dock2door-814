"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard, FileText, BadgeDollarSign, Scale, Download, ExternalLink,
  Undo2, RefreshCw, Wallet,
} from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Tab = "payments" | "invoices" | "payouts";

interface PaymentItem {
  id: string;
  booking_id?: string | null;
  gross_amount?: number | string | null;
  commission_amount?: number | string | null;
  net_amount?: number | string | null;
  currency?: string | null;
  stripe_payment_intent_id?: string | null;
  status?: string | null;
  created_at?: string | null;
}
interface InvoiceItem {
  id: string;
  payment_id?: string | null;
  invoice_number?: string | null;
  total_amount?: number | string | null;
  subtotal_amount?: number | string | null;
  commission_amount?: number | string | null;
  currency?: string | null;
  status?: string | null;
  created_at?: string | null;
}
interface PayoutItem {
  id: string;
  company_id?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  status?: string | null;
  created_at?: string | null;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  Paid: "success", Captured: "success", Succeeded: "success", Issued: "warning",
  Pending: "warning", Processing: "warning", Overdue: "destructive", Failed: "destructive",
  Refunded: "destructive", PartiallyRefunded: "warning", Void: "secondary", Voided: "secondary", Draft: "secondary",
};

const money = (v: unknown) => Number(v ?? 0).toFixed(2);

export default function AdminBillingPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("payments");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const paymentsQ = useQuery({
    queryKey: ["admin-billing", "payments"],
    queryFn: async (): Promise<PaymentItem[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select("id,booking_id,gross_amount,commission_amount,net_amount,currency,stripe_payment_intent_id,status,created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as PaymentItem[];
    },
  });
  const invoicesQ = useQuery({
    queryKey: ["admin-billing", "invoices"],
    queryFn: async (): Promise<InvoiceItem[]> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,payment_id,invoice_number,total_amount,subtotal_amount,commission_amount,currency,status,created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as InvoiceItem[];
    },
  });
  const payoutsQ = useQuery({
    queryKey: ["admin-billing", "payouts"],
    queryFn: async (): Promise<PayoutItem[]> => {
      const { data, error } = await supabase
        .from("payouts")
        .select("id,company_id,amount,currency,status,created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as PayoutItem[];
    },
  });

  const totals = useMemo(() => {
    const payments = paymentsQ.data ?? [];
    const invoices = invoicesQ.data ?? [];
    const payouts = payoutsQ.data ?? [];
    const paid = payments.filter((p) => ["Paid", "Captured"].includes(String(p.status))).reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);
    const outstanding = invoices.filter((i) => i.status !== "Paid" && i.status !== "Void" && i.status !== "Voided").reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
    const pendingPayouts = payouts.filter((p) => p.status !== "Paid").reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const refunded = payments.filter((p) => p.status === "Refunded" || p.status === "PartiallyRefunded").reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);
    const invoiced = invoices.reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
    const collected = invoices.filter((i) => i.status === "Paid").reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
    const commission = payments.reduce((s, p) => s + Number(p.commission_amount ?? 0), 0);
    return { paid, outstanding, pendingPayouts, refunded, invoiced, collected, commission, reconDelta: paid - collected };
  }, [paymentsQ.data, invoicesQ.data, payoutsQ.data]);

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-billing"] });
  };

  const refundM = useMutation({
    mutationFn: async ({ paymentId, reason, amount }: { paymentId: string; reason: string; amount?: number }) => {
      const { error } = await supabase.functions.invoke("create-refund", { body: { payment_id: paymentId, reason, ...(amount ? { amount } : {}) } });
      if (error) throw error;
    },
    onSuccess: refetchAll,
  });
  const checkoutM = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: { invoice_id: invoiceId } });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank");
    },
  });
  const markPaidM = useMutation({
    mutationFn: async ({ invoiceId, reference, reason }: { invoiceId: string; reference: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_mark_invoice_paid_manual", { p_invoice_id: invoiceId, p_reference: reference, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: refetchAll,
  });
  const retryPayoutM = useMutation({
    mutationFn: async (payoutId: string) => {
      const { error } = await supabase.functions.invoke("process-payouts", { body: { payout_id: payoutId } });
      if (error) throw error;
    },
    onSuccess: refetchAll,
  });
  const openDashboardM = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("stripe-connect-dashboard", { body: {} });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (url) window.open(url, "_blank");
    },
  });

  const doRefund = (p: PaymentItem) => {
    const reason = window.prompt("Refund reason (required):");
    if (!reason?.trim()) return;
    const max = Number(p.gross_amount ?? 0);
    const amountStr = window.prompt(`Refund amount (max ${max.toFixed(2)}). Leave blank for full refund:`, "");
    const amount = amountStr ? Number(amountStr) : undefined;
    setBusy(p.id);
    refundM.mutate({ paymentId: p.id, reason: reason.trim(), amount }, { onSettled: () => setBusy(null) });
  };
  const doMarkPaid = (i: InvoiceItem) => {
    const reference = window.prompt("Payment reference (method/txn):", "cash");
    if (!reference?.trim()) return;
    const reason = window.prompt("Reason / note (required):", "Manual payment recorded by admin");
    if (!reason?.trim()) return;
    setBusy(i.id);
    markPaidM.mutate({ invoiceId: i.id, reference: reference.trim(), reason: reason.trim() }, { onSettled: () => setBusy(null) });
  };

  const items: (PaymentItem | InvoiceItem | PayoutItem)[] = tab === "payments" ? (paymentsQ.data ?? []) : tab === "invoices" ? (invoicesQ.data ?? []) : (payoutsQ.data ?? []);
  const activeLoading = tab === "payments" ? paymentsQ.isLoading : tab === "invoices" ? invoicesQ.isLoading : payoutsQ.isLoading;

  const exportCsv = () => {
    const rows: Record<string, string | number>[] =
      tab === "payments" ? (paymentsQ.data ?? []).map((p) => ({ id: p.id, booking_id: p.booking_id ?? "", gross: Number(p.gross_amount ?? 0), commission: Number(p.commission_amount ?? 0), net: Number(p.net_amount ?? 0), currency: p.currency ?? "", status: p.status ?? "", stripe_intent: p.stripe_payment_intent_id ?? "", created_at: p.created_at ?? "" }))
      : tab === "invoices" ? (invoicesQ.data ?? []).map((i) => ({ id: i.id, invoice_number: i.invoice_number ?? "", payment_id: i.payment_id ?? "", subtotal: Number(i.subtotal_amount ?? 0), commission: Number(i.commission_amount ?? 0), total: Number(i.total_amount ?? 0), currency: i.currency ?? "", status: i.status ?? "", created_at: i.created_at ?? "" }))
      : (payoutsQ.data ?? []).map((p) => ({ id: p.id, company_id: p.company_id ?? "", amount: Number(p.amount ?? 0), currency: p.currency ?? "", status: p.status ?? "", created_at: p.created_at ?? "" }));
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dock2door-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform Finance</h1>
        <p className="text-sm text-muted-foreground">Every payment, invoice, and payout across the platform.</p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Paid" value={`$${money(totals.paid)}`} />
        <SummaryCard label="Outstanding" value={`$${money(totals.outstanding)}`} tone="text-amber-500" />
        <SummaryCard label="Pending payouts" value={`$${money(totals.pendingPayouts)}`} tone="text-emerald-500" />
      </div>

      {/* Commission + reconciliation */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4 text-primary" /> Reconciliation</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-3">
            <Badge variant={Math.abs(totals.reconDelta) < 0.01 ? "success" : "warning"}>
              {Math.abs(totals.reconDelta) < 0.01 ? "In balance" : `Δ ${totals.reconDelta.toFixed(2)}`}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ReconCell label="Invoiced" value={`$${money(totals.invoiced)}`} />
            <ReconCell label="Collected" value={`$${money(totals.collected)}`} />
            <ReconCell label="Payments" value={`$${money(totals.paid)}`} />
            <ReconCell label="Commission" value={`$${money(totals.commission)}`} tone="text-primary" />
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(["payments", "invoices", "payouts"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSelectedId(null); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
              tab === t ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {t}
          </button>
        ))}
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv}>
          <Download className="mr-1 h-3.5 w-3.5" /> CSV
        </Button>
      </div>

      {/* List */}
      <Card>
        <CardContent className="divide-y p-0">
          {activeLoading && <p className="p-6 text-sm text-muted-foreground">Loading…</p>}
          {!activeLoading && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Wallet className="h-6 w-6" /> No {tab} yet.
            </div>
          )}
          {items.map((item) => {
            const isSel = item.id === selectedId;
            const amount = tab === "payments" ? Number((item as PaymentItem).gross_amount ?? 0)
              : tab === "invoices" ? Number((item as InvoiceItem).total_amount ?? 0)
              : Number((item as PayoutItem).amount ?? 0);
            const label = tab === "payments" ? `Payment ${item.id.slice(0, 8)}`
              : tab === "invoices" ? String((item as InvoiceItem).invoice_number ?? item.id.slice(0, 8))
              : `Payout ${item.id.slice(0, 8)}`;
            return (
              <button key={item.id} onClick={() => setSelectedId(isSel ? null : item.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent ${isSel ? "bg-accent" : ""}`}>
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted">
                  {tab === "payments" ? <CreditCard className="h-4 w-4 text-primary" /> : tab === "invoices" ? <FileText className="h-4 w-4 text-blue-400" /> : <BadgeDollarSign className="h-4 w-4 text-emerald-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    ${amount.toFixed(2)} {String((item as PaymentItem).currency ?? "CAD").toUpperCase()}
                    {item.created_at ? ` · ${new Date(String(item.created_at)).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[String(item.status ?? "Draft")] ?? "secondary"}>{String(item.status ?? "Draft")}</Badge>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* Detail */}
      {selected && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {tab === "payments" && (() => {
              const p = selected as PaymentItem;
              return (
                <>
                  <DetailGrid rows={[
                    ["Payment ID", p.id],
                    ["Booking", String(p.booking_id ?? "—")],
                    ["Gross", `$${money(p.gross_amount)} ${String(p.currency ?? "CAD").toUpperCase()}`],
                    ["Commission", `$${money(p.commission_amount)}`],
                    ["Net", `$${money(p.net_amount)}`],
                    ["Status", String(p.status ?? "—")],
                    ["Stripe intent", String(p.stripe_payment_intent_id ?? "—")],
                  ]} />
                  {p.status !== "Refunded" && (
                    <Button variant="destructive" size="sm" disabled={busy === p.id} onClick={() => doRefund(p)}>
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> Refund payment
                    </Button>
                  )}
                </>
              );
            })()}

            {tab === "invoices" && (() => {
              const i = selected as InvoiceItem;
              const open = i.status !== "Paid" && i.status !== "Void" && i.status !== "Voided";
              return (
                <>
                  <DetailGrid rows={[
                    ["Invoice #", String(i.invoice_number ?? i.id)],
                    ["Payment ID", String(i.payment_id ?? "—")],
                    ["Subtotal", `$${money(i.subtotal_amount)}`],
                    ["Commission", `$${money(i.commission_amount)}`],
                    ["Total", `$${money(i.total_amount)} ${String(i.currency ?? "CAD").toUpperCase()}`],
                    ["Status", String(i.status ?? "—")],
                  ]} />
                  <div className="flex flex-wrap gap-2">
                    {open && (
                      <Button size="sm" disabled={checkoutM.isPending} onClick={() => checkoutM.mutate(i.id)}>
                        <CreditCard className="mr-1 h-3.5 w-3.5" /> Pay invoice
                      </Button>
                    )}
                    {open && (
                      <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => doMarkPaid(i)}>
                        Mark paid (manual)
                      </Button>
                    )}
                  </div>
                </>
              );
            })()}

            {tab === "payouts" && (() => {
              const p = selected as PayoutItem;
              return (
                <>
                  <DetailGrid rows={[
                    ["Payout ID", p.id],
                    ["Company", String(p.company_id ?? "—")],
                    ["Amount", `$${money(p.amount)} ${String(p.currency ?? "CAD").toUpperCase()}`],
                    ["Status", String(p.status ?? "—")],
                  ]} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={openDashboardM.isPending} onClick={() => openDashboardM.mutate()}>
                      <ExternalLink className="mr-1 h-3.5 w-3.5" /> Stripe Express dashboard
                    </Button>
                    {p.status === "Failed" && (
                      <Button size="sm" variant="outline" disabled={retryPayoutM.isPending} onClick={() => retryPayoutM.mutate(p.id)}>
                        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry payout
                      </Button>
                    )}
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold tracking-tight ${tone ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function ReconCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-bold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function DetailGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="space-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{k}</span>
          <span className="truncate text-right">{v}</span>
        </div>
      ))}
    </div>
  );
}
