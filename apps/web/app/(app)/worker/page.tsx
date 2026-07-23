"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useExplore } from "@/lib/explore-store";

function sampleDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const SAMPLE_ASSIGNMENTS: AssignmentRow[] = [
  { id: "ex-asg-1", shift_id: "ex-sp-1", status: "Scheduled", worker_user_id: "explore-user", shift_posts: { id: "ex-sp-1", title: "Warehouse Loader", date: sampleDate(1), start_time: "08:00", end_time: "16:00", location_address: "120 Industrial Ave", location_city: "Vancouver", employer_company_id: "explore-company", companies: { name: "Preview Logistics Co." } } },
  { id: "ex-asg-2", shift_id: "ex-sp-2", status: "Scheduled", worker_user_id: "explore-user", shift_posts: { id: "ex-sp-2", title: "Forklift Operator", date: sampleDate(3), start_time: "07:00", end_time: "15:00", location_address: "55 Dock Rd", location_city: "Richmond", employer_company_id: "explore-company", companies: { name: "Preview Logistics Co." } } },
  { id: "ex-asg-3", shift_id: "ex-sp-4", status: "Scheduled", worker_user_id: "explore-user", shift_posts: { id: "ex-sp-4", title: "Dock Hand", date: sampleDate(6), start_time: "09:00", end_time: "17:00", location_address: "20 Port Rd", location_city: "Burnaby", employer_company_id: "ex-co-2", companies: { name: "Harbour Freight Ltd." } } },
];

const TILES = [
  { href: "/worker/browse-shifts", title: "Browse shifts", desc: "Find open shifts and apply." },
  { href: "/worker/shifts", title: "My shifts", desc: "Assigned shifts. Clock in / out." },
  { href: "/worker/certifications", title: "Certifications", desc: "Upload and track your certifications." },
];

interface ShiftPostRef {
  id: string;
  title: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  location_address: string | null;
  location_city: string | null;
  employer_company_id: string | null;
  companies?: { name: string | null } | { name: string | null }[] | null;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  status: string;
  worker_user_id: string;
  shift_posts: ShiftPostRef | ShiftPostRef[] | null;
}

interface ScheduledShift {
  assignmentId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  address: string;
  city: string;
  employer: string;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function fmtTime(t: string | null): string {
  if (!t) return "";
  try {
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
  } catch {
    return t;
  }
}

export default function WorkerHomePage() {
  const { isExploring } = useExplore();
  const supabase = getBrowserSupabase();

  const assignmentsQ = useQuery({
    queryKey: ["worker", "dashboard-schedule"],
    enabled: !isExploring,
    queryFn: async (): Promise<AssignmentRow[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("shift_assignments")
        .select(
          "id,shift_id,status,worker_user_id,shift_posts!inner(id,title,date,start_time,end_time,location_address,location_city,employer_company_id,companies(name))",
        )
        .eq("worker_user_id", u.user.id)
        .in("status", ["Scheduled", "InProgress"])
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AssignmentRow[];
    },
  });

  const { days, upcoming } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const gridDays: { date: Date; key: string; count: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      gridDays.push({ date: d, key: d.toISOString().slice(0, 10), count: 0 });
    }
    const endKey = gridDays[gridDays.length - 1].key;
    const startKey = gridDays[0].key;

    const source = isExploring ? SAMPLE_ASSIGNMENTS : (assignmentsQ.data ?? []);
    const scheduled: ScheduledShift[] = source
      .map((a) => {
        const s = Array.isArray(a.shift_posts) ? a.shift_posts[0] : a.shift_posts;
        if (!s || !s.date) return null;
        const comp = Array.isArray(s.companies) ? s.companies[0] : s.companies;
        return {
          assignmentId: a.id,
          title: s.title ?? "Untitled shift",
          date: s.date,
          startTime: s.start_time ?? "",
          endTime: s.end_time ?? "",
          address: s.location_address ?? "",
          city: s.location_city ?? "",
          employer: comp?.name ?? "Employer",
        } satisfies ScheduledShift;
      })
      .filter((x): x is ScheduledShift => Boolean(x))
      .filter((x) => x.date >= startKey && x.date <= endKey)
      .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

    for (const item of scheduled) {
      const day = gridDays.find((d) => d.key === item.date);
      if (day) day.count += 1;
    }
    return { days: gridDays, upcoming: scheduled };
  }, [assignmentsQ.data, isExploring]);

  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Worker dashboard</h1>
        <p className="text-sm text-muted-foreground">Your shifts, certifications, and profile.</p>
      </div>

      {/* Next 2 weeks schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Next 2 weeks</CardTitle>
          <CardDescription>Your upcoming assigned shifts — where and when to show up.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map((d) => {
              const has = d.count > 0;
              const isToday = d.key === todayKey;
              return (
                <div
                  key={d.key}
                  className={[
                    "flex w-11 shrink-0 flex-col items-center gap-1 rounded-xl border py-2",
                    isToday ? "border-primary" : "border-border",
                    has ? "bg-primary/10 border-primary/40" : "bg-muted/30",
                  ].join(" ")}
                >
                  <span className={["text-[10px] font-bold", isToday ? "text-primary" : "text-muted-foreground"].join(" ")}>
                    {DOW[d.date.getDay()]}
                  </span>
                  <span className={["text-sm font-extrabold", isToday || has ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                    {d.date.getDate()}
                  </span>
                  <span className={["h-1.5 w-1.5 rounded-full", has ? "bg-primary" : "bg-transparent"].join(" ")} />
                </div>
              );
            })}
          </div>

          {!isExploring && assignmentsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading your schedule…</p>
          ) : upcoming.length === 0 ? (
            <div className="rounded-xl border border-dashed py-8 text-center">
              <p className="text-sm font-medium">No shifts in the next 2 weeks</p>
              <p className="mt-1 text-sm text-muted-foreground">
                <Link href="/worker/browse-shifts" className="text-primary hover:underline">Browse open shifts</Link> to get booked.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {upcoming.map((s) => {
                const d = new Date(s.date + "T00:00:00");
                const site = [s.address, s.city].filter(Boolean).join(", ");
                return (
                  <div key={s.assignmentId} className="flex items-center gap-3 rounded-xl border p-3">
                    <div className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-primary/10 py-1.5">
                      <span className="text-[10px] font-extrabold tracking-wide text-primary">{MONTHS[d.getMonth()]}</span>
                      <span className="text-lg font-extrabold text-primary">{d.getDate()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{s.title}</p>
                      <p className="truncate text-xs font-medium text-primary">{s.employer}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtTime(s.startTime)} – {fmtTime(s.endTime)}
                        {site ? ` · ${site}` : ""}
                      </p>
                    </div>
                    {site && (
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent(site)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-500/20"
                      >
                        Directions
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="group">
            <Card className="transition group-hover:border-primary">
              <CardHeader><CardTitle>{t.title}</CardTitle><CardDescription>{t.desc}</CardDescription></CardHeader>
              <CardContent><span className="text-sm text-primary group-hover:underline">Open →</span></CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
