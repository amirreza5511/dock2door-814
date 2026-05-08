"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface WorkerRow {
  id: string;
  user_id: string;
  display_name: string;
  skills: string[];
  coverage_cities: string[];
  hourly_expectation: number | null;
  verified: boolean;
  status: string;
  bio: string | null;
  tagline: string | null;
}

interface CertRow {
  worker_user_id: string;
  type: string;
  expiry_date: string | null;
}

const SKILL_FILTERS = ["All", "General", "Driver", "Forklift", "HighReach"] as const;

export default function BrowseWorkersPage() {
  const supabase = getBrowserSupabase();
  const [search, setSearch] = useState("");
  const [skillFilter, setSkillFilter] = useState<typeof SKILL_FILTERS[number]>("All");
  const [selected, setSelected] = useState<WorkerRow | null>(null);

  const workersQ = useQuery({
    queryKey: ["employer", "browse-workers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_profiles")
        .select("id,user_id,display_name,skills,coverage_cities,hourly_expectation,verified,status,bio,tagline")
        .eq("status", "Active")
        .order("verified", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as WorkerRow[];
    },
  });

  const certsQ = useQuery({
    queryKey: ["employer", "worker-certs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_certifications")
        .select("worker_user_id, type, expiry_date")
        .eq("admin_approved", true);
      if (error) throw error;
      return (data ?? []) as CertRow[];
    },
  });

  const filtered = (workersQ.data ?? []).filter((w) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      w.display_name?.toLowerCase().includes(q) ||
      w.coverage_cities?.some((c) => c.toLowerCase().includes(q)) ||
      w.bio?.toLowerCase().includes(q);
    const matchSkill = skillFilter === "All" || w.skills?.includes(skillFilter);
    return matchSearch && matchSkill;
  });

  const certsByWorker = (certsQ.data ?? []).reduce<Record<string, CertRow[]>>((acc, c) => {
    if (!acc[c.worker_user_id]) acc[c.worker_user_id] = [];
    acc[c.worker_user_id].push(c);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Browse workers</h1>
        <p className="text-sm text-muted-foreground">
          Find qualified workers. Only active profiles with approved certifications are shown.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-72"
          placeholder="Search name, city, bio…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {SKILL_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setSkillFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                skillFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} worker{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {workersQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading workers…</p>
      ) : workersQ.error ? (
        <p className="text-sm text-red-600">{(workersQ.error as Error).message}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No workers found matching your criteria.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((w) => {
            const certs = certsByWorker[w.user_id] ?? [];
            return (
              <Card
                key={w.id}
                className="cursor-pointer transition hover:border-primary hover:shadow-sm"
                onClick={() => setSelected(w)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        {w.display_name}
                        {w.verified && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            ✓ Verified
                          </span>
                        )}
                      </CardTitle>
                      {w.tagline && (
                        <CardDescription className="mt-0.5 text-xs">{w.tagline}</CardDescription>
                      )}
                    </div>
                    {w.hourly_expectation ? (
                      <span className="shrink-0 text-sm font-medium text-foreground">
                        ${Number(w.hourly_expectation).toFixed(2)}/hr
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {w.bio && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{w.bio}</p>
                  )}
                  {w.coverage_cities?.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      📍 {w.coverage_cities.slice(0, 3).join(", ")}
                      {w.coverage_cities.length > 3 ? " …" : ""}
                    </div>
                  )}
                  {w.skills?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {w.skills.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                  )}
                  {certs.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {certs.map((c) => (
                        <Badge key={c.type} variant="success" className="text-xs">
                          {c.type} {c.expiry_date ? `(exp ${c.expiry_date})` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Worker Detail Modal */}
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
                <h2 className="text-lg font-semibold">{selected.display_name}</h2>
                {selected.tagline && (
                  <p className="text-sm text-muted-foreground">{selected.tagline}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>✕</Button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {selected.verified && <Badge variant="success">Verified</Badge>}
                <Badge variant="secondary">{selected.status}</Badge>
                {selected.hourly_expectation && (
                  <Badge variant="outline">${Number(selected.hourly_expectation).toFixed(2)}/hr</Badge>
                )}
              </div>

              {selected.bio && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Bio</div>
                  <p className="text-sm">{selected.bio}</p>
                </div>
              )}

              {selected.coverage_cities?.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Coverage cities</div>
                  <p className="text-sm">{selected.coverage_cities.join(", ")}</p>
                </div>
              )}

              {selected.skills?.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Skills</div>
                  <div className="flex flex-wrap gap-1">
                    {selected.skills.map((s) => (
                      <Badge key={s} variant="secondary">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {(certsByWorker[selected.user_id] ?? []).length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Approved certifications</div>
                  <div className="flex flex-wrap gap-1">
                    {(certsByWorker[selected.user_id] ?? []).map((c) => (
                      <Badge key={c.type} variant="success">
                        {c.type} {c.expiry_date ? `· exp ${c.expiry_date}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
