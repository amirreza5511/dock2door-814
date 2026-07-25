"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useMyCompanies } from "@/lib/hooks/use-active-company";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Search, Building2, Star, MapPin, Handshake, Check, X, Clock, Send, Inbox, Loader2,
} from "lucide-react";
import { ROLE_LABEL, domainForRole, isBusinessRole, roleForCompanyType } from "@/lib/relationships";
import type { UserRole } from "@/lib/types";

const DOMAIN_ACCENT: Record<string, string> = {
  labour: "text-purple-300 bg-purple-500/10 border-purple-400/30",
  logistics: "text-teal-300 bg-teal-500/10 border-teal-400/30",
  freight: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  drayage: "text-blue-300 bg-blue-500/10 border-blue-400/30",
};

type Tab = "browse" | "partners" | "requests";

interface PartnerRow {
  company_id: string; name: string; city: string | null; primary_type: string;
  held_roles: string[]; rating: number; review_count: number;
  connection_id: string | null; connection_status: string | null; connection_direction: string | null;
}
interface ConnectionRow {
  connection_id: string; other_company_id: string; other_name: string; other_type: string;
  other_city: string | null; status: string; direction: string; note: string; created_at: string;
}

function accentFor(type: string): string {
  return DOMAIN_ACCENT[domainForRole(type as UserRole) ?? "logistics"];
}

