"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface RoleRow {
  user_id: string;
  role: string;
}

const PLATFORM_ROLES = ["admin", "support", "finance", "super_admin"];

export default function PlatformRolesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("admin");
  const [revokeTarget, setRevokeTarget] = useState<RoleRow | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const q = useQuery({
    queryKey: ["super_admin", "roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role").order("user_id");
      if (error) throw error;
      return (data ?? []) as RoleRow[];
    },
  });

  const grant = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_grant_role", { p_user_email: email, p_role: role });
      if (error) throw error;
    },
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["super_admin", "roles"] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (input: { user_id: string; role: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_revoke_role", {
        p_user_id: input.user_id,
        p_role: input.role,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super_admin", "roles"] }),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Platform roles</h1>

      <Card>
        <CardHeader>
          <CardTitle>Grant role</CardTitle>
          <CardDescription>Assign platform-level role to an existing user.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              grant.mutate();
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
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {PLATFORM_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={grant.isPending}>
                Grant
              </Button>
            </div>
          </form>
          {grant.error && <p className="mt-3 text-sm text-red-600">{(grant.error as Error).message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current roles</CardTitle>
          <CardDescription>{q.data?.length ?? 0} bindings</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Role</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(q.data ?? []).map((r) => (
                  <TR key={`${r.user_id}-${r.role}`}>
                    <TD className="font-mono text-xs">{r.user_id.slice(0, 8)}</TD>
                    <TD>
                      <Badge>{r.role}</Badge>
                    </TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => { setRevokeTarget(r); setRevokeReason(""); }}
                      >
                        Revoke
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRevokeTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-base">Revoke platform role</h3>
            <p className="text-sm text-muted-foreground">
              Revoke <Badge>{revokeTarget.role}</Badge> from <span className="font-mono text-xs">{revokeTarget.user_id.slice(0, 8)}</span>?
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="revoke-reason">Reason *</Label>
              <Input
                id="revoke-reason"
                placeholder="Required — will be written to audit log"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && revokeReason.trim() && revoke.mutate(
                  { user_id: revokeTarget.user_id, role: revokeTarget.role, reason: revokeReason.trim() },
                  { onSuccess: () => setRevokeTarget(null) },
                )}
              />
            </div>
            {revoke.error && (
              <p className="text-sm text-red-600">{(revoke.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRevokeTarget(null)}>Cancel</Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!revokeReason.trim() || revoke.isPending}
                onClick={() =>
                  revoke.mutate(
                    { user_id: revokeTarget.user_id, role: revokeTarget.role, reason: revokeReason.trim() },
                    { onSuccess: () => setRevokeTarget(null) },
                  )
                }
              >
                {revoke.isPending ? "Revoking…" : "Revoke"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
