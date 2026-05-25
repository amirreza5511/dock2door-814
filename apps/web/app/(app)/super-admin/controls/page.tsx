"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

interface PlatformSettings {
  id: string;
  warehouse_commission_percentage: number;
  service_commission_percentage: number;
  labour_commission_percentage: number;
  handling_fee_per_pallet_default: number;
  tax_mode: string;
  updated_at: string | null;
  updated_by: string | null;
}

export default function SuperAdminControlsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ["super-admin", "platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select(
          "id,warehouse_commission_percentage,service_commission_percentage,labour_commission_percentage,handling_fee_per_pallet_default,tax_mode,updated_at,updated_by"
        )
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as PlatformSettings | null;
    },
  });

  const s = settingsQ.data;

  // Local edit state — only set when editing
  const [draft, setDraft] = useState<Partial<PlatformSettings>>({});
  const [editing, setEditing] = useState(false);

  const updateMut = useMutation({
    mutationFn: async (values: Partial<PlatformSettings>) => {
      if (!s) throw new Error("No settings row found");
      const { error } = await supabase.rpc("admin_update_platform_settings", {
        p_warehouse_commission_percentage: Number(
          values.warehouse_commission_percentage ?? s.warehouse_commission_percentage,
        ),
        p_service_commission_percentage: Number(
          values.service_commission_percentage ?? s.service_commission_percentage,
        ),
        p_labour_commission_percentage: Number(
          values.labour_commission_percentage ?? s.labour_commission_percentage,
        ),
        p_handling_fee_per_pallet_default: Number(
          values.handling_fee_per_pallet_default ?? s.handling_fee_per_pallet_default,
        ),
        p_tax_mode: String(values.tax_mode ?? s.tax_mode),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-admin", "platform-settings"] });
      setEditing(false);
      setDraft({});
    },
  });

  const startEdit = () => {
    if (!s) return;
    setDraft({
      warehouse_commission_percentage: s.warehouse_commission_percentage,
      service_commission_percentage: s.service_commission_percentage,
      labour_commission_percentage: s.labour_commission_percentage,
      handling_fee_per_pallet_default: s.handling_fee_per_pallet_default,
      tax_mode: s.tax_mode,
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft({});
  };

  const saveEdit = () => {
    const patch: Partial<PlatformSettings> = {};
    const numKeys = [
      "warehouse_commission_percentage",
      "service_commission_percentage",
      "labour_commission_percentage",
      "handling_fee_per_pallet_default",
    ] as const;
    for (const k of numKeys) {
      const v = Number(draft[k]);
      if (!isNaN(v)) patch[k] = v;
    }
    if (draft.tax_mode) patch.tax_mode = draft.tax_mode;
    updateMut.mutate(patch);
  };

  const fields: { label: string; key: keyof PlatformSettings; type: "percent" | "currency" | "text"; description: string }[] = [
    { label: "Warehouse commission", key: "warehouse_commission_percentage", type: "percent", description: "Platform fee charged on warehouse booking revenue." },
    { label: "Service commission", key: "service_commission_percentage", type: "percent", description: "Platform fee charged on service job revenue." },
    { label: "Labour commission", key: "labour_commission_percentage", type: "percent", description: "Platform fee charged on labour/shift revenue." },
    { label: "Default pallet handling fee", key: "handling_fee_per_pallet_default", type: "currency", description: "Default inbound/outbound handling fee per pallet when a listing doesn't set its own." },
    { label: "Tax mode", key: "tax_mode", type: "text", description: "Tax regime applied to invoices (e.g. GST+PST, HST, none)." },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform Controls</h1>
        <p className="text-sm text-muted-foreground">
          Commission rates, handling fees, and tax configuration. Changes take effect on the next invoice calculation.
        </p>
      </div>

      {settingsQ.error && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Could not load settings: {(settingsQ.error as Error).message}
        </div>
      )}
      {updateMut.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(updateMut.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Commission &amp; fee settings</CardTitle>
            <CardDescription>
              {s?.updated_at
                ? `Last updated ${formatDate(s.updated_at)}`
                : "No settings record found — run migrations to seed defaults."}
            </CardDescription>
          </div>
          {!editing && s && (
            <Button size="sm" variant="outline" onClick={startEdit}>
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {settingsQ.isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : !s ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No platform_settings row found. Apply migrations to seed defaults.
            </p>
          ) : (
            <div className="divide-y">
              {fields.map(({ label, key, type, description }) => (
                <div key={key} className="py-4 first:pt-0 last:pb-0 flex items-start justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                  </div>
                  <div className="shrink-0">
                    {editing ? (
                      type === "text" ? (
                        <Input
                          className="w-36 h-8 text-sm"
                          value={(draft[key] as string) ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          {type === "currency" && <span className="text-sm text-muted-foreground">$</span>}
                          <Input
                            className="w-24 h-8 text-sm"
                            type="number"
                            min={0}
                            step={type === "percent" ? 0.5 : 0.01}
                            value={(draft[key] as number) ?? 0}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                          />
                          {type === "percent" && <span className="text-sm text-muted-foreground">%</span>}
                        </div>
                      )
                    ) : (
                      <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
                        {type === "currency" && "$"}
                        {String(s[key])}
                        {type === "percent" && "%"}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {editing && (
                <div className="pt-4 flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={cancelEdit}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={updateMut.isPending}
                    onClick={saveEdit}
                  >
                    {updateMut.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
