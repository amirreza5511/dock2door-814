"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ShiftRow {
  id: string;
  title: string;
  category: string;
  status: string;
  date: string;
  start_time: string;
  end_time: string;
  hourly_rate: number | null;
  workers_needed: number | null;
  location_city: string | null;
  location_address: string | null;
  requirements: string | null;
  notes: string | null;
  employer_company_id: string;
  company_name?: string | null;
}

interface ApplicationRow {
  id: string;
  shift_id: string;
  status: string;
}

const CATEGORIES = ["All", "General", "Driver", "Forklift", "HighReach"] as const;

const CAT_COLOR: Record<string, string> = {
  General: "bg-slate-100 text-slate-800",
  Driver: "bg-blue-100 text-blue-800",
  Forklift: "bg-amber-100 text-amber-800",
  HighReach: "bg-purple-100 text-purple-800",
};

export default function BrowseShiftsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<typeof CATEGORIES[number]>("All");
  const [selected, setSelected] = useState<ShiftRow | null>(null);

  const shiftsQ = useQuery({
    queryKey: ["worker", "open-shifts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_posts")
        .select(`id,title,category,status,date,start_time,end_time,hourly_rate,workers_needed,
          location_city,location_address,requirements,notes,employer_company_id,
          companies!inner(name)`)
        .eq("status", "Posted")
        .gte("date", new Date().toISOString().split("T")[0])
        .order("date", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        ...s,
        company_name: s.companies?.name ?? null,
      })) as ShiftRow[];
    },
  });

  const myAppsQ = useQuery({
    queryKey: ["worker", "my-applications"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("shift_applications")
        .select("id, shift_id, status")
        .eq("worker_user_id", user.id);
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
    },
  });

  const apply = useMutation({
    mutationFn: async (shiftId: string) => {
      const { error } = await supabase.rpc("worker_apply_shift", { p_shift_id: shiftId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker", "my-applications"] });
      qc.invalidateQueries({ queryKey: ["worker", "open-shifts"] });
    },
  });

  const withdraw = useMutation({
    mutationFn: async (applicationId: string) => {
      const { error } = await supabase
        .from("shift_applications")
        .update({ status: "Withdrawn" })
        .eq("id", applicationId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worker", "my-applications"] }),
  });

  const myAppsMap = (myAppsQ.data ?? []).reduce<Record<string, ApplicationRow>>((acc, a) => {
    acc[a.shift_id] = a;
    return acc;
  }, {});

  const filtered = (shiftsQ.data ?? []).filter((s) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      s.title?.toLowerCase().includes(q) ||
      s.location_city?.toLowerCase().includes(q) ||
      s.company_name?.toLowerCase().includes(q);
    const matchCat = catFilter === "All" || s.category === catFilter;
    return matchSearch && matchCat;
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Browse shifts</h1>
        <p className="text-sm text-muted-foreground">Find open shifts and apply. You can only apply to future shifts.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-72"
          placeholder="Search title, city, company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                catFilter === c
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} open shift{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {apply.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(apply.error as Error).message}
        </div>
      )}

      {shiftsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading shifts…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open shifts matching your criteria.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const app = myAppsMap[s.id];
            const hasApplied = Boolean(app && app.status !== "Withdrawn");
            return (
              <Card key={s.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{s.title}</CardTitle>
                      <CardDescription className="mt-0.5">{s.company_name ?? "—"}</CardDescription>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CAT_COLOR[s.category] ?? "bg-muted text-muted-foreground"}`}>
                      {s.category}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span>📅</span>
                      <span>{s.date} · {s.start_time?.slice(0,5)} – {s.end_time?.slice(0,5)}</span>
                    </div>
                    {s.location_city && (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span>📍</span>
                        <span>{s.location_city}</span>
                      </div>
                    )}
                    {s.hourly_rate != null && (
                      <div className="font-medium text-foreground">${Number(s.hourly_rate).toFixed(2)}/hr</div>
                    )}
                  </div>

                  {s.requirements && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      <span className="font-medium">Requirements:</span> {s.requirements}
                    </p>
                  )}

                  <div className="mt-auto flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelected(s)}
                    >
                      Details
                    </Button>
                    {hasApplied ? (
                      <div className="flex items-center gap-2">
                        <Badge variant={app?.status === "Accepted" ? "success" : app?.status === "Rejected" ? "destructive" : "warning"}>
                          {app?.status}
                        </Badge>
                        {app?.status === "Applied" && (
                          <Button size="sm" variant="secondary"
                            disabled={withdraw.isPending}
                            onClick={() => withdraw.mutate(app.id)}>
                            Withdraw
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button size="sm"
                        disabled={apply.isPending}
                        onClick={() => apply.mutate(s.id)}>
                        Apply
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <p className="text-sm text-muted-foreground">{selected.company_name}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>✕</Button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Category</div>
                  <Badge variant="secondary">{selected.category}</Badge>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Pay rate</div>
                  <div className="font-medium">
                    {selected.hourly_rate != null ? `$${Number(selected.hourly_rate).toFixed(2)}/hr` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Date</div>
                  <div>{selected.date}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Time</div>
                  <div>{selected.start_time?.slice(0,5)} – {selected.end_time?.slice(0,5)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Workers needed</div>
                  <div>{selected.workers_needed ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Location</div>
                  <div>{[selected.location_address, selected.location_city].filter(Boolean).join(", ") || "—"}</div>
                </div>
              </div>

              {selected.requirements && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Requirements</div>
                  <p>{selected.requirements}</p>
                </div>
              )}

              {selected.notes && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Notes</div>
                  <p>{selected.notes}</p>
                </div>
              )}

              <div className="pt-2 border-t">
                {(() => {
                  const app = myAppsMap[selected.id];
                  const hasApplied = Boolean(app && app.status !== "Withdrawn");
                  return hasApplied ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Application status:</span>
                      <Badge variant={app?.status === "Accepted" ? "success" : app?.status === "Rejected" ? "destructive" : "warning"}>
                        {app?.status}
                      </Badge>
                    </div>
                  ) : (
                    <Button className="w-full"
                      disabled={apply.isPending}
                      onClick={() => { apply.mutate(selected.id); setSelected(null); }}>
                      Apply for this shift
                    </Button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
