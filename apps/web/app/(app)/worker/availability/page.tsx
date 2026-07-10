"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const KINDS = ["available", "preferred", "unavailable"] as const;

export default function WorkerAvailabilityPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [kind, setKind] = useState<typeof KINDS[number]>("available");
  const [area, setArea] = useState("");
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });

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

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_my_availability", {
        p_date: date,
        p_start: start,
        p_end: end,
        p_kind: kind,
        p_preferred_area: area || null,
        p_preferred_category: null,
        p_notes: "",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "availability"] }),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_my_availability", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "availability"] }),
  });

  const kindByDate = new Map<string, AvailabilityRow["kind"]>();
  for (const r of availQ.data ?? []) if (!kindByDate.has(r.date)) kindByDate.set(r.date, r.kind);
  const dotColor = (k: AvailabilityRow["kind"] | undefined): string =>
    k === "available" ? "bg-emerald-500" : k === "preferred" ? "bg-primary" : k === "unavailable" ? "bg-muted-foreground" : "";

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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My availability</h1>
        <p className="text-sm text-muted-foreground">
          Tell employers when you&apos;re available, preferred, or off. Employers use this when matching workers to shifts.
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
              const isSelected = iso === date;
              const k = kindByDate.get(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setDate(iso)}
                  className={`flex aspect-square flex-col items-center justify-center rounded-md border text-sm transition ${
                    isSelected ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"
                  } ${inMonth ? "" : "opacity-30"} ${isToday ? "font-bold text-primary" : ""}`}
                >
                  <span>{d.getDate()}</span>
                  {k ? <span className={`mt-1 h-1.5 w-1.5 rounded-full ${dotColor(k)}`} /> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Available</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Preferred</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Off</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add availability</CardTitle>
          <CardDescription>Pick a date and a time window.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Date *</Label>
              <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Start *</Label>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End *</Label>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Preferred area</Label>
              <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Vancouver" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  kind === k
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          {addMut.error && (
            <p className="text-sm text-destructive">{(addMut.error as Error).message}</p>
          )}
          <div className="flex justify-end">
            <Button
              disabled={!date || !start || !end || addMut.isPending}
              onClick={() => addMut.mutate()}
            >
              {addMut.isPending ? "Saving…" : "Save availability"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upcoming</CardTitle>
          <CardDescription>{availQ.data?.length ?? 0} entries</CardDescription>
        </CardHeader>
        <CardContent>
          {availQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (availQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No availability set. Add one above.</p>
          ) : (
            <ul className="divide-y">
              {(availQ.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {r.date} · {r.start_time.slice(0, 5)} – {r.end_time.slice(0, 5)}
                    </div>
                    {r.preferred_area && (
                      <div className="text-xs text-muted-foreground">{r.preferred_area}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        r.kind === "available" ? "success" :
                        r.kind === "preferred" ? "default" : "secondary"
                      }
                    >
                      {r.kind}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={delMut.isPending}
                      onClick={() => delMut.mutate(r.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
