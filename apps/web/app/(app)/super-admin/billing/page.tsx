"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UnpaidInvoice {
  invoice_id: string;
  employer_company_id: string;
  invoice_number: string | null;
  status: string;
  total_amount: number;
  currency: string;
  due_date: string | null;
}

interface PendingPayout {
  payable_id: string;
  worker_user_id: string;
  shift_title: string | null;
  shift_date: string | null;
  confirmed_hours: number;
  hourly_rate: number;
  gross_pay: number;
  status: string;
  invoice_status: string | null;
  employer_name: string | null;
}

export default function SuperAdminBillingPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"invoices" | "payouts">("invoices");
  const [target, setTarget] = useState<{ kind: "invoice" | "payout"; id: string; amount: number } | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const unpaidQ = useQuery({
    queryKey: ["admin", "unpaid-invoices"],
    queryFn: async (): Promise<UnpaidInvoice[]> => {
      const { data, error } = await supabase
        .from("employer_billing_overview").select("*")
        .neq("status", "Paid").neq("status", "Void")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UnpaidInvoice[];
    },
  });

  const pendingQ = useQuery({
    queryKey: ["admin", "pending-payouts"],
    queryFn: async (): Promise<PendingPayout[]> => {
      const { data, error } = await supabase
        .from("worker_earnings_overview").select("*")
        .in("status", ["Pending", "Approved"])
        .order("shift_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingPayout[];
    },
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("no target");
      const r = reason.trim();
      if (r.length < 10) throw new Error("Reason must be at least 10 characters");
      if (target.kind === "invoice") {
        const { error } = await supabase.rpc("admin_mark_invoice_paid_manual", {
          p_invoice_id: target.id, p_reference: reference.trim(), p_reason: r,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("admin_mark_worker_payout_paid", {
          p_payable_id: target.id, p_reference: reference.trim(), p_reason: r,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "unpaid-invoices"] });
      qc.invalidateQueries({ queryKey: ["admin", "pending-payouts"] });
      setTarget(null); setReason(""); setReference("");
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing oversight</h1>
        <p className="text-sm text-muted-foreground">
          Unpaid employer invoices and pending worker payouts. Manual mark-paid is audited and requires a real reason.
        </p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={tab === "invoices" ? "default" : "outline"} onClick={() => setTab("invoices")}>
          Unpaid invoices ({unpaidQ.data?.length ?? 0})
        </Button>
        <Button size="sm" variant={tab === "payouts" ? "default" : "outline"} onClick={() => setTab("payouts")}>
          Pending payouts ({pendingQ.data?.length ?? 0})
        </Button>
      </div>

      {tab === "invoices" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unpaid employer invoices</CardTitle>
            <CardDescription>Mark manually paid once payment has been received (cheque, transfer, etc.).</CardDescription>
          </CardHeader>
          <CardContent>
            {unpaidQ.isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading…</p>
            ) : (unpaidQ.data ?? []).length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No unpaid invoices.</p>
            ) : (
              <ul className="space-y-2">
                {(unpaidQ.data ?? []).map((inv) => (
                  <li key={inv.invoice_id} className="flex items-center justify-between rounded-md border px-4 py-3">
                    <div>
                      <p className="font-medium text-sm">{inv.invoice_number ?? inv.invoice_id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">{inv.due_date ? `Due ${inv.due_date}` : "—"}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">${inv.total_amount.toFixed(2)} {inv.currency}</span>
                      <Badge variant="warning">{inv.status}</Badge>
                      <Button size="sm" onClick={() => setTarget({ kind: "invoice", id: inv.invoice_id, amount: inv.total_amount })}>
                        Mark paid
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "payouts" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending worker payouts</CardTitle>
            <CardDescription>Workers cannot be marked paid until the related employer invoice is paid.</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingQ.isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading…</p>
            ) : (pendingQ.data ?? []).length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No pending payouts.</p>
            ) : (
              <ul className="space-y-2">
                {(pendingQ.data ?? []).map((p) => {
                  const canPay = p.invoice_status === "Paid";
                  return (
                    <li key={p.payable_id} className="flex items-center justify-between rounded-md border px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{p.shift_title ?? "Shift"}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.employer_name ?? "Employer"}{p.shift_date ? ` · ${p.shift_date}` : ""} · {p.confirmed_hours}h × ${p.hourly_rate}
                        </p>
                        <p className={`mt-1 text-xs ${canPay ? "text-green-600" : "text-yellow-600"}`}>
                          Invoice: {p.invoice_status ?? "not issued"}{canPay ? "" : " — must be paid first"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">${p.gross_pay.toFixed(2)}</span>
                        <Badge variant={p.status === "Approved" ? "success" : "warning"}>{p.status}</Badge>
                        <Button size="sm" disabled={!canPay} onClick={() => setTarget({ kind: "payout", id: p.payable_id, amount: p.gross_pay })}>
                          Mark paid
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTarget(null)}>
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Mark {target.kind === "invoice" ? "invoice" : "payout"} paid</h2>
            <p className="mt-1 text-xs text-muted-foreground">Amount: ${target.amount.toFixed(2)}</p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Reference (cheque #, transfer id…)</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. cheque #1042" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reason / note (min 10 chars) *</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain what was paid and how" autoFocus />
              </div>
              {markPaid.error && <p className="text-xs text-destructive">{(markPaid.error as Error).message}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>Cancel</Button>
                <Button size="sm" disabled={markPaid.isPending || reason.trim().length < 10} onClick={() => markPaid.mutate()}>
                  {markPaid.isPending ? "Submitting…" : "Confirm"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
