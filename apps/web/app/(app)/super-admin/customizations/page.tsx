"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal, EyeOff, ListPlus, Tag, Check, X, Clock, Building2, MessageSquare, ArrowUpDown, Settings2, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAllCustomizationRequests,
  useDecideCustomizationRequest,
  useAdminSetCustomizations,
} from "@/lib/hooks/use-customization";
import { cn } from "@/lib/utils";

const DIRECT_HIDEABLE: { key: string; label: string }[] = [
  { key: "reports", label: "Reports & KPIs" },
  { key: "settlement", label: "Driver settlement" },
  { key: "fuel-surcharge", label: "Fuel surcharge" },
  { key: "shipping-lines", label: "Shipping lines" },
  { key: "equipment-report", label: "Equipment & charges" },
  { key: "dead-runs", label: "Dead runs" },
  { key: "terminals", label: "Terminals" },
  { key: "invoicing", label: "Invoicing" },
];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-red-500/15 text-red-500",
};

export default function SuperAdminCustomizationsPage() {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const requestsQ = useAllCustomizationRequests(filter);
  const decide = useDecideCustomizationRequest();
  const adminSet = useAdminSetCustomizations();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editCompany, setEditCompany] = useState<string>("");
  const [directHide, setDirectHide] = useState<Set<string>>(new Set());

  const companies = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of requestsQ.data ?? []) {
      if (r.company_id) map.set(r.company_id, r.company_name ?? "Company");
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [requestsQ.data]);

  const toggleDirectHide = (key: string) =>
    setDirectHide((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const applyDirect = async () => {
    if (!editCompany) return;
    await adminSet.mutateAsync({ companyId: editCompany, payload: { hiddenModules: [...directHide] } });
  };

  const act = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      await decide.mutateAsync({ requestId: id, approve, note: notes[id]?.trim() || "" });
    } finally {
      setBusyId(null);
    }
  };

  const requests = requestsQ.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Super Admin
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Customization requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approving applies the changes to that company&apos;s workspace instantly. Nothing changes for other companies.
        </p>
      </div>

      <div className="flex gap-2">
        {(["pending", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "pending" ? "Pending" : "All"}
          </Button>
        ))}
      </div>

      {requestsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Check className="h-8 w-8 text-emerald-400" />
            <p className="font-semibold">Nothing to review</p>
            <p className="text-sm text-muted-foreground">Customization requests from companies show up here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const hidden = r.payload?.hiddenModules ?? [];
            const fields = r.payload?.customFields ?? [];
            const terminology = r.payload?.terminology ?? {};
            const busy = busyId === r.id;
            const hasChanges = hidden.length > 0 || fields.length > 0 || Object.keys(terminology).length > 0 || (r.payload?.sectionOrder ?? []).length > 0 || Boolean(r.payload?.defaults && Object.keys(r.payload.defaults).length > 0);
            return (
              <Card key={r.id}>
                <CardContent className="space-y-2.5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{r.title}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3" /> {r.company_name ?? "Company"}
                      </p>
                    </div>
                    <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[r.status] ?? "bg-muted text-muted-foreground")}>
                      {r.status === "approved" ? <Check className="h-3 w-3" /> : r.status === "rejected" ? <X className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {r.status}
                    </span>
                  </div>

                  {r.details ? <p className="text-sm text-muted-foreground">{r.details}</p> : null}

                  {hidden.length > 0 ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <EyeOff className="h-3.5 w-3.5" /> Hide: {hidden.join(", ")}
                    </div>
                  ) : null}
                  {fields.length > 0 ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ListPlus className="h-3.5 w-3.5" /> Add fields: {fields.map((f) => `${f.label}${f.type ? ` (${f.type})` : ""}`).join(", ")}
                    </div>
                  ) : null}
                  {Object.keys(terminology).length > 0 ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Tag className="h-3.5 w-3.5" /> Rename: {Object.entries(terminology).map(([k, v]) => `${k} → ${v}`).join(", ")}
                    </div>
                  ) : null}
                  {(r.payload?.sectionOrder ?? []).length > 0 ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ArrowUpDown className="h-3.5 w-3.5" /> Reorder: {(r.payload?.sectionOrder ?? []).join(" → ")}
                    </div>
                  ) : null}
                  {r.payload?.defaults && Object.keys(r.payload.defaults).length > 0 ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Settings2 className="h-3.5 w-3.5" /> Defaults: {Object.entries(r.payload.defaults).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                    </div>
                  ) : null}

                  {hasChanges && r.status === "pending" ? (
                    <p className="text-xs font-medium text-primary">Approving applies these changes to {r.company_name || "this company"} instantly.</p>
                  ) : null}
                  {r.requester_name ? <p className="text-xs text-muted-foreground">Requested by {r.requester_name}</p> : null}

                  {r.status === "pending" ? (
                    <>
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          placeholder="Optional note to the company…"
                          className="h-9"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void act(r.id, true)}>
                          <Check className="mr-1.5 h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(r.id, false)}>
                          <X className="mr-1.5 h-4 w-4 text-red-500" /> Reject
                        </Button>
                      </div>
                    </>
                  ) : r.admin_note ? (
                    <p className="text-xs text-muted-foreground">Note: {r.admin_note}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
