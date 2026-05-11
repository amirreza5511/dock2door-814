"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

interface PlatformSetting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

interface ControlSection {
  title: string;
  description: string;
  items: ControlItem[];
}

interface ControlItem {
  label: string;
  key: string;
  type: "toggle" | "text";
  description: string;
}

const CONTROL_SECTIONS: ControlSection[] = [
  {
    title: "Feature Flags",
    description: "Enable or disable platform features for all users.",
    items: [
      { label: "Stripe Connect enabled", key: "feature.stripe_connect", type: "toggle", description: "Allow warehouse providers to connect Stripe for payouts." },
      { label: "Rate shopping enabled", key: "feature.rate_shopping", type: "toggle", description: "Allow fulfillment users to compare carrier rates." },
      { label: "Sales channel sync enabled", key: "feature.channel_sync", type: "toggle", description: "Enable Shopify and Amazon order sync." },
      { label: "Worker work photos enabled", key: "feature.work_photos", type: "toggle", description: "Allow workers to upload work portfolio photos." },
      { label: "Push notifications enabled", key: "feature.push_notifications", type: "toggle", description: "Send Expo push notifications to mobile app users." },
    ],
  },
  {
    title: "Risk Controls",
    description: "Operational risk and abuse prevention settings.",
    items: [
      { label: "Max booking amount ($)", key: "risk.max_booking_amount", type: "text", description: "Maximum allowed booking total before manual review." },
      { label: "Max invoice amount ($)", key: "risk.max_invoice_amount", type: "text", description: "Maximum allowed invoice total before manual review." },
      { label: "New user booking lock (hours)", key: "risk.new_user_booking_lock_hours", type: "text", description: "Hours after signup before a new user can create bookings." },
    ],
  },
  {
    title: "Moderation Controls",
    description: "Content and user moderation thresholds.",
    items: [
      { label: "Auto-reject certifications past (days)", key: "moderation.cert_expiry_reject_days", type: "text", description: "Auto-reject certifications expiring within this many days." },
      { label: "Work photo review required", key: "moderation.work_photo_review_required", type: "toggle", description: "Require admin approval before work photos are visible." },
      { label: "Auto-suspend on dispute count", key: "moderation.auto_suspend_dispute_count", type: "text", description: "Automatically flag for review after this many open disputes." },
    ],
  },
];

export default function SuperAdminControlsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const settingsQ = useQuery({
    queryKey: ["super-admin", "platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("key,value,description,updated_at,updated_by");
      if (error) throw error;
      const map: Record<string, PlatformSetting> = {};
      for (const s of data ?? []) map[(s as any).key] = s as PlatformSetting;
      return map;
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const { error } = await supabase.rpc("admin_set_platform_setting", {
        p_key: key,
        p_value: value,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-admin", "platform-settings"] });
      setEditKey(null);
      setEditValue("");
    },
  });

  const settings = settingsQ.data ?? {};

  const getValue = (key: string, type: "toggle" | "text"): string => {
    const v = settings[key]?.value;
    if (type === "toggle") return v ?? "false";
    return v ?? "";
  };

  const isEnabled = (key: string): boolean => {
    const v = settings[key]?.value;
    return v === "true" || v === "1" || v === "yes";
  };

  const toggleValue = (key: string) => {
    const current = isEnabled(key);
    updateMut.mutate({ key, value: current ? "false" : "true" });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform Controls</h1>
        <p className="text-sm text-muted-foreground">
          Feature flags, risk controls, and moderation settings. All changes are audited.
        </p>
      </div>

      {updateMut.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(updateMut.error as Error).message}
        </div>
      )}

      {settingsQ.error && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Could not load settings: {(settingsQ.error as Error).message}
        </div>
      )}

      {CONTROL_SECTIONS.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {section.items.map((item) => (
              <div key={item.key} className="py-4 first:pt-0 last:pb-0">
                {item.type === "toggle" ? (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      {settings[item.key] && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Last updated: {formatDate(settings[item.key].updated_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isEnabled(item.key) ? "success" : "secondary"}>
                        {isEnabled(item.key) ? "Enabled" : "Disabled"}
                      </Badge>
                      <Button
                        size="sm"
                        variant={isEnabled(item.key) ? "destructive" : "default"}
                        disabled={updateMut.isPending}
                        onClick={() => toggleValue(item.key)}
                      >
                        {isEnabled(item.key) ? "Disable" : "Enable"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      {settings[item.key] && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Last updated: {formatDate(settings[item.key].updated_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {editKey === item.key ? (
                        <>
                          <Input
                            className="w-32 h-8 text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") updateMut.mutate({ key: item.key, value: editValue });
                              if (e.key === "Escape") { setEditKey(null); setEditValue(""); }
                            }}
                          />
                          <Button
                            size="sm"
                            disabled={updateMut.isPending}
                            onClick={() => updateMut.mutate({ key: item.key, value: editValue })}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setEditKey(null); setEditValue(""); }}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-mono bg-muted px-2 py-1 rounded min-w-[60px] text-center">
                            {getValue(item.key, "text") || "—"}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditKey(item.key);
                              setEditValue(getValue(item.key, "text"));
                            }}
                          >
                            Edit
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* All settings raw view */}
      <Card>
        <CardHeader>
          <CardTitle>All settings</CardTitle>
          <CardDescription>Full list of platform_settings table values.</CardDescription>
        </CardHeader>
        <CardContent>
          {settingsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : Object.keys(settings).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No settings configured yet. Use the controls above or run an admin RPC to initialise defaults.
            </p>
          ) : (
            <div className="divide-y font-mono text-xs">
              {Object.values(settings).map((s) => (
                <div key={s.key} className="py-2 flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{s.key}</span>
                  <span className="font-semibold truncate max-w-[200px]">{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
