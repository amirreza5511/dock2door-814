"use client";

import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
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
      // Apply cursor for pages beyond the first.
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
      // If the page was full, there may be more rows after the oldest created_at.
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at ?? undefined;
    },
  });

  // Flatten all fetched pages into a single array for the DataTable.
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
    // Invalidating resets the infinite query back to page 1.
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
              const reason = window.prompt(
                `Reason for ${next === "Active" ? "reinstating" : "suspending"} ${u.name || u.email}?`,
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
                  `Reason for granting admin role to ${u.name || u.email}?`,
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
              {
                value: "active",
                label: "Active",
                predicate: (u) => u.status === "Active" || !u.status,
              },
              {
                value: "suspended",
                label: "Suspended",
                predicate: (u) => u.status === "Suspended",
              },
              {
                value: "Worker",
                label: "Workers",
                predicate: (u) => u.role === "Worker",
              },
              {
                value: "Employer",
                label: "Employers",
                predicate: (u) => u.role === "Employer",
              },
              {
                value: "WarehouseProvider",
                label: "WH Providers",
                predicate: (u) => u.role === "WarehouseProvider",
              },
            ]}
            emptyMessage="No users found."
          />

          {/* Cursor-based load-more — appears only when the server has more rows. */}
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
