"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const DEFAULT_START = "08:00";
const DEFAULT_END = "17:00";

type DayMode = "default" | "custom" | "off";

function hhmm(t: string): string {
  return (t ?? "").slice(0, 5);
}

export default function WorkerAvailabilityPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selected, setSelected] = useState<string | null>(null);
  const [editStart, setEditStart] = useState(DEFAULT_START);
  const [editEnd, setEditEnd] = useState(DEFAULT_END);
  const [editOff, setEditOff] = useState(false);

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

  // One representative row per date (workday customisation or an off marker).
  const rowByDate = new Map<string, AvailabilityRow>();
  for (const r of availQ.data ?? []) if (!rowByDate.has(r.date)) rowByDate.set(r.date, r);

  const modeFor = (iso: string): DayMode => {
    const r = rowByDate.get(iso);
    if (!r) return "default";
    if (r.kind === "unavailable") return "off";
    return "custom";
  };

  const saveMut = useMutation({
    mutationFn: async (payload: { date: string; mode: DayMode; start: string; end: string }) => {
      // Clear any existing rows for this date so we never leave stale slots behind.
      const existing = (availQ.data ?? []).filter((r) => r.date === payload.date);
      for (const r of existing) {
        const { error } = await supabase.rpc("delete_my_availability", { p_id: r.id });
        if (error) throw error;
      }
      if (payload.mode === "default") return; // no row = available on default hours
      if (payload.mode === "off") {
        const { error } = await supabase.rpc("set_my_availability", {
          p_date: payload.date, p_start: "00:00", p_end: "23:59",
          p_kind: "unavailable", p_preferred_area: null, p_preferred_category: null, p_notes: "",
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("set_my_availability", {
        p_date: payload.date, p_start: payload.start, p_end: payload.end,
        p_kind: "available", p_preferred_area: null, p_preferred_category: null, p_notes: "",
      });
      if (error) throw error;
    },
    onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ["worker", "availability"] }); },
  });

  const openDay = (iso: string) => {
    if (iso < today) return;
    const r = rowByDate.get(iso);
    setSelected(iso);
    if (r && r.kind === "unavailable") {
      setEditOff(true);
      setEditStart(DEFAULT_START);
      setEditEnd(DEFAULT_END);
    } else if (r) {
      setEditOff(false);
      setEditStart(hhmm(r.start_time) || DEFAULT_START);
      setEditEnd(hhmm(r.end_time) || DEFAULT_END);
    } else {
      setEditOff(false);
      setEditStart(DEFAULT_START);
      setEditEnd(DEFAULT_END);
    }
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
  const offCount = [...rowByDate.values()].filter((r) => r.kind === "unavailable").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My availability</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re available every day from <strong>8:00 to 17:00</strong> by default. Tap any day to mark it off or change its hours.
        </p>
      </div>

      {availQ.isError && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <span className="text-destructive">Couldn&apos;t reach the server. Check your connection and try again.</span>
          <Button size="sm" variant="outline" onClick={() => availQ.refetch()} disabled={availQ.isFetching}>
            {availQ.isFetching ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}

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
              const mode = modeFor(iso);
              const isSelected = iso === selected;
              const r = rowByDate.get(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={isPast}
                  onClick={() => openDay(iso)}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-md border text-sm transition ${
                    isPast
                      ? "border-transparent text-muted-foreground/40"
                      : mode === "off"
                        ? "border-transparent bg-muted text-muted-foreground line-through hover:bg-muted/70"
                        : mode === "custom"
                          ? "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/20"
                          : "border-emerald-500/30 bg-emerald-500/10 text-foreground hover:bg-emerald-500/20"
                  } ${inMonth ? "" : "opacity-30"} ${isToday && !isPast ? "ring-1 ring-primary" : ""} ${isSelected ? "ring-2 ring-primary" : ""}`}
                >
                  <span>{d.getDate()}</span>
                  {!isPast && mode === "custom" && r ? (
                    <span className="mt-0.5 text-[8px] leading-none text-primary">{hhmm(r.start_time)}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Available 8–17</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Custom hours</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Off</span>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {new Date(selected + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </CardTitle>
            <CardDescription>Set your hours for this day, or mark it as a day off.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditOff(false)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${!editOff ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                Working
              </button>
              <button
                type="button"
                onClick={() => setEditOff(true)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${editOff ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                Day off
              </button>
            </div>

            {!editOff && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Start</Label>
                  <Input type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">End</Label>
                  <Input type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
                </div>
              </div>
            )}

            {saveMut.error && <p className="text-sm text-destructive">{(saveMut.error as Error).message}</p>}

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
              <div className="flex gap-2">
                {modeFor(selected) !== "default" && (
                  <Button
                    variant="outline"
                    disabled={saveMut.isPending}
                    onClick={() => saveMut.mutate({ date: selected, mode: "default", start: DEFAULT_START, end: DEFAULT_END })}
                  >
                    Reset to 8–17
                  </Button>
                )}
                <Button
                  disabled={saveMut.isPending}
                  onClick={() => saveMut.mutate({
                    date: selected,
                    mode: editOff ? "off" : (editStart === DEFAULT_START && editEnd === DEFAULT_END ? "default" : "custom"),
                    start: editStart,
                    end: editEnd,
                  })}
                >
                  {saveMut.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Days off</CardTitle>
          <CardDescription>{offCount === 0 ? "You're available every upcoming day." : `${offCount} day${offCount === 1 ? "" : "s"} marked off.`}</CardDescription>
        </CardHeader>
        {offCount > 0 && (
          <CardContent>
            <ul className="divide-y">
              {[...rowByDate.values()].filter((r) => r.kind === "unavailable").map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="font-medium">
                    {new Date(r.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saveMut.isPending}
                    onClick={() => saveMut.mutate({ date: r.date, mode: "default", start: DEFAULT_START, end: DEFAULT_END })}
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
