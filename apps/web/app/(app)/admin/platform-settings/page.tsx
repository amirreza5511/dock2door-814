"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PlatformSettings {
  id: string;
  warehouse_commission_percentage: number;
  service_commission_percentage: number;
  labour_commission_percentage: number;
  handling_fee_per_pallet_default: number;
  tax_mode: string;
  updated_at: string;
}

const TAX_MODES = ["GST+PST", "HST", "GST_only", "none"] as const;

export default function PlatformSettingsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    warehouse_commission_percentage: 8,
    service_commission_percentage: 20,
    labour_commission_percentage: 15,
    handling_fee_per_pallet_default: 12,
    tax_mode: "GST+PST",
  });

  const settingsQ = useQuery({
    queryKey: ["admin", "platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("*")
        .limit(1)
        .single();
      if (error) throw error;
      return data as PlatformSettings;
    },
  });

  useEffect(() => {
    if (settingsQ.data) {
      const d = settingsQ.data;
      setForm({
        warehouse_commission_percentage: Number(d.warehouse_commission_percentage),
        service_commission_percentage: Number(d.service_commission_percentage),
        labour_commission_percentage: Number(d.labour_commission_percentage),
        handling_fee_per_pallet_default: Number(d.handling_fee_per_pallet_default),
        tax_mode: d.tax_mode,
      });
    }
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_update_platform_settings", {
        p_warehouse_commission_percentage: form.warehouse_commission_percentage,
        p_service_commission_percentage: form.service_commission_percentage,
        p_labour_commission_percentage: form.labour_commission_percentage,
        p_handling_fee_per_pallet_default: form.handling_fee_per_pallet_default,
        p_tax_mode: form.tax_mode,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "platform-settings"] }),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  if (settingsQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>;
  if (settingsQ.error) return <div className="p-6 text-sm text-red-600">{(settingsQ.error as Error).message}</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure global platform fees, commissions, and tax settings.
          Last updated: {settingsQ.data?.updated_at ? new Date(settingsQ.data.updated_at).toLocaleString("en-CA") : "—"}
        </p>
      </div>

      {save.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(save.error as Error).message}
        </div>
      )}
      {save.isSuccess && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          Settings saved successfully.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Commission rates</CardTitle>
          <CardDescription>Platform fees deducted from each transaction type.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Warehouse commission (%)</Label>
              <Input type="number" min={0} max={100} step={0.5}
                value={form.warehouse_commission_percentage} onChange={set("warehouse_commission_percentage")} />
              <p className="text-xs text-muted-foreground">Applied to warehouse booking revenue.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Service commission (%)</Label>
              <Input type="number" min={0} max={100} step={0.5}
                value={form.service_commission_percentage} onChange={set("service_commission_percentage")} />
              <p className="text-xs text-muted-foreground">Applied to service job revenue.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Labour commission (%)</Label>
              <Input type="number" min={0} max={100} step={0.5}
                value={form.labour_commission_percentage} onChange={set("labour_commission_percentage")} />
              <p className="text-xs text-muted-foreground">Applied to shift/labour revenue.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Handling &amp; tax</CardTitle>
          <CardDescription>Default fees and tax calculation mode.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Default handling fee per pallet ($)</Label>
              <Input type="number" min={0} step={0.5}
                value={form.handling_fee_per_pallet_default} onChange={set("handling_fee_per_pallet_default")} />
              <p className="text-xs text-muted-foreground">Pre-filled on new warehouse listings.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Tax mode</Label>
              <select value={form.tax_mode} onChange={set("tax_mode")}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                {TAX_MODES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Applied to invoices platform-wide.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current rates summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            {[
              { label: "Warehouse", value: `${form.warehouse_commission_percentage}%` },
              { label: "Services", value: `${form.service_commission_percentage}%` },
              { label: "Labour", value: `${form.labour_commission_percentage}%` },
              { label: "Handling / pallet", value: `$${Number(form.handling_fee_per_pallet_default).toFixed(2)}` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-muted/30 p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
