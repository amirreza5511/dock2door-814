"use client";

import { useState } from "react";
import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type ActionModal =
  | { kind: "status"; user: ProfileRow; next: string }
  | { kind: "admin"; user: ProfileRow }
  | null;

/** Fetch page size — cursor-based load-more means no hard ceiling. */
const PAGE_SIZE = 200;

function statusVariant(status: string | null): "success" | "destructive" | "warning" | "secondary" {
  if (status === "Active") return "success";
  if (status === "Suspended") return "destructive";
  if (status === "Inactive") return "warning";
  return "secondary";
}

export default function AdminUsersPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [actionReason, setActionReason] = useState("");

  /**
   * Cursor-based infinite query.
   * Each page fetches the next PAGE_SIZE rows ordered by created_at DESC,
   * starting after the last created_at from the previous page.
   * Invalidation (after suspend/role change) resets back to page 1.
   */
  const usersQuery = useInfiniteQuery({
    queryKey: ["admin", "users"],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      let q = supabase
        .from("profiles")
        .select("id, email, name, role, company_id, status, profile_image, created_at, companies(name)")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) {
        q = q.lt("created_at", pageParam);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((u: any) => ({
        ...u,
        company_name: u.companies?.name ?? null,
      })) as ProfileRow[];
    },
    getNextPageParam: (lastPage: ProfileRow[]) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at ?? undefined;
    },
  });

  const allUsers = usersQuery.data?.pages.flat() ?? [];

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
      const { error } = await supabase.rpc("admin_grant_role", {
        p_user_id: input.user_id,
        p_role: input.role,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const handleConfirm = () => {
    if (!actionModal) return;
    const reason = actionReason.trim();
    if (!reason) return;
    if (actionModal.kind === "status") {
      setStatus.mutate(
        { user_id: actionModal.user.id, status: actionModal.next, reason },
        { onSuccess: () => setActionModal(null) },
      );
    } else {
      grantRole.mutate(
        { user_id: actionModal.user.id, role: "admin", reason },
        { onSuccess: () => setActionModal(null) },
      );
    }
  };

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
      render: (u) =>
        u.role ? (
          <Badge variant="secondary">{u.role}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
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
      render: (u) => (
        <span className="text-xs text-muted-foreground">{formatDate(u.created_at)}</span>
      ),
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
              setActionModal({ kind: "status", user: u, next });
              setActionReason("");
            }}
          >
            {u.status === "Suspended" ? "Reinstate" : "Suspend"}
          </Button>
          {u.role !== "Admin" && u.role !== "SuperAdmin" && (
            <Button
              size="sm"
              variant="outline"
              disabled={grantRole.isPending}
              onClick={() => { setActionModal({ kind: "admin", user: u }); setActionReason(""); }}
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
      {/* Inline reason modal — replaces window.prompt */}
      {actionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setActionModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-base">
              {actionModal.kind === "status"
                ? `${actionModal.next === "Active" ? "Reinstate" : "Suspend"} user`
                : "Grant admin role"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {actionModal.kind === "status"
                ? `${actionModal.next === "Active" ? "Reinstate" : "Suspend"} ${actionModal.user.name || actionModal.user.email}?`
                : `Grant admin role to ${actionModal.user.name || actionModal.user.email}?`}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="user-action-reason">Reason *</Label>
              <Input
                id="user-action-reason"
                placeholder="Required — will be recorded in audit log"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                autoFocus
              />
            </div>
            {(setStatus.error || grantRole.error) && (
              <p className="text-sm text-red-600">
                {((setStatus.error ?? grantRole.error) as Error).message}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setActionModal(null)}>
                Cancel
              </Button>
              <Button
                variant={
                  actionModal.kind === "status" && actionModal.next === "Suspended"
                    ? "destructive"
                    : "default"
                }
                className="flex-1"
                disabled={!actionReason.trim() || setStatus.isPending || grantRole.isPending}
                onClick={handleConfirm}
              >
                {setStatus.isPending || grantRole.isPending ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          All platform users. Suspend/reinstate via audited RPC.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All profiles</CardTitle>
          <CardDescription>
            {allUsers.length} users loaded
            {usersQuery.hasNextPage ? " — more available" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            rows={allUsers}
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

          {usersQuery.hasNextPage && (
            <div className="flex items-center justify-center gap-3 border-t pt-4">
              <span className="text-sm text-muted-foreground">
                Showing {allUsers.length} users
              </span>
              <Button
                variant="secondary"
                onClick={() => usersQuery.fetchNextPage()}
                disabled={usersQuery.isFetchingNextPage}
              >
                {usersQuery.isFetchingNextPage ? "Loading…" : "Load more users"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
