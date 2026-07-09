"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, MapPin, Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { useSalesClientDetail, money } from "@/lib/hooks/use-sales";

export default function SalesClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useSalesClientDetail(id);
  const client = q.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/sales-agent/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !client ? (
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Client not found.</p></CardContent></Card>
      ) : (
        <>
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-xl bg-muted"><Building2 className="h-6 w-6 text-primary" /></div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">{client.onboardStatus}</span>
              </div>
              <p className="text-sm capitalize text-muted-foreground">{client.vertical || "—"} · joined {formatDate(client.createdAt)}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Contact</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {client.email || "—"}</p>
                <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> {[client.address, client.city].filter(Boolean).join(", ") || "—"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Onboarding</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Step label="Signed up with your code" done />
                <Step label="Company profile created" done={client.hasCompany} />
                <Step label="Approved & active" done={client.onboardStatus === "Active"} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Commission from this client</CardTitle>
              <CardDescription>{client.commissions.length} entr{client.commissions.length === 1 ? "y" : "ies"}</CardDescription>
            </CardHeader>
            <CardContent>
              {client.commissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No commission recorded yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR><TH>Date</TH><TH>Kind</TH><TH>Status</TH><TH>Amount</TH></TR>
                  </THead>
                  <TBody>
                    {client.commissions.map((e) => (
                      <TR key={e.id}>
                        <TD>{formatDate(e.created_at)}</TD>
                        <TD className="capitalize">{e.kind ?? "—"}</TD>
                        <TD>{e.status}</TD>
                        <TD className="font-semibold text-emerald-400">{money(e.amount)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Step({ label, done }: { label: string; done: boolean }) {
  return (
    <p className="flex items-center gap-2">
      <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${done ? "bg-emerald-500 text-white" : "border border-muted-foreground/40"}`}>{done ? "✓" : ""}</span>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </p>
  );
}
