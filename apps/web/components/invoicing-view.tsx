"use client";

import { useMemo, useState } from "react";
import { FileText, Plus, Trash2, DollarSign } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  useInvoices,
  useAccountingSummary,
  useCreateInvoice,
  useSetInvoiceStatus,
  useCustomerCompanies,
  type InvoiceLineInput,
} from "@/lib/hooks/use-invoicing";
import { useCustomization } from "@/lib/hooks/use-customization";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const SAMPLE_INVOICES = [
  { id: "ex-inv-1", number: "INV-20481", customer_name: "Preview Retail Co.", total: 3300, currency: "CAD", status: "Paid", due_date: null },
  { id: "ex-inv-2", number: "INV-20502", customer_name: "Harbour Freight Ltd.", total: 1044, currency: "CAD", status: "Issued", due_date: new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10) },
  { id: "ex-inv-3", number: "INV-20460", customer_name: "Annacis Island Distribution", total: 2700, currency: "CAD", status: "Overdue", due_date: new Date(Date.now() - 86400000 * 4).toISOString().slice(0, 10) },
];
const SAMPLE_SUMMARY = { collected: 3300, outstanding: 3744, overdue: 2700, net: 7044 };

function money(n: number | null | undefined, currency = "CAD"): string {
  return `${currency} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ACCESSORIALS: { label: string; desc: string }[] = [
  { label: "Per diem", desc: "Per diem (container detention)" },
  { label: "Demurrage", desc: "Demurrage (terminal storage)" },
  { label: "Storage", desc: "Storage" },
  { label: "Chassis", desc: "Chassis usage" },
  { label: "Waiting", desc: "Waiting / detention time" },
  { label: "Pre-pull", desc: "Pre-pull fee" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  Paid: "default",
  Issued: "secondary",
  Draft: "outline",
  Void: "outline",
  Overdue: "outline",
};

export function InvoicingView({
  companyId,
  roleLabel,
  subtitle,
}: {
  companyId: string | null;
  roleLabel: string;
  subtitle: string;
}) {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const invoicesQ = useInvoices(isExploring ? null : companyId);
  const summaryQ = useAccountingSummary(isExploring ? null : companyId);
  const setStatus = useSetInvoiceStatus();
  const [composerOpen, setComposerOpen] = useState(false);

  const invoices = isExploring ? (SAMPLE_INVOICES as unknown as NonNullable<typeof invoicesQ.data>) : (invoicesQ.data ?? []);
  const summary = isExploring ? SAMPLE_SUMMARY : (summaryQ.data ?? null);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{roleLabel}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Invoicing</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button onClick={() => { if (!guard("Create an invoice")) return; setComposerOpen(true); }}>
          <Plus className="mr-1.5 h-4 w-4" /> New invoice
        </Button>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Collected", value: summary.collected, tone: "text-emerald-500" },
            { label: "Outstanding", value: summary.outstanding, tone: "text-foreground" },
            { label: "Overdue", value: summary.overdue, tone: "text-red-500" },
            { label: "Net", value: summary.net, tone: "text-foreground" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="py-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className={`mt-1 text-lg font-semibold ${s.tone}`}>{money(s.value)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {!isExploring && invoicesQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No invoices yet</p>
            <p className="text-sm text-muted-foreground">Bill a customer to see it here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{inv.number ?? `Invoice ${String(inv.id).slice(0, 8)}`}</p>
                  <p className="text-sm text-muted-foreground">
                    {inv.customer_name ?? "Customer"} · {money(inv.total, inv.currency ?? "CAD")}
                    {inv.due_date ? ` · due ${inv.due_date}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[inv.status] ?? "outline"}>{inv.status}</Badge>
                  {inv.status !== "Paid" && inv.status !== "Void" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() => { if (!guard("Mark invoice paid")) return; setStatus.mutate({ id: inv.id, status: "Paid", method: "bank_transfer" }); }}
                    >
                      <DollarSign className="mr-1 h-3.5 w-3.5" /> Mark paid
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <InvoiceComposer companyId={companyId} open={composerOpen} onOpenChange={setComposerOpen} />
    </div>
  );
}

function InvoiceComposer({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const companiesQ = useCustomerCompanies(companyId);
  const create = useCreateInvoice(companyId);
  const { getDefault } = useCustomization();
  const defaultDueDays = String(getDefault<number>("invoiceDueDays", 14));
  const [customerId, setCustomerId] = useState<string>("");
  const [taxRate, setTaxRate] = useState("0");
  const [dueDays, setDueDays] = useState<string>(defaultDueDays);
  const [lines, setLines] = useState<InvoiceLineInput[]>([{ description: "", quantity: 1, unitPrice: 0 }]);

  const total = useMemo(() => {
    const sub = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
    return sub * (1 + (Number(taxRate) || 0) / 100);
  }, [lines, taxRate]);

  const updateLine = (i: number, patch: Partial<InvoiceLineInput>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = () => {
    create.mutate(
      {
        customerCompanyId: customerId || null,
        customerName: companiesQ.data?.find((c) => c.id === customerId)?.name ?? "",
        taxRate: Number(taxRate) || 0,
        dueDays: Number(dueDays) || Number(defaultDueDays) || 14,
        status: "Issued",
        lines,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setLines([{ description: "", quantity: 1, unitPrice: 0 }]);
          setCustomerId("");
          setTaxRate("0");
          setDueDays(defaultDueDays);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a customer…</option>
              {(companiesQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.city ? `· ${c.city}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>Line items</Label>
            <div className="flex flex-wrap gap-1.5">
              {ACCESSORIALS.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/20"
                  onClick={() =>
                    setLines((prev) => {
                      const next = prev.filter((l) => l.description.trim().length > 0 || Number(l.unitPrice) > 0);
                      return [...next, { description: a.desc, quantity: 1, unitPrice: 0 }];
                    })
                  }
                >
                  <Plus className="mr-1 inline h-3 w-3" />{a.label}
                </button>
              ))}
            </div>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                />
                <Input
                  className="w-16"
                  placeholder="Qty"
                  inputMode="numeric"
                  value={String(l.quantity)}
                  onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 0 })}
                />
                <Input
                  className="w-24"
                  placeholder="Unit"
                  inputMode="numeric"
                  value={String(l.unitPrice)}
                  onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) || 0 })}
                />
                {lines.length > 1 ? (
                  <Button size="icon" variant="ghost" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                ) : null}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((p) => [...p, { description: "", quantity: 1, unitPrice: 0 }])}>
              <Plus className="mr-1 h-4 w-4" /> Add line
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="space-y-1.5">
              <Label>Tax rate (%)</Label>
              <Input className="w-24" inputMode="numeric" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="text-lg font-semibold">{money(total)}</p>
            </div>
          </div>

          {create.isError ? (
            <p className="text-sm text-red-500">{create.error instanceof Error ? create.error.message : "Failed"}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create & issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
