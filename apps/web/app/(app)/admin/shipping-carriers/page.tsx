"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { Truck } from "lucide-react";

/**
 * Admin › Platform Carriers. Web mirror of expo/app/admin/shipping-carriers.tsx
 * (CarrierAccountsManager scope="platform"). Supabase-direct port of the
 * carriers.list / upsert / delete tRPC procedures against carrier_accounts
 * (scope = 'platform', company_id = null) via the upsert_carrier_account RPC.
 * These are the Dock2Door-level fallback shipping accounts for all companies.
 */

interface CarrierAccountRow {
  id: string;
  carrier_code: string;
  display_name: string | null;
  account_number: string | null;
  mode: string | null;
  is_active: boolean;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
}

// carriers.supported() from the mobile tRPC router.
const SUPPORTED: { code: string; name: string; mode: "aggregator" | "direct"; requires: string[] }[] = [
  { code: "EASYPOST", name: "EasyPost", mode: "aggregator", requires: ["api_key"] },
  { code: "SHIPPO", name: "Shippo", mode: "aggregator", requires: ["api_key"] },
  { code: "CANADA_POST", name: "Canada Post", mode: "direct", requires: ["username", "password", "customer_number"] },
  { code: "UPS", name: "UPS", mode: "direct", requires: ["client_id", "client_secret", "account_number"] },
  { code: "DHL", name: "DHL Express", mode: "direct", requires: ["username", "password", "account_number"] },
  { code: "FEDEX", name: "FedEx", mode: "direct", requires: ["client_id", "client_secret", "account_number"] },
];

function carrierName(code: string) {
  return SUPPORTED.find((c) => c.code === code.toUpperCase())?.name ?? code;
}

export default function AdminShippingCarriersPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState({ carrier_code: "EASYPOST", display_name: "", account_number: "", mode: "test", credentials_secret_ref: "" });

  const listQ = useQuery({
    queryKey: ["admin", "platform-carriers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("carrier_accounts")
        .select("id,carrier_code,display_name,account_number,mode,is_active,last_verified_at,last_error,created_at")
        .eq("scope", "platform")
        .order("carrier_code");
      if (error) throw error;
      return (data ?? []) as CarrierAccountRow[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "platform-carriers"] });

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("upsert_carrier_account", {
        p_id: null,
        p_company_id: null,
        p_scope: "platform",
        p_carrier_code: form.carrier_code.toUpperCase(),
        p_display_name: form.display_name.trim(),
        p_account_number: form.account_number.trim(),
        p_mode: form.mode,
        p_credentials_secret_ref: form.credentials_secret_ref.trim(),
        p_data: {},
        p_is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setShowAdd(false);
      setForm({ carrier_code: "EASYPOST", display_name: "", account_number: "", mode: "test", credentials_secret_ref: "" });
    },
  });

  const toggleMut = useMutation({
    mutationFn: async (row: CarrierAccountRow) => {
      const { error } = await supabase.rpc("upsert_carrier_account", {
        p_id: row.id,
        p_company_id: null,
        p_scope: "platform",
        p_carrier_code: row.carrier_code.toUpperCase(),
        p_display_name: row.display_name ?? "",
        p_account_number: row.account_number ?? "",
        p_mode: row.mode ?? "test",
        p_credentials_secret_ref: "",
        p_data: {},
        p_is_active: !row.is_active,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("carrier_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { setDeleteTarget(null); invalidate(); },
  });

  const selected = SUPPORTED.find((c) => c.code === form.carrier_code);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform Carriers</h1>
          <p className="text-sm text-muted-foreground">Dock2Door-level shipping accounts — the fallback for every company.</p>
        </div>
        <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Cancel" : "+ Add carrier"}</Button>
      </div>

      {showAdd && (
        <Card>
          <CardHeader><CardTitle>Add platform carrier</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {addMut.error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(addMut.error as Error).message}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Carrier</Label>
                <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={form.carrier_code} onChange={(e) => setForm((f) => ({ ...f, carrier_code: e.target.value }))}>
                  {SUPPORTED.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.mode})</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Mode</Label>
                <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}>
                  <option value="test">Test</option>
                  <option value="live">Live</option>
                </select>
              </div>
              <div className="space-y-1"><Label>Display name (optional)</Label><Input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="e.g. Platform EasyPost" /></div>
              <div className="space-y-1"><Label>Account number (optional)</Label><Input value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} placeholder="Carrier account #" /></div>
              <div className="space-y-1 sm:col-span-2"><Label>Credentials secret ref (optional)</Label><Input value={form.credentials_secret_ref} onChange={(e) => setForm((f) => ({ ...f, credentials_secret_ref: e.target.value }))} placeholder="Supabase secret key holding API credentials" /></div>
            </div>
            {selected && <p className="text-xs text-muted-foreground">Requires: {selected.requires.join(", ")} — stored server-side via Supabase secrets, referenced above.</p>}
            <Button disabled={addMut.isPending} onClick={() => addMut.mutate()}>{addMut.isPending ? "Adding…" : "Add carrier"}</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Platform carrier accounts</CardTitle>
          <CardDescription>{listQ.data?.length ?? 0} accounts</CardDescription>
        </CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
          ) : listQ.error ? (
            <p className="py-4 text-center text-sm text-red-600">{(listQ.error as Error).message}</p>
          ) : (listQ.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Truck className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No platform carriers yet.</p>
              <p className="text-xs text-muted-foreground">Add one to give every company a shipping fallback.</p>
            </div>
          ) : (
            <Table>
              <THead><TR><TH>Carrier</TH><TH>Mode</TH><TH>Account #</TH><TH>Status</TH><TH>Added</TH><TH className="text-right">Actions</TH></TR></THead>
              <TBody>
                {(listQ.data ?? []).map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{carrierName(c.carrier_code)}{c.display_name ? <span className="text-muted-foreground"> · {c.display_name}</span> : null}</TD>
                    <TD><Badge variant={c.mode === "live" ? "success" : "secondary"}>{c.mode ?? "test"}</Badge></TD>
                    <TD className="font-mono text-sm">{c.account_number || "—"}</TD>
                    <TD><Badge variant={c.is_active ? "success" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge></TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(c.created_at)}</TD>
                    <TD className="space-x-2 text-right">
                      <Button size="sm" variant="outline" disabled={toggleMut.isPending} onClick={() => toggleMut.mutate(c)}>{c.is_active ? "Deactivate" : "Activate"}</Button>
                      {deleteTarget === c.id ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Remove?</span>
                          <Button size="sm" variant="destructive" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(c.id)}>Yes</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>No</Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(c.id)}>Remove</Button>
                      )}
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
