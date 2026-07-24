"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const SAMPLE_MEMBERS: MemberRow[] = [
  { company_id: "explore-company", user_id: "ex-m-1", role: "owner", name: "Alex Morgan" },
  { company_id: "explore-company", user_id: "ex-m-2", role: "manager", name: "Priya Sharma" },
  { company_id: "explore-company", user_id: "ex-m-3", role: "receiver", name: "Marcus Lee" },
  { company_id: "explore-company", user_id: "ex-m-4", role: "picker", name: "Dan Kowalski" },
  { company_id: "explore-company", user_id: "ex-m-5", role: "dock", name: "Sofia Reyes" },
];
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MemberRow {
  company_id: string;
  user_id: string;
  role: string;
  name: string | null;
}

const ROLES = ["owner", "manager", "supervisor", "receiver", "picker", "packer", "shipping", "inventory", "dock", "viewer"];

export default function WarehouseStaffPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [removePending, setRemovePending] = useState<MemberRow | null>(null);
  const [removeReason, setRemoveReason] = useState("");

  const myCompaniesQuery = useQuery({
    queryKey: ["my_companies"],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_companies");
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
  const companyId = isExploring ? "explore-company" : myCompaniesQuery.data?.[0];

  const membersQuery = useQuery({
    queryKey: ["company_members", companyId],
    enabled: !!companyId && !isExploring,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_users")
        .select("company_id, user_id, role, profiles!inner(name)")
        .eq("company_id", companyId!);
      if (error) throw error;
      type Row = { company_id: string; user_id: string; role: string; profiles: { name: string | null } | { name: string | null }[] | null };
      return (data as Row[] | null ?? []).map((r) => ({
        company_id: r.company_id,
        user_id: r.user_id,
        role: r.role,
        name: Array.isArray(r.profiles) ? r.profiles[0]?.name ?? null : r.profiles?.name ?? null,
      })) as MemberRow[];
    },
  });

  const addMember = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("company_add_member", {
        p_company_id: companyId,
        p_user_email: email,
        p_role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["company_members", companyId] });
    },
  });

  const removeMember = useMutation({
    mutationFn: async (input: { user_id: string; reason: string }) => {
      const { error } = await supabase.rpc("company_remove_member", {
        p_company_id: companyId,
        p_user_id: input.user_id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company_members", companyId] }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>

      <Card>
        <CardHeader>
          <CardTitle>Invite member</CardTitle>
          <CardDescription>User must already have a Dock2Door account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!guard("Invite a team member")) return;
              if (!companyId) return;
              addMember.mutate();
            }}
            className="grid gap-3 md:grid-cols-[1fr_180px_auto]"
          >
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={addMember.isPending || !companyId}>
                Add member
              </Button>
            </div>
          </form>
          {addMember.error && (
            <p className="mt-3 text-sm text-red-600">{(addMember.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>{(isExploring ? SAMPLE_MEMBERS : membersQuery.data ?? []).length} members</CardDescription>
        </CardHeader>
        <CardContent>
          {!isExploring && membersQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !companyId ? (
            <p className="text-sm text-muted-foreground">You don&apos;t belong to any company.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Role</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(isExploring ? SAMPLE_MEMBERS : membersQuery.data ?? []).map((m) => (
                  <TR key={m.user_id}>
                    <TD className="font-medium">{m.name ?? m.user_id.slice(0, 8)}</TD>
                    <TD>{m.role}</TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => { if (!guard("Remove a team member")) return; setRemovePending(m); setRemoveReason(""); }}
                      >
                        Remove
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {removePending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRemovePending(null)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-base">Remove member</h3>
            <p className="text-sm text-muted-foreground">
              Remove <span className="font-medium">{removePending.name ?? removePending.user_id.slice(0, 8)}</span> ({removePending.role}) from your company?
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="remove-reason">Reason *</label>
              <input
                id="remove-reason"
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm"
                placeholder="e.g. left the company, role change…"
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
              />
            </div>
            {removeMember.error && (
              <p className="text-sm text-red-600">{(removeMember.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRemovePending(null)}>Cancel</Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!removeReason.trim() || removeMember.isPending}
                onClick={() => {
                  removeMember.mutate(
                    { user_id: removePending.user_id, reason: removeReason.trim() },
                    { onSuccess: () => setRemovePending(null) },
                  );
                }}
              >
                {removeMember.isPending ? "Removing…" : "Remove"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
