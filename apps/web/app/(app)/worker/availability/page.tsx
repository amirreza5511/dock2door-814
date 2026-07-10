"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface AvailabilityRow {
  id: string;
  worker_user_id: string;
  date: string;
  start_time: string;
  end_time: string;
  kind: "available" | "unavailable" | "preferred";
  preferred_area: string | null;
  preferred_category: string | null;
  notes: string | null;
}

export default function WorkerAvailabilityPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [busyDate, setBusyDate] = useState<string | null>(null);

  const availQ = useQuery({
    queryKey: ["worker", "availability"],
    queryFn: async (): Promise<AvailabilityRow[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("worker_availability")
        .select("id,worker_user_id,date,start_time,end_time,kind,preferred_area,preferred_category,notes")
        .eq("worker_user_id", user.id)
        .gte("date", today)
        .order("date");
      if (error) throw error;
      return (data ?? []) as AvailabilityRow[];
    },
  });

  // A day is "off" when there is an unavailable row covering it.
  const offByDate = new Map<string, AvailabilityRow>();
  for (const r of availQ.data ?? []) {
    if (r.kind === "unavailable" && !offByDate.has(r.date)) offByDate.set(r.date, r);
  }

  const markOff = useMutation({
    mutationFn: async (iso: string) => {
      const { error } = await supabase.rpc("set_my_availability", {
        p_date: iso,
        p_start: "00:00",
        p_end: "23:59",
        p_kind: "unavailable",
        p_preferred_area: null,
        p_preferred_category: null,
        p_notes: "",
      });
      if (error) throw error;
    },
    onSettled: () => { setBusyDate(null); qc.invalidateQueries({ queryKey: ["worker", "availability"] }); },
  });

  const markAvailable = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_my_availability", { p_id: id });
      if (error) throw error;
    },
    onSettled: () => { setBusyDate(null); qc.invalidateQueries({ queryKey: ["worker", "availability"] }); },
  });

  const toggle = (iso: string) => {
    if (iso < today) return;
    setBusyDate(iso);
    const off = offByDate.get(iso);
    if (off) markAvailable.mutate(off.id);
    else markOff.mutate(iso);
  };

  const monthStart = new Date(cursor);
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());
  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const fmt = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const offCount = offByDate.size;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My availability</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re available every day by default. Just tap the days you can&apos;t work to mark them off — that&apos;s it.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{monthLabel}</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setCursor((c) => { const d = new Date(c); d.setMonth(d.getMonth() - 1); return d; })}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCursor((c) => { const d = new Date(c); d.setMonth(d.getMonth() + 1); return d; })}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="pb-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d) => {
              const iso = fmt(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = iso === today;
              const isPast = iso < today;
              const isOff = offByDate.has(iso);
              const isBusy = busyDate === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={isPast || isBusy}
                  onClick={() => toggle(iso)}
                  aria-label={isOff ? `${iso} marked off, tap to make available` : `${iso} available, tap to mark off`}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-md border text-sm transition ${
                    isPast
                      ? "border-transparent text-muted-foreground/40"
                      : isOff
                        ? "border-transparent bg-muted text-muted-foreground line-through hover:bg-muted/70"
                        : "border-emerald-500/30 bg-emerald-500/10 text-foreground hover:bg-emerald-500/20"
                  } ${inMonth ? "" : "opacity-30"} ${isToday && !isPast ? "ring-1 ring-primary" : ""} ${isBusy ? "opacity-60" : ""}`}
                >
                  <span>{d.getDate()}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Available (default)</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Off — you tapped it</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Days off</CardTitle>
          <CardDescription>{offCount === 0 ? "You're available every upcoming day." : `${offCount} day${offCount === 1 ? "" : "s"} marked off.`}</CardDescription>
        </CardHeader>
        {offCount > 0 && (
          <CardContent>
            <ul className="divide-y">
              {[...offByDate.values()].map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="font-medium">
                    {new Date(r.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyDate === r.date}
                    onClick={() => { setBusyDate(r.date); markAvailable.mutate(r.id); }}
                  >
                    Make available
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
