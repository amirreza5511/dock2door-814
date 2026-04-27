"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  status: string | null;
  created_at: string | null;
}

export default function AdminUsersPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, phone, role, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (input: { user_id: string; status: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_set_user_status", {
        target_user_id: input.user_id,
        new_status: input.status,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">All platform users. Suspend or reinstate via audited RPC.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
          <CardDescription>{usersQuery.data?.length ?? 0} users</CardDescription>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : usersQuery.error ? (
            <p className="text-sm text-red-600">{(usersQuery.error as Error).message}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(usersQuery.data ?? []).map((u) => (
                  <TR key={u.user_id}>
                    <TD className="font-medium">{u.full_name ?? u.user_id.slice(0, 8)}</TD>
                    <TD>{u.role ?? "—"}</TD>
                    <TD>
                      <Badge variant={u.status === "Suspended" ? "destructive" : "success"}>
                        {u.status ?? "Active"}
                      </Badge>
                    </TD>
                    <TD>{formatDate(u.created_at)}</TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant={u.status === "Suspended" ? "secondary" : "destructive"}
                        disabled={setStatus.isPending}
                        onClick={() => {
                          const next = u.status === "Suspended" ? "Active" : "Suspended";
                          const reason = window.prompt(`Reason for ${next === "Active" ? "reinstate" : "suspend"}?`);
                          if (!reason) return;
                          setStatus.mutate({ user_id: u.user_id, status: next, reason });
                        }}
                      >
                        {u.status === "Suspended" ? "Reinstate" : "Suspend"}
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
