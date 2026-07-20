"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, ChevronLeft, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getRoleDoc, getScreenRoute } from "@/lib/help";

/** Role manual — every screen of a role explained step-by-step, with deep links. */
export default function RoleManualPage() {
  const params = useParams<{ role: string }>();
  const search = useSearchParams();
  const role = getRoleDoc(String(params.role ?? ""));
  const focusScreen = search.get("screen") ?? undefined;
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!focusScreen) return;
    const t = setTimeout(() => {
      refs.current[focusScreen]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => clearTimeout(t);
  }, [focusScreen]);

  if (!role) {
    return (
      <div className="mx-auto max-w-2xl py-20 text-center">
        <p className="text-sm text-muted-foreground">Manual not found.</p>
        <Link href="/help" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          Back to Help Center
        </Link>
      </div>
    );
  }

  const Icon = role.icon;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/help" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-card transition-colors hover:bg-accent">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">{role.name} Manual</h1>
        <Link href="/help/chat" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-card transition-colors hover:bg-accent">
          <Sparkles className="h-4 w-4" style={{ color: role.color }} />
        </Link>
      </div>

      <Card style={{ borderColor: role.color, backgroundColor: `${role.color}10` }}>
        <CardContent className="space-y-3 pt-6">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-background">
            <Icon className="h-6 w-6" style={{ color: role.color }} />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">{role.name}</p>
            <p className="text-sm text-muted-foreground">{role.tagline}</p>
          </div>
          <p className="text-sm leading-relaxed">{role.overview}</p>
        </CardContent>
      </Card>

      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {role.screens.length} screens, step by step
      </p>

      <div className="space-y-4">
        {role.screens.map((s, i) => (
          <div
            key={s.id}
            ref={(el) => { refs.current[s.id] = el; }}
            className="space-y-3 rounded-xl border bg-card p-5"
            style={{ borderColor: focusScreen === s.id ? role.color : "rgba(255,255,255,0.05)" }}
          >
            <div className="flex items-start gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm font-bold" style={{ backgroundColor: `${role.color}20`, color: role.color }}>
                {i + 1}
              </div>
              <div>
                <p className="font-semibold">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.summary}</p>
              </div>
            </div>

            <div className="space-y-2">
              {s.actions.map((a) => (
                <div key={a} className="flex items-center gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ backgroundColor: `${role.color}20` }}>
                    <Check className="h-3 w-3" style={{ color: role.color }} />
                  </span>
                  <p className="text-sm">{a}</p>
                </div>
              ))}
            </div>

            <Link
              href={getScreenRoute(role.key, s.id)}
              className="flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-bold transition-opacity hover:opacity-80"
              style={{ borderColor: role.color, color: role.color, backgroundColor: `${role.color}10` }}
            >
              Open this screen
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>

      <Link
        href="/help/chat"
        className="flex items-center justify-center gap-2 rounded-xl border bg-card p-4 text-sm font-semibold transition-colors hover:bg-accent"
        style={{ borderColor: role.color }}
      >
        <Sparkles className="h-4 w-4" style={{ color: role.color }} />
        Still stuck? Ask the AI assistant
      </Link>
    </div>
  );
}
