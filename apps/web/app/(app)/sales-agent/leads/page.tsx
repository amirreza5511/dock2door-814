"use client";

import { useState } from "react";
import { Plus, ClipboardList } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { useSalesLeads, useSaveLead, money, type AgentLead, type SaveLeadInput } from "@/lib/hooks/use-sales";

const STATUSES = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"] as const;
const STATUS_STYLE: Record<string, string> = {
  New: "bg-blue-500/15 text-blue-400",
  Contacted: "bg-purple-500/15 text-purple-400",
  Qualified: "bg-cyan-500/15 text-cyan-400",
  Proposal: "bg-yellow-500/15 text-yellow-400",
  Won: "bg-emerald-500/15 text-emerald-400",
  Lost: "bg-red-500/15 text-red-400",
};
const VERTICALS = ["warehouse", "drayage", "freight-forwarder", "employer", "trucking", "shipper", "driver", "worker"];

const EMPTY: SaveLeadInput = { businessName: "", contactName: "", contactEmail: "", contactPhone: "", city: "", vertical: "warehouse", status: "New", priority: "Medium", estimatedValue: 0, notes: "" };

export default function SalesLeadsPage() {
  const q = useSalesLeads();
  const save = useSaveLead();
  const [open, setOpen] = useState<boolean>(false);
  const [form, setForm] = useState<SaveLeadInput>(EMPTY);

  const leads = q.data ?? [];

  function openNew() { setForm(EMPTY); setOpen(true); }
  function openEdit(l: AgentLead) {
    setForm({ id: l.id, businessName: l.business_name, contactName: l.contact_name ?? "", contactEmail: l.contact_email ?? "", contactPhone: l.contact_phone ?? "", city: l.city ?? "", vertical: l.vertical ?? "warehouse", status: l.status, priority: l.priority ?? "Medium", estimatedValue: Number(l.estimated_value ?? 0), notes: l.notes ?? "" });
    setOpen(true);
  }
  async function submit() {
    if (!form.businessName.trim()) return;
    await save.mutateAsync(form);
    setOpen(false);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads pipeline</h1>
          <p className="text-sm text-muted-foreground">{leads.length} lead{leads.length === 1 ? "" : "s"} · track prospects to won</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Add lead</Button>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : leads.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No leads yet</CardTitle>
            <CardDescription>Log a prospect to work it through your pipeline, then convert to an onboarded client.</CardDescription>
          </CardHeader>
          <CardContent><Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Add your first lead</Button></CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {leads.map((l) => (
            <button key={l.id} onClick={() => openEdit(l)} className="text-left">
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="grid h-11 w-11 place-items-center rounded-lg bg-muted"><ClipboardList className="h-5 w-5 text-purple-400" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{l.business_name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[l.status] ?? "bg-muted"}`}>{l.status}</span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {[l.contact_name, l.vertical, l.city].filter(Boolean).join(" · ") || "—"} · {formatDate(l.created_at)}
                    </p>
                  </div>
                  {Number(l.estimated_value ?? 0) > 0 && (
                    <div className="text-right">
                      <p className="font-semibold">{money(Number(l.estimated_value))}</p>
                      <p className="text-[11px] text-muted-foreground">est. value</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Edit lead" : "New lead"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <Field label="Business name"><Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Acme Logistics" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact name"><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
              <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email"><Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Business type">
                <select value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm capitalize">
                  {VERTICALS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Stage">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Estimated value ($)"><Input type="number" value={String(form.estimatedValue ?? 0)} onChange={(e) => setForm({ ...form, estimatedValue: Number(e.target.value) || 0 })} /></Field>
            <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={save.isPending || !form.businessName.trim()}>{save.isPending ? "Saving…" : "Save lead"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
