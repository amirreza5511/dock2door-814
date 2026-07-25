"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useMyCompanies } from "@/lib/hooks/use-active-company";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Layers, Plus, Clock, ShieldCheck, Loader2 } from "lucide-react";
import {
  ROLE_LABEL, ROLE_BLURB, addableRolesFor, isBusinessRole, domainForRole, roleForCompanyType,
} from "@/lib/relationships";
import type { UserRole } from "@/lib/types";

const DOMAIN_ACCENT: Record<string, string> = {
  labour: "text-purple-300 bg-purple-500/10 border-purple-400/30",
  logistics: "text-teal-300 bg-teal-500/10 border-teal-400/30",
  freight: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  drayage: "text-blue-300 bg-blue-500/10 border-blue-400/30",
};

interface RoleRequestRow { requested_role: string; status: string; rejection_reason: string | null }

export default function AddRolePage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { data: companies, isLoading: companiesLoading } = useMyCompanies();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const company = useMemo(
    () => (companies ?? []).find((c) => isBusinessRole(roleForCompanyType(c.company_type))) ?? (companies ?? [])[0],
    [companies],
  );
  const companyId = company?.company_id;
  const primaryRole = roleForCompanyType(company?.company_type) as UserRole | null;

  const heldQ = useQuery({
    queryKey: ["company-roles", companyId ?? "none"],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<UserRole[]> => {
      const { data, error } = await supabase
        .from("company_roles").select("role,status").eq("company_id", companyId!).eq("status", "Active");
      if (error) throw new Error(error.message);
      return ((data ?? []) as { role: string }[]).map((r) => r.role as UserRole);
    },
  });

  const requestsQ = useQuery({
    queryKey: ["company-role-requests", companyId ?? "none"],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<RoleRequestRow[]> => {
      const { data, error } = await supabase
        .from("company_role_requests")
        .select("requested_role,status,rejection_reason")
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as RoleRequestRow[];
    },
  });

  const held = useMemo<UserRole[]>(() => {
    const set = new Set<UserRole>(heldQ.data ?? []);
    if (primaryRole) set.add(primaryRole);
    return Array.from(set);
  }, [heldQ.data, primaryRole]);

  const pendingByRole = useMemo(() => {
    const map: Record<string, RoleRequestRow> = {};
    for (const r of requestsQ.data ?? []) if (r.status === "Pending" && !map[r.requested_role]) map[r.requested_role] = r;
    return map;
  }, [requestsQ.data]);

  const addable = useMemo(() => addableRolesFor(primaryRole, held), [primaryRole, held]);

  const requestMut = useMutation({
    mutationFn: async (role: UserRole) => {
      const { error } = await supabase.rpc("request_company_role", { p_company_id: companyId, p_role: role, p_note: "" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company-role-requests", companyId ?? "none"] }),
    onError: (e: Error) => setError(e.message),
    onSettled: () => setSubmitting(null),
  });

  if (companiesLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!companyId || !isBusinessRole(primaryRole)) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card><CardContent className="py-8 text-sm text-muted-foreground">
          {companyId ? "Individual accounts have a single purpose and can’t add roles." : "Set up your company first to add roles."}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Layers className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Add another role</h1>
          <p className="text-sm text-muted-foreground">
            Expand what <span className="font-semibold text-foreground">{company?.company_name}</span> can do. Each addition is reviewed by an admin.
          </p>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Held roles */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your roles</p>
        <div className="flex flex-wrap gap-2">
          {held.map((r) => (
            <span key={r} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${DOMAIN_ACCENT[domainForRole(r) ?? "logistics"]}`}>
              <ShieldCheck className="h-3 w-3" />{ROLE_LABEL[r] ?? r}
            </span>
          ))}
        </div>
      </div>

      {/* Addable roles */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available to add</p>
        {heldQ.isLoading || requestsQ.isLoading ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : addable.length === 0 ? (
          <Card><CardContent className="py-6 text-sm text-muted-foreground">You already hold every role compatible with your business. 🎉</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {addable.map((role) => {
              const accent = DOMAIN_ACCENT[domainForRole(role) ?? "logistics"];
              const pending = pendingByRole[role];
              const busy = submitting === role;
              return (
                <Card key={role}>
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${accent}`}>
                      <Layers className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{ROLE_LABEL[role] ?? role}</p>
                      <p className="text-sm text-muted-foreground">{ROLE_BLURB[role] ?? ""}</p>
                    </div>
                    {pending ? (
                      <Badge variant="outline" className="gap-1 border-amber-300 text-amber-600">
                        <Clock className="h-3 w-3" />Pending
                      </Badge>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => { setError(null); setSubmitting(role); requestMut.mutate(role); }}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1 h-4 w-4" />Request</>}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {(requestsQ.data ?? []).some((r) => r.status === "Rejected") && (
        <Card>
          <CardContent className="space-y-1 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Previously declined</p>
            {(requestsQ.data ?? []).filter((r) => r.status === "Rejected").map((r, i) => (
              <p key={`${r.requested_role}-${i}`} className="text-sm text-muted-foreground">
                • {ROLE_LABEL[r.requested_role as UserRole] ?? r.requested_role}{r.rejection_reason ? ` — ${r.rejection_reason}` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">Approved roles appear in the role switcher at the top of your dashboard.</p>
    </div>
  );
}
