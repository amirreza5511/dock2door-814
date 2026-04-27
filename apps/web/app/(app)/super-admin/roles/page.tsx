"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
                        onClick={() => {
                          const reason = window.prompt("Reason?");
                          if (!reason) return;
                          revoke.mutate({ user_id: r.user_id, role: r.role, reason });
                        }}
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
    </div>
  );
}
