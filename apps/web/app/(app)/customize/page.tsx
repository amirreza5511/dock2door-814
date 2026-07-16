"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal, EyeOff, ListPlus, Tag, Check, Clock, X, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCustomization,
  useMyCustomizationRequests,
  useSubmitCustomizationRequest,
} from "@/lib/hooks/use-customization";
import { cn } from "@/lib/utils";

const HIDEABLE: { key: string; label: string }[] = [
  { key: "reports", label: "Reports & KPIs" },
  { key: "settlement", label: "Driver settlement" },
  { key: "fuel-surcharge", label: "Fuel surcharge" },
  { key: "shipping-lines", label: "Shipping lines" },
  { key: "equipment-report", label: "Equipment & charges" },
  { key: "dead-runs", label: "Dead runs" },
  { key: "terminals", label: "Terminals" },
  { key: "orders-board", label: "Orders Board" },
  { key: "dispatch", label: "Dispatch" },
  { key: "fleet", label: "Fleet" },
  { key: "rates", label: "Rates & Zones" },
  { key: "invoicing", label: "Invoicing" },
  { key: "stat-open", label: "Stat: Open Orders" },
  { key: "stat-active", label: "Stat: Active" },
  { key: "stat-in-transit", label: "Stat: In Transit" },
  { key: "stat-drivers", label: "Stat: Drivers" },
];

const RENAMABLE: { key: string; label: string }[] = [
  { key: "Terminals", label: "Terminals" },
  { key: "Fleet", label: "Fleet" },
  { key: "Equipment & charges", label: "Equipment & charges" },
  { key: "Custom fields", label: "Custom fields" },
  { key: "Chassis", label: "Chassis" },
  { key: "Driver", label: "Driver" },
];

const FIELD_TYPES = ["text", "number", "date", "boolean", "select"] as const;
type FieldType = (typeof FIELD_TYPES)[number];

interface DraftField {
  label: string;
  type: FieldType;
  required: boolean;
  options: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
};

export default function CustomizePage() {
  const { hiddenModules, isLoading } = useCustomization();
  const requestsQ = useMyCustomizationRequests();
  const submit = useSubmitCustomizationRequest();

  const [hide, setHide] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<DraftField[]>([]);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [details, setDetails] = useState("");

  const toggleHide = (key: string) =>
    setHide((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addField = () => setFields((p) => [...p, { label: "", type: "text", required: false, options: "" }]);
  const updateField = (i: number, patch: Partial<DraftField>) =>
    setFields((p) => p.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const removeField = (i: number) => setFields((p) => p.filter((_, idx) => idx !== i));

  const cleanFields = useMemo(
    () =>
      fields
        .filter((f) => f.label.trim().length > 0)
        .map((f) => ({
          key: f.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
          label: f.label.trim(),
          type: f.type,
          required: f.required,
          options: f.type === "select" ? f.options.split(",").map((o) => o.trim()).filter(Boolean) : [],
        })),
    [fields],
  );

  const cleanRenames = useMemo(
    () => Object.fromEntries(Object.entries(renames).filter(([, v]) => v.trim().length > 0).map(([k, v]) => [k, v.trim()])),
    [renames],
  );

  const canSubmit = hide.size > 0 || cleanFields.length > 0 || Object.keys(cleanRenames).length > 0;

  const derivedTitle = useMemo(() => {
    const parts: string[] = [];
    if (hide.size > 0) parts.push(`hide ${hide.size} section${hide.size > 1 ? "s" : ""}`);
    if (cleanFields.length > 0) parts.push(`add ${cleanFields.length} field${cleanFields.length > 1 ? "s" : ""}`);
    if (Object.keys(cleanRenames).length > 0) parts.push(`rename ${Object.keys(cleanRenames).length} term${Object.keys(cleanRenames).length > 1 ? "s" : ""}`);
    return parts.length ? `Customize: ${parts.join(", ")}` : "Customize workspace";
  }, [hide, cleanFields, cleanRenames]);

  const onSubmit = () => {
    if (!canSubmit) return;
    submit.mutate(
      {
        title: derivedTitle,
        details: details.trim(),
        payload: {
          hiddenModules: [...hide],
          customFields: cleanFields,
          terminology: cleanRenames,
        },
      },
      {
        onSuccess: () => {
          setHide(new Set());
          setFields([]);
          setRenames({});
          setDetails("");
        },
      },
    );
  };

  const requests = requestsQ.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Workspace
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Customize your workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tailor your company&apos;s pages to how you actually operate. Changes are reviewed by an admin before they go live.
        </p>
      </div>

      {/* Hide sections */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <EyeOff className="h-4 w-4 text-muted-foreground" /> Hide sections you don&apos;t use
          </p>
          <div className="flex flex-wrap gap-2">
            {HIDEABLE.map((m) => {
              const active = hide.has(m.key);
              const alreadyHidden = hiddenModules.includes(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  disabled={alreadyHidden}
                  onClick={() => toggleHide(m.key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    alreadyHidden
                      ? "cursor-default border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                      : active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {alreadyHidden ? `${m.label} · hidden` : m.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Custom fields */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ListPlus className="h-4 w-4 text-muted-foreground" /> Add custom fields to your orders
          </p>
          {fields.map((f, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Input className="flex-1" placeholder="Field label (e.g. PO number)" value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} />
                <select
                  value={f.type}
                  onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <Button size="icon" variant="ghost" onClick={() => removeField(i)}>
                  <X className="h-4 w-4 text-red-500" />
                </Button>
              </div>
              {f.type === "select" ? (
                <Input placeholder="Options, comma separated (e.g. Low, Medium, High)" value={f.options} onChange={(e) => updateField(i, { options: e.target.value })} />
              ) : null}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                Required
              </label>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addField}>
            <Plus className="mr-1 h-4 w-4" /> Add field
          </Button>
        </CardContent>
      </Card>

      {/* Terminology */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Tag className="h-4 w-4 text-muted-foreground" /> Rename terms to match your team
          </p>
          <div className="space-y-2">
            {RENAMABLE.map((r) => (
              <div key={r.key} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-sm text-muted-foreground">{r.label}</span>
                <Input
                  placeholder={`Your word for "${r.label}"`}
                  value={renames[r.key] ?? ""}
                  onChange={(e) => setRenames((p) => ({ ...p, [r.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-4">
          <Label>Anything else? (optional note for the admin)</Label>
          <Input placeholder="e.g. We only run import moves, so hide export tools" value={details} onChange={(e) => setDetails(e.target.value)} />
          {submit.isError ? <p className="text-sm text-red-500">{submit.error instanceof Error ? submit.error.message : "Failed"}</p> : null}
          {submit.isSuccess ? <p className="text-sm text-emerald-500">Request submitted — an admin will review it shortly.</p> : null}
          <Button onClick={onSubmit} disabled={!canSubmit || submit.isPending}>
            {submit.isPending ? "Submitting…" : "Submit for approval"}
          </Button>
        </CardContent>
      </Card>

      {/* History */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Your requests</h2>
        {isLoading || requestsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  {r.admin_note ? <p className="truncate text-xs text-muted-foreground">Note: {r.admin_note}</p> : null}
                </div>
                <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[r.status] ?? "bg-muted text-muted-foreground")}>
                  {r.status === "approved" ? <Check className="h-3 w-3" /> : r.status === "rejected" ? <X className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {r.status}
                </span>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
