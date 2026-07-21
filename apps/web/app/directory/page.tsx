"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Search, Building2, Star, MapPin, BadgeCheck, Briefcase, ArrowRight } from "lucide-react";
import {
  DIRECTORY_COMPANIES, DIRECTORY_JOBS, DOMAIN_LABELS, DOMAIN_ACCENT, type Domain,
} from "@/lib/explore-catalog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Tab = "companies" | "jobs";
type Filter = Domain | "all";

const FILTERS: Filter[] = ["all", "labour", "logistics", "freight", "drayage", "marketplace", "globalfreight"];

export default function DirectoryPage() {
  const [tab, setTab] = useState<Tab>("companies");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const companies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DIRECTORY_COMPANIES.filter((c) => {
      if (filter !== "all" && c.domain !== filter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.roleLabel.toLowerCase().includes(q);
    });
  }, [search, filter]);

  const jobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DIRECTORY_JOBS.filter((j) => {
      if (filter !== "all" && j.domain !== filter) return false;
      if (!q) return true;
      return j.title.toLowerCase().includes(q) || j.city.toLowerCase().includes(q) || j.company.toLowerCase().includes(q);
    });
  }, [search, filter]);

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Directory</h1>
        <p className="text-sm text-muted-foreground">Companies & open work across Dock2Door — browse freely, no account needed.</p>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search name, city or type…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab("companies")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "companies" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <Building2 className="h-4 w-4" /> Companies
        </button>
        <button
          onClick={() => setTab("jobs")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "jobs" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <Briefcase className="h-4 w-4" /> Jobs & loads
        </button>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "All" : DOMAIN_LABELS[f]}
          </button>
        ))}
      </div>

      {tab === "companies" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {companies.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${DOMAIN_ACCENT[c.domain]}`}>
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-semibold">{c.name}</p>
                      {c.verified && <BadgeCheck className="h-4 w-4 text-blue-500" />}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className={`rounded border px-1.5 py-0.5 font-semibold ${DOMAIN_ACCENT[c.domain]}`}>{c.roleLabel}</span>
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{c.city}</span>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{c.blurb}</p>
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="inline-flex items-center gap-1 text-sm">
                    <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" />
                    <span className="font-bold">{c.rating.toFixed(1)}</span>
                    <span className="text-muted-foreground">({c.reviews})</span>
                  </span>
                  <Link href="/login?next=/partners">
                    <Button size="sm" className="gap-1">Contact <ArrowRight className="h-3.5 w-3.5" /></Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {jobs.map((j) => (
            <Card key={j.id}>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center justify-between">
                  <span className={`rounded border px-1.5 py-0.5 text-xs font-bold ${DOMAIN_ACCENT[j.domain]}`}>{j.tag}</span>
                  <span className="text-base font-bold">{j.pay}</span>
                </div>
                <p className="font-semibold">{j.title}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{j.company}</span>
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{j.city}</span>
                </div>
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-xs text-muted-foreground">{j.when}</span>
                  <Link href="/login?next=/dashboard" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    View & apply <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(tab === "companies" ? companies.length : jobs.length) === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Search className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No matches. Try a different search or filter.</p>
        </div>
      )}
    </div>
  );
}
