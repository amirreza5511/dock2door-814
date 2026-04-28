"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";

interface CompanyRow {
  id: string;
  name: string;
  type: string;
  status: string;
  created_at: string;
  owner_user_id: string;
}

export default function AdminCompaniesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const companiesQuery = useQuery({
    queryKey: ["admin", "companies", search],
    queryFn: async () => {
      let q = supabase
        .from("companies")
        .select("id,name,type,status,created_at,owner_user_id")
        .order("created_at", { ascending: false })
        .limit(100);
      if (search) q = q.ilike("name", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CompanyRow[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_set_company_status", {
        company_id: input.id,
        new_status: input.status,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "companies"] }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">Approve, suspend, or reinstate tenant companies.</p>
        </div>
        <Input
          className="w-64"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All companies</CardTitle>
          <CardDescription>{companiesQuery.data?.length ?? 0} shown</CardDescription>
        </CardHeader>
        <CardContent>
          {companiesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : companiesQuery.error ? (
            <p className="text-sm text-red-600">{(companiesQuery.error as Error).message}</p>
          ) : (companiesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No companies yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(companiesQuery.data ?? []).map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.name}</TD>
                    <TD>{c.type}</TD>
                    <TD>
                      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                    </TD>
                    <TD>{formatDate(c.created_at)}</TD>
                    <TD className="text-right">
                      <ActionButtons
                        status={c.status}
                        onAction={(action) => {
                          const reason = window.prompt(`Reason for ${action}?`);
                          if (!reason) return;
                          const next = action === "approve" ? "Approved" : action === "suspend" ? "Suspended" : "Approved";
                          setStatus.mutate({ id: c.id, status: next, reason });
                        }}
                        disabled={setStatus.isPending}
                      />
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

function ActionButtons({
  status,
  onAction,
  disabled,
}: {
  status: string;
  onAction: (a: "approve" | "suspend" | "reinstate") => void;
  disabled: boolean;
}) {
  if (status === "PendingApproval") {
    return (
      <Button size="sm" disabled={disabled} onClick={() => onAction("approve")}>
        Approve
      </Button>
    );
  }
  if (status === "Suspended") {
    return (
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onAction("reinstate")}>
        Reinstate
      </Button>
    );
  }
  return (
    <Button size="sm" variant="destructive" disabled={disabled} onClick={() => onAction("suspend")}>
      Suspend
    </Button>
  );
}

function statusVariant(status: string): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "Approved":
      return "success";
    case "PendingApproval":
      return "warning";
    case "Suspended":
      return "destructive";
    default:
      return "secondary";
  }
}
