"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { useSalesCommissions, useSalesDashboard, money } from "@/lib/hooks/use-sales";

const STATUS_STYLE: Record<string, string> = {
  Pending: "bg-yellow-500/15 text-yellow-400",
  Approved: "bg-blue-500/15 text-blue-400",
  Paid: "bg-emerald-500/15 text-emerald-400",
  Reversed: "bg-red-500/15 text-red-400",
};

export default function SalesEarningsPage() {
  const q = useSalesCommissions();
  const dashQ = useSalesDashboard();
  const dash = dashQ.data;
  const rows = q.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Commission ledger</h1>
        <p className="text-sm text-muted-foreground">Every bounty, referral & recurring payout</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryCard label="Lifetime" value={money(dash?.lifetime ?? 0)} accent="text-foreground" />
        <SummaryCard label="Pending" value={money(dash?.pending ?? 0)} accent="text-yellow-400" />
        <SummaryCard label="Approved" value={money(dash?.approved ?? 0)} accent="text-blue-400" />
        <SummaryCard label="Paid" value={money(dash?.paid ?? 0)} accent="text-emerald-400" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All entries</CardTitle>
          <CardDescription>{rows.length} entr{rows.length === 1 ? "y" : "ies"}</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commission recorded yet. Onboard a client to start earning.</p>
          ) : (
            <Table>
              <THead>
                <TR><TH>Date</TH><TH>Kind</TH><TH>Vertical</TH><TH>Description</TH><TH>Status</TH><TH>Amount</TH></TR>
              </THead>
              <TBody>
                {rows.map((e) => (
                  <TR key={e.id}>
                    <TD>{formatDate(e.created_at)}</TD>
                    <TD className="capitalize">{e.kind ?? "—"}</TD>
                    <TD className="capitalize">{e.vertical ?? "—"}</TD>
                    <TD className="max-w-xs truncate text-muted-foreground">{e.description ?? "—"}</TD>
                    <TD><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[e.status] ?? "bg-muted"}`}>{e.status}</span></TD>
                    <TD className="font-semibold">{money(e.amount)}</TD>
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

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