export default function PartnersPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { data: companies, isLoading: companiesLoading } = useMyCompanies();
  const [tab, setTab] = useState<Tab>("browse");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const company = useMemo(
    () => (companies ?? []).find((c) => isBusinessRole(roleForCompanyType(c.company_type))) ?? (companies ?? [])[0],
    [companies],
  );
  const companyId = company?.company_id;
  const isBusiness = isBusinessRole(roleForCompanyType(company?.company_type));

  const partnersQ = useQuery({
    queryKey: ["partners", "directory", companyId ?? "none", roleFilter ?? "", search],
    enabled: Boolean(companyId) && isBusiness && tab === "browse",
    queryFn: async (): Promise<PartnerRow[]> => {
      const { data, error } = await supabase.rpc("list_partner_companies", {
        p_company_id: companyId, p_role_filter: roleFilter, p_search: search.trim() || null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as PartnerRow[];
    },
  });

  const connectionsQ = useQuery({
    queryKey: ["partners", "connections", companyId ?? "none"],
    enabled: Boolean(companyId) && isBusiness,
    queryFn: async (): Promise<ConnectionRow[]> => {
      const { data, error } = await supabase.rpc("my_connections", { p_company_id: companyId });
      if (error) throw new Error(error.message);
      return (data ?? []) as ConnectionRow[];
    },
  });

  const roleFilters = useMemo<UserRole[]>(() => {
    const set = new Set<UserRole>();
    for (const p of partnersQ.data ?? []) set.add(p.primary_type as UserRole);
    return Array.from(set);
  }, [partnersQ.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["partners"] });

  const sendMut = useMutation({
    mutationFn: async (targetId: string) => {
      const { error } = await supabase.rpc("send_connection_request", {
        p_from_company_id: companyId, p_to_company_id: targetId, p_note: "",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const respondMut = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc("respond_connection_request", { p_connection_id: id, p_accept: accept });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const accepted = (connectionsQ.data ?? []).filter((c) => c.status === "Accepted");
  const incoming = (connectionsQ.data ?? []).filter((c) => c.status === "Pending" && c.direction === "incoming");
  const outgoing = (connectionsQ.data ?? []).filter((c) => c.status === "Pending" && c.direction === "outgoing");

  if (companiesLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!isBusiness) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">Partners are for businesses</p>
          <p className="text-sm text-muted-foreground">Individual accounts work through the businesses that hire them.</p>
        </CardContent></Card>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: typeof Building2; count?: number }[] = [
    { id: "browse", label: "Browse", icon: Search },
    { id: "partners", label: "My partners", icon: Handshake, count: accepted.length },
    { id: "requests", label: "Requests", icon: Inbox, count: incoming.length },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Handshake className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Partners</h1>
          <p className="text-sm text-muted-foreground">Find and connect with companies you can work with.</p>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />{label}
            {count ? <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{count}</span> : null}
          </button>
        ))}
      </div>

      {/* BROWSE */}
      {tab === "browse" && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name or city…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {roleFilters.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip label="All" active={roleFilter === null} onClick={() => setRoleFilter(null)} />
              {roleFilters.map((r) => (
                <FilterChip key={r} label={ROLE_LABEL[r] ?? r} active={roleFilter === r} onClick={() => setRoleFilter(r)} />
              ))}
            </div>
          )}

          {partnersQ.isLoading ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
          ) : (partnersQ.data ?? []).length === 0 ? (
            <EmptyState icon={Building2} title="No companies yet" text="No compatible partners match right now. Try a different search or check back soon." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(partnersQ.data ?? []).map((p) => (
                <PartnerCard
                  key={p.company_id}
                  partner={p}
                  sending={sendMut.isPending}
                  onConnect={() => { setError(null); sendMut.mutate(p.company_id); }}
                  onAccept={() => p.connection_id && respondMut.mutate({ id: p.connection_id, accept: true })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* MY PARTNERS */}
      {tab === "partners" && (
        connectionsQ.isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : accepted.length === 0 ? (
          <EmptyState icon={Handshake} title="No partners yet" text="Connect with companies from the Browse tab. Accepted partners show up here." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {accepted.map((c) => <ConnectionCard key={c.connection_id} conn={c} />)}
          </div>
        )
      )}

      {/* REQUESTS */}
      {tab === "requests" && (
        connectionsQ.isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : incoming.length === 0 && outgoing.length === 0 ? (
          <EmptyState icon={Inbox} title="No pending requests" text="Connection requests you send or receive appear here." />
        ) : (
          <div className="space-y-6">
            {incoming.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Incoming</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {incoming.map((c) => (
                    <ConnectionCard
                      key={c.connection_id}
                      conn={c}
                      actions={
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ id: c.connection_id, accept: false })}>
                            <X className="mr-1 h-4 w-4" />Decline
                          </Button>
                          <Button size="sm" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ id: c.connection_id, accept: true })}>
                            <Check className="mr-1 h-4 w-4" />Accept
                          </Button>
                        </div>
                      }
                    />
                  ))}
                </div>
              </div>
            )}
            {outgoing.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sent</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {outgoing.map((c) => (
                    <ConnectionCard
                      key={c.connection_id}
                      conn={c}
                      actions={<Badge variant="outline" className="gap-1 border-amber-300 text-amber-600"><Clock className="h-3 w-3" />Pending</Badge>}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function PartnerCard({ partner, sending, onConnect, onAccept }: {
  partner: PartnerRow; sending: boolean; onConnect: () => void; onAccept: () => void;
}) {
  const accent = accentFor(partner.primary_type);
  const { connection_status: status, connection_direction: direction } = partner;
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${accent}`}>
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{partner.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={`rounded border px-1.5 py-0.5 font-semibold ${accent}`}>{ROLE_LABEL[partner.primary_type as UserRole] ?? partner.primary_type}</span>
              {partner.city && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{partner.city}</span>}
              {partner.review_count > 0 && <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 text-amber-500" />{partner.rating.toFixed(1)}</span>}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          {status === "Accepted" ? (
            <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-600"><Check className="h-3 w-3" />Connected</Badge>
          ) : status === "Pending" && direction === "incoming" ? (
            <Button size="sm" onClick={onAccept}><Check className="mr-1 h-4 w-4" />Accept request</Button>
          ) : status === "Pending" ? (
            <Badge variant="outline" className="gap-1 border-amber-300 text-amber-600"><Clock className="h-3 w-3" />Requested</Badge>
          ) : (
            <Button size="sm" disabled={sending} onClick={onConnect}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1 h-4 w-4" />Connect</>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionCard({ conn, actions }: { conn: ConnectionRow; actions?: React.ReactNode }) {
  const accent = accentFor(conn.other_type);
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${accent}`}>
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{conn.other_name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={`rounded border px-1.5 py-0.5 font-semibold ${accent}`}>{ROLE_LABEL[conn.other_type as UserRole] ?? conn.other_type}</span>
              {conn.other_city && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{conn.other_city}</span>}
            </div>
            {conn.note && <p className="mt-2 text-sm italic text-muted-foreground">“{conn.note}”</p>}
          </div>
        </div>
        {actions && <div className="flex justify-end">{actions}</div>}
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Building2; title: string; text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="font-semibold">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
