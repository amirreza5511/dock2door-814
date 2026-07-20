"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell, BookOpen, ChevronRight, MessageCircle, Search, Sparkles, Star } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HELP_ROLES, HELP_WORLDS, ROLE_TO_HELP_KEY, SHARED_HELP, type RoleDoc } from "@/lib/help";

const SHARED_ICON: Record<string, typeof MessageCircle> = {
  messages: MessageCircle,
  notifications: Bell,
  assistant: Sparkles,
  reviews: Star,
};

/** Help Center home — searchable role manuals grouped by product world. */
export default function HelpHomePage() {
  const supabase = getBrowserSupabase();
  const [query, setQuery] = useState<string>("");

  const roleQ = useQuery({
    queryKey: ["help", "my-role"],
    queryFn: async (): Promise<string | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
      return (data as { role?: string } | null)?.role ?? null;
    },
  });

  const myKey = roleQ.data ? ROLE_TO_HELP_KEY[roleQ.data] : undefined;
  const myRole = useMemo<RoleDoc | undefined>(() => HELP_ROLES.find((r) => r.key === myKey), [myKey]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length === 0) return [];
    const out: { roleKey: string; roleName: string; screenId: string; title: string; summary: string }[] = [];
    for (const role of HELP_ROLES) {
      for (const s of role.screens) {
        if (
          s.title.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          role.name.toLowerCase().includes(q) ||
          s.actions.some((a) => a.toLowerCase().includes(q))
        ) {
          out.push({ roleKey: role.key, roleName: role.name, screenId: s.id, title: s.title, summary: s.summary });
        }
      }
    }
    return out.slice(0, 20);
  }, [q]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Help Center</h1>
          <p className="text-sm text-muted-foreground">Manuals for every role, plus an AI assistant.</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the manual…"
          className="pl-9"
        />
      </div>

      {q.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            {matches.length} result{matches.length === 1 ? "" : "s"}
          </p>
          {matches.map((m) => (
            <Link
              key={`${m.roleKey}-${m.screenId}`}
              href={`/help/${m.roleKey}?screen=${m.screenId}`}
              className="flex items-center gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3 transition-colors hover:bg-card"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{m.title}</p>
                <p className="truncate text-xs text-muted-foreground">{m.roleName} · {m.summary}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
          {matches.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No matches found.</p>}
        </div>
      ) : (
        <>
          <Link href="/help/chat">
            <Card className="border-primary/40 transition-colors hover:border-primary/70">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Ask the AI assistant</p>
                  <p className="text-xs text-muted-foreground">Answers come straight from the app manual — step-by-step, for your role.</p>
                </div>
                <ChevronRight className="h-5 w-5 text-primary" />
              </CardContent>
            </Card>
          </Link>

          {myRole && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Your manual</p>
              <RoleCard role={myRole} highlighted />
            </div>
          )}

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">All manuals</p>
            {HELP_WORLDS.map((w) => {
              const roles = HELP_ROLES.filter((r) => r.world === w.key);
              if (roles.length === 0) return null;
              return (
                <div key={w.key} className="space-y-2">
                  <div className="flex items-center gap-2 pt-2">
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: w.color }} />
                    <p className="text-sm font-bold">{w.title}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{w.blurb}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {roles.map((r) => <RoleCard key={r.key} role={r} />)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Everywhere in the app</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SHARED_HELP.map((s) => {
                const Icon = SHARED_ICON[s.id] ?? BookOpen;
                return (
                  <Card key={s.id}>
                    <CardContent className="space-y-2 pt-5">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-sm font-semibold">{s.title}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{s.summary}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RoleCard({ role, highlighted }: { role: RoleDoc; highlighted?: boolean }) {
  const Icon = role.icon;
  return (
    <Link
      href={`/help/${role.key}`}
      className={`flex items-center gap-3 rounded-xl border bg-card/60 p-4 transition-colors hover:bg-card ${
        highlighted ? "" : "border-white/5"
      }`}
      style={highlighted ? { borderColor: role.color } : undefined}
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${role.color}20` }}>
        <Icon className="h-5 w-5" style={{ color: role.color }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{role.name}</p>
        <p className="truncate text-xs text-muted-foreground">{role.tagline}</p>
      </div>
      <span className="text-xs font-bold text-muted-foreground">{role.screens.length}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
