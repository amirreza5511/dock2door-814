"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, Store, CreditCard, Zap, ShieldCheck, ArrowRight } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

interface InvoiceRow {
  id: string;
  status: string;
  total_amount: number;
}

/** Guest hub — pay-as-you-go access to Dock2Door services with prepayment + surcharge. */
export default function GuestHomePage() {
  const supabase = getBrowserSupabase();
  const companyId = useActiveCompanyId();

  const invoicesQ = useQuery({
    queryKey: ["guest", "invoices", companyId],
    enabled: !!companyId,
    refetchInterval: 30000,
    queryFn: async (): Promise<InvoiceRow[]> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id,status,total_amount")
        .eq("customer_company_id", companyId as string);
      if (error) return [];
      return (data as InvoiceRow[] | null) ?? [];
    },
  });

  const invoices = useMemo(() => invoicesQ.data ?? [], [invoicesQ.data]);
  const unpaid = invoices.filter((i) => !["Paid", "Void", "Refunded"].includes(i.status));
  const unpaidTotal = unpaid.reduce((s, i) => s + Number(i.total_amount ?? 0), 0);

  const services = [
    {
      href: "/clearance",
      icon: Landmark,
      title: "Customs clearance",
      desc: "Send shipment details & documents to a licensed customs broker",
    },
    {
      href: "/marketplace",
      icon: Store,
      title: "Rentals & services",
      desc: "Rent forklifts & cranes, book mobile repair, insure cargo",
    },
    {
      href: "/guest/billing",
      icon: CreditCard,
      title: "My billing",
      desc: unpaid.length > 0 ? `${unpaid.length} invoice${unpaid.length > 1 ? "s" : ""} to prepay — $${unpaidTotal.toFixed(2)}` : "All invoices paid",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Guest access</p>
        <h1 className="text-2xl font-semibold tracking-tight">Every service, pay-as-you-go</h1>
        <p className="mt-1 text-sm text-muted-foreground">No business account needed — order instantly, prepay each invoice (guest surcharge included).</p>
      </div>

      {unpaid.length > 0 && (
        <Link href="/guest/billing">
          <Card className="border-yellow-500/40 transition-colors hover:border-yellow-500/70">
            <CardContent className="flex items-center gap-3 pt-6">
              <CreditCard className="h-5 w-5 text-yellow-400" />
              <p className="text-sm">
                <span className="font-medium">{unpaid.length} invoice{unpaid.length > 1 ? "s" : ""} waiting for prepayment</span>
                <span className="text-muted-foreground"> (${unpaidTotal.toFixed(2)}). Services start once paid.</span>
              </p>
            </CardContent>
          </Card>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {services.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardContent className="pt-6">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted"><s.icon className="h-5 w-5 text-primary" /></div>
                <p className="mt-3 flex items-center gap-1 font-medium">{s.title}<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /></p>
                <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">How guest access works</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="flex items-start gap-2"><Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Order any service instantly — no business account or approval wait.</p>
          <p className="flex items-start gap-2"><CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Every invoice includes a guest surcharge and must be prepaid before work starts.</p>
          <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Upgrade to a full business account anytime for standard pricing and invoicing terms.</p>
        </CardContent>
      </Card>
    </div>
  );
}
