"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Building2, ClipboardList, CreditCard, ArrowRight } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { useExplore } from "@/lib/explore-store";

function agencyDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const SAMPLE_AGENCY_WORKERS = [
  { id: "ex-aw-1", status: "Active" }, { id: "ex-aw-2", status: "Active" },
  { id: "ex-aw-3", status: "Active" }, { id: "ex-aw-4", status: "Invited" },
];
const SAMPLE_AGENCY_ASSIGNMENTS: AssignmentRow[] = [
  { assignment_id: "ex-aa-1", shift_title: "Warehouse Loader", shift_date: agencyDate(1), worker_name: "Marcus Lee", employer_name: "Preview Logistics Co.", status: "Scheduled" },
  { assignment_id: "ex-aa-2", shift_title: "Forklift Operator", shift_date: agencyDate(2), worker_name: "Dan Kowalski", employer_name: "Harbour Freight Ltd.", status: "Scheduled" },
  { assignment_id: "ex-aa-3", shift_title: "Order Picker (evening)", shift_date: agencyDate(0), worker_name: "Priya Sharma", employer_name: "Annacis Island Distribution", status: "InProgress" },
];
const SAMPLE_AGENCY_PAYABLES: PayableRow[] = [
  { payable_id: "ex-ap-1", gross_pay: 480, agency_fee: 72, net_to_agency: 408, status: "Pending" },
  { payable_id: "ex-ap-2", gross_pay: 620, agency_fee: 93, net_to_agency: 527, status: "Paid" },
];

interface AssignmentRow {
  assignment_id: string;
  shift_title: string;
  shift_date: string | null;
  worker_name: string;
  employer_name: string;
  status: string;
  [k: string]: unknown;
}

interface PayableRow {
  payable_id: string;
  gross_pay: number;
  agency_fee: number;
  net_to_agency: number;
  status: string;
  [k: string]: unknown;
}

export default function AgencyDashboardPage() {
  const { isExploring } = useExplore();
  const supabase = getBrowserSupabase();
  const companyId = useActiveCompanyId("EmploymentAgency");

  const workersQ = useQuery({
    queryKey: ["agency", "workers", companyId],
    enabled: !!companyId && !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agency_workers")
        .select("id,status")
        .eq("agency_company_id", companyId as string);
      if (error) return [];
      return data ?? [];
    },
  });

  const assignmentsQ = useQuery({
    queryKey: ["agency", "assignments"],
    enabled: !isExploring,
    queryFn: async (): Promise<AssignmentRow[]> => {
      const { data, error } = await supabase.rpc("agency_list_assignments");
      if (error) return [];
      return (data as AssignmentRow[] | null) ?? [];
    },
  });

  const payablesQ = useQuery({
    queryKey: ["agency", "payables"],
    enabled: !isExploring,
    queryFn: async (): Promise<PayableRow[]> => {
      const { data, error } = await supabase.rpc("agency_list_payables");
      if (error) return [];
      return (data as PayableRow[] | null) ?? [];
    },
  });

  const workers = isExploring ? SAMPLE_AGENCY_WORKERS : (workersQ.data ?? []);
  const assignments = useMemo<AssignmentRow[]>(
    () => (isExploring ? SAMPLE_AGENCY_ASSIGNMENTS : (assignmentsQ.data ?? [])),
    [assignmentsQ.data, isExploring],
  );
  const payables = useMemo<PayableRow[]>(
    () => (isExploring ? SAMPLE_AGENCY_PAYABLES : (payablesQ.data ?? [])),
    [payablesQ.data, isExploring],
  );
  const upcoming = assignments.filter((a) => ["Scheduled", "InProgress"].includes(a.status));
  const netEarned = payables.reduce((s, p) => s + Number(p.net_to_agency ?? 0), 0);

  const links = [
    { href: "/agency/workers", label: "My workers", desc: "Roster, invites & links", icon: Users },
    { href: "/agency/clients", label: "My clients", desc: "Your own customer book", icon: Building2 },
    { href: "/agency/shifts", label: "Open shifts", desc: "Claim shifts for your workers", icon: ClipboardList },
    { href: "/agency/billing", label: "Billing", desc: "Payables, fees & net", icon: CreditCard },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Employment Agency</p>
        <h1 className="text-2xl font-semibold tracking-tight">Agency dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Bring your workers & clients — book shifts, coordinate and invoice through Dock2Door.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat value={String(workers.length)} label="Roster workers" />
        <Stat value={String(upcoming.length)} label="Upcoming assignments" />
        <Stat value={String(payables.filter((p) => p.status !== "Paid").length)} label="Open payables" />
        <Stat value={`$${netEarned.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Net to agency" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="transition-colors hover:border-primary/40">
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted"><l.icon className="h-5 w-5 text-primary" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.label}</p>
                  <p className="text-xs text-muted-foreground">{l.desc}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Upcoming assignments</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No upcoming assignments — claim an open shift for one of your workers.</p>
          ) : (
            upcoming.slice(0, 8).map((a) => (
              <div key={a.assignment_id} className="flex items-center justify-between rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{a.shift_title}</p>
                  <p className="text-xs text-muted-foreground">{a.worker_name} · {a.employer_name}{a.shift_date ? ` · ${a.shift_date}` : ""}</p>
                </div>
                <Badge>{a.status}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
