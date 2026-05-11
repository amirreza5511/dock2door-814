"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  role: string | null;
  company_id: string | null;
  status: string | null;
  profile_image: string | null;
  created_at: string | null;
  company_name?: string | null;
}

function statusVariant(status: string | null): "success" | "destructive" | "warning" | "secondary" {
  if (status === "Active") return "success";
  if (status === "Suspended") return "destructive";
  if (status === "Inactive") return "warning";
  return "secondary";
}

export default function AdminUsersPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, name, role, company_id, status, profile_image, created_at, companies(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((u: any) => ({
        ...u,
        company_name: u.companies?.name ?? null,
      })) as ProfileRow[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (input: { user_id: string; status: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_set_user_status", {
        p_user_id: input.user_id,
        p_status: input.status,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const grantRole = useMutation({
    mutationFn: async (input: { user_id: string; role: string; reason: string }) => {
      // admin_grant_role requires p_reason (enforced by require_reason() inside the RPC)
      const { error } = await supabase.rpc("admin_grant_role", {
        p_user_id: input.user_id,
        p_role: input.role,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const cols: Column<ProfileRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (u) => (
        <div>
          <div className="font-medium">{u.name || "—"}</div>
          <div className="text-xs text-muted-foreground">{u.email}</div>
        </div>
      ),
      sortable: true,
      sortValue: (u) => u.name,
    },
    {
      key: "role",
      header: "Role",
      render: (u) => u.role ? <Badge variant="secondary">{u.role}</Badge> : <span className="text-muted-foreground">—</span>,
      sortable: true,
      sortValue: (u) => u.role,
    },
    {
      key: "company",
      header: "Company",
      render: (u) => <span className="text-sm">{u.company_name ?? "—"}</span>,
      sortable: true,
      sortValue: (u) => u.company_name ?? null,
    },
    {
      key: "status",
      header: "Status",
      render: (u) => (
        <Badge variant={statusVariant(u.status)}>{u.status ?? "Active"}</Badge>
      ),
      sortable: true,
      sortValue: (u) => u.status,
    },
    {
      key: "created",
      header: "Joined",
      render: (u) => <span className="text-xs text-muted-foreground">{formatDate(u.created_at)}</span>,
      sortable: true,
      sortValue: (u) => u.created_at,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (u) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant={u.status === "Suspended" ? "secondary" : "destructive"}
            disabled={setStatus.isPending}
            onClick={() => {
              const next = u.status === "Suspended" ? "Active" : "Suspended";
              const reason = window.prompt(
                `Reason for ${next === "Active" ? "reinstating" : "suspending"} ${u.name || u.email}?`
              );
              if (!reason) return;
              setStatus.mutate({ user_id: u.id, status: next, reason });
            }}
          >
            {u.status === "Suspended" ? "Reinstate" : "Suspend"}
          </Button>
          {u.role !== "Admin" && u.role !== "SuperAdmin" && (
            <Button
              size="sm"
              variant="outline"
              disabled={grantRole.isPending}
              onClick={() => {
                const reason = window.prompt(
                  `Reason for granting admin role to ${u.name || u.email}?`
                );
                if (!reason?.trim()) return;
                grantRole.mutate({ user_id: u.id, role: "admin", reason: reason.trim() });
              }}
            >
              Make Admin
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          All platform users. Suspend/reinstate via audited RPC.
        </p>
      </div>

      {setStatus.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(setStatus.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All profiles</CardTitle>
          <CardDescription>{usersQuery.data?.length ?? 0} users</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={usersQuery.data ?? []}
            columns={cols}
            rowKey={(u) => u.id}
            isLoading={usersQuery.isLoading}
            error={usersQuery.error as Error | null}
            searchPlaceholder="Search by name or email…"
            searchPredicate={(u, q) =>
              u.name?.toLowerCase().includes(q) ||
              u.email?.toLowerCase().includes(q) ||
              (u.company_name?.toLowerCase().includes(q) ?? false)
            }
            filters={[
              { value: "active", label: "Active", predicate: (u) => u.status === "Active" || !u.status },
              { value: "suspended", label: "Suspended", predicate: (u) => u.status === "Suspended" },
              { value: "Worker", label: "Workers", predicate: (u) => u.role === "Worker" },
              { value: "Employer", label: "Employers", predicate: (u) => u.role === "Employer" },
              { value: "WarehouseProvider", label: "WH Providers", predicate: (u) => u.role === "WarehouseProvider" },
            ]}
            emptyMessage="No users found."
          />
        </CardContent>
      </Card>
    </div>
  );
}
