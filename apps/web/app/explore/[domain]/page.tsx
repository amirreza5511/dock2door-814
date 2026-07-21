"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Compass, ArrowRight, Building2, CheckCircle2, UserPlus } from "lucide-react";
import { DOMAIN_MAP, DOMAIN_ACCENT, type Domain } from "@/lib/explore-catalog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const VALID: Domain[] = ["labour", "logistics", "freight", "drayage", "marketplace", "globalfreight"];

export default function DomainIntroPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain: domainParam } = use(params);
  const domainKey = domainParam as Domain;
  if (!VALID.includes(domainKey)) notFound();
  const domain = DOMAIN_MAP[domainKey];
  const accent = DOMAIN_ACCENT[domain.key];

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <Link href="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <div className={`mb-8 rounded-2xl border p-6 ${accent}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
          {domain.badge} · {domain.tagline}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">{domain.title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{domain.desc}</p>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What you can do</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {domain.features.map((f) => (
            <Card key={f.title}>
              <CardContent className="space-y-2 py-4">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <p className="font-semibold">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles in this world</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Create a free account to start working in any role — or browse the directory first.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {domain.roles.map((r) => (
            <Card key={r.role}>
              <CardContent className="flex items-center gap-3 py-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${accent}`}>
                  <Compass className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.label}</p>
                  <p className="text-sm text-muted-foreground">{r.desc}</p>
                </div>
                <Link href={`/login?next=/dashboard`}>
                  <Button size="sm" variant="secondary">Start</Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/directory" className="flex-1">
          <Button variant="secondary" className="w-full gap-2">
            <Building2 className="h-4 w-4" /> Browse companies & jobs
          </Button>
        </Link>
        <Link href="/login" className="flex-1">
          <Button className="w-full gap-2">
            <UserPlus className="h-4 w-4" /> Create a free account <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
