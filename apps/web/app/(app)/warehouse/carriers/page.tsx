"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

interface CarrierAccountRow {
  id: string;
  carrier_code: string;
  account_number: string | null;
  nickname: string | null;
  is_active: boolean;
  created_at: string;
}

const CARRIER_OPTIONS = ["canada_post", "ups", "fedex", "dhl", "purolator", "easypost", "shippo"] as const;

function carrierLabel(code: string) {
  const map: Record<string, string> = {
    canada_post: "Canada Post",
    ups: "UPS",
    fedex: "FedEx",
    dhl: "DHL",
    purolator: "Purolator",
    easypost: "EasyPost",
    shippo: "Shippo",
  };
  return map[code] ?? code;
}

export default function WarehouseCarriersPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState({
    carrier_code: "canada_post",
    account_number: "",
    nickname: "",
  });

  const companyQ = useQuery({
    queryKey: ["warehouse", "carriers", "company"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: cu } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();
      return cu?.company_id ?? null;
    },
  });

  const carriersQ = useQuery({
    queryKey: ["warehouse", "carriers", "list"],
    queryFn: async () => {
      const companyId = companyQ.data;
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("carrier_accounts")
        .select("id,carrier_code,account_number,nickname,is_active,created_at")
        .eq("provider_company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CarrierAccountRow[];
    },
    enabled: Boolean(companyQ.data),
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const companyId = companyQ.data;
      if (!companyId) throw new Error("No company found");
      const { error } = await supabase.from("carrier_accounts").insert({
        provider_company_id: companyId,
        carrier_code: form.carrier_code,
        account_number: form.account_number.trim() || null,
        nickname: form.nickname.trim() || null,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse", "carriers", "list"] });
      setShowAdd(false);
      setForm({ carrier_code: "canada_post", account_number: "", nickname: "" });
    },
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("carrier_accounts")
        .update({ is_active: !is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouse", "carriers", "list"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("carrier_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouse", "carriers", "list"] }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Carrier Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Manage carrier integrations for rate shopping and label generation.
          </p>
        </div>
        <Button onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Cancel" : "+ Add carrier"}
        </Button>
      </div>

      {/* Add carrier form */}
      {showAdd && (
        <Card>
          <CardHeader>
            <CardTitle>Add carrier account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {addMut.error && (
              <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {(addMut.error as Error).message}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Carrier</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.carrier_code}
                  onChange={(e) => setForm((f) => ({ ...f, carrier_code: e.target.value }))}
                >
                  {CARRIER_OPTIONS.map((c) => (
                    <option key={c} value={c}>{carrierLabel(c)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Account number (optional)</Label>
                <Input
                  value={form.account_number}
                  onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
                  placeholder="Your carrier account #"
                />
              </div>
              <div className="space-y-1">
                <Label>Nickname (optional)</Label>
                <Input
                  value={form.nickname}
                  onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
                  placeholder="e.g. Main UPS account"
                />
              </div>
            </div>
            <Button disabled={addMut.isPending} onClick={() => addMut.mutate()}>
              {addMut.isPending ? "Adding…" : "Add carrier"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Carriers table */}
      <Card>
        <CardHeader>
          <CardTitle>Connected carriers</CardTitle>
          <CardDescription>{carriersQ.data?.length ?? 0} accounts</CardDescription>
        </CardHeader>
        <CardContent>
          {carriersQ.isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : (carriersQ.data ?? []).length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-muted-foreground">No carrier accounts added yet.</p>
              <p className="text-xs text-muted-foreground">
                Add a carrier to enable rate shopping and label generation.
              </p>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Carrier</TH>
                  <TH>Account #</TH>
                  <TH>Nickname</TH>
                  <TH>Status</TH>
                  <TH>Added</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(carriersQ.data ?? []).map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{carrierLabel(c.carrier_code)}</TD>
                    <TD className="font-mono text-sm">{c.account_number ?? "—"}</TD>
                    <TD className="text-sm text-muted-foreground">{c.nickname ?? "—"}</TD>
                    <TD>
                      <Badge variant={c.is_active ? "success" : "secondary"}>
                        {c.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(c.created_at)}</TD>
                    <TD className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={toggleMut.isPending}
                        onClick={() => toggleMut.mutate({ id: c.id, is_active: c.is_active })}
                      >
                        {c.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      {deleteTarget === c.id ? (
                        <div className="inline-flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Remove?</span>
                          <Button size="sm" variant="destructive" disabled={deleteMut.isPending}
                            onClick={() => deleteMut.mutate(c.id, { onSuccess: () => setDeleteTarget(null) })}>
                            Yes
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>No</Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deleteMut.isPending}
                          onClick={() => setDeleteTarget(c.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Help */}
      <Card className="border-dashed">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <strong>Tip:</strong> Carrier accounts are used for rate shopping (comparing labels across carriers)
            and manifest generation. API keys and carrier credentials are managed via Supabase secrets —
            contact your administrator to configure live carrier access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
