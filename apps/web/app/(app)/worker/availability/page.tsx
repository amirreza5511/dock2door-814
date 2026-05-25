"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My availability</h1>
        <p className="text-sm text-muted-foreground">
          Tell employers when you&apos;re available, preferred, or off. Employers use this when matching workers to shifts.
        </p>
      </div>

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
