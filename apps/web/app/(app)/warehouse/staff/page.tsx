"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MemberRow {
  company_id: string;
  user_id: string;
  role: string;
  full_name: string | null;
}

const ROLES = ["owner", "manager", "supervisor", "receiver", "picker", "packer", "shipping", "inventory", "dock", "viewer"];

export default function WarehouseStaffPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("viewer");

  const myCompaniesQuery = useQuery({
    queryKey: ["my_companies"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_companies");
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
  const companyId = myCompaniesQuery.data?.[0];

  const membersQuery = useQuery({
    queryKey: ["company_members", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_users")
        .select("company_id, user_id, role, profiles!inner(full_name)")
        .eq("company_id", companyId!);
      if (error) throw error;
      type Row = { company_id: string; user_id: string; role: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null };
      return (data as Row[] | null ?? []).map((r) => ({
        company_id: r.company_id,
        user_id: r.user_id,
        role: r.role,
        full_name: Array.isArray(r.profiles) ? r.profiles[0]?.full_name ?? null : r.profiles?.full_name ?? null,
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
          <CardDescription>{membersQuery.data?.length ?? 0} members</CardDescription>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading ? (
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
                {(membersQuery.data ?? []).map((m) => (
                  <TR key={m.user_id}>
                    <TD className="font-medium">{m.full_name ?? m.user_id.slice(0, 8)}</TD>
                    <TD>{m.role}</TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          const reason = window.prompt("Reason?");
                          if (!reason) return;
                          removeMember.mutate({ user_id: m.user_id, reason });
                        }}
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
    </div>
  );
}
