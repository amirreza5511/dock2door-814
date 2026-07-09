"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMyAgent, useSaveAgentProfile, type SaveProfileInput } from "@/lib/hooks/use-sales";

const PAYOUT_METHODS = ["Bank transfer", "PayPal", "Stripe", "Wise", "Check"];

export default function AgentProfilePage() {
  const agentQ = useMyAgent();
  const save = useSaveAgentProfile();
  const [saved, setSaved] = useState<boolean>(false);
  const [form, setForm] = useState<SaveProfileInput>({});

  useEffect(() => {
    const a = agentQ.data;
    if (!a) return;
    setForm({
      legalName: a.legal_name ?? "",
      businessName: a.business_name ?? "",
      phone: a.phone ?? "",
      territory: a.territory ?? "",
      payoutMethod: a.payout_method ?? "",
      payoutDetails: a.payout_details ?? "",
    });
  }, [agentQ.data]);

  async function submit() {
    await save.mutateAsync(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent profile</h1>
        <p className="text-sm text-muted-foreground">Your contact, territory and payout details.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact</CardTitle>
          <CardDescription>Your referral code is <span className="font-mono font-semibold text-primary">{agentQ.data?.agent_code ?? "——"}</span>.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="Legal name"><Input value={form.legalName ?? ""} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></Field>
          <Field label="Business name (optional)"><Input value={form.businessName ?? ""} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone"><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 …" /></Field>
            <Field label="Territory / region"><Input value={form.territory ?? ""} onChange={(e) => setForm({ ...form, territory: e.target.value })} placeholder="e.g. West Coast" /></Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payout</CardTitle>
          <CardDescription>How you get paid your commission.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="Payout method">
            <select value={form.payoutMethod ?? ""} onChange={(e) => setForm({ ...form, payoutMethod: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Select…</option>
              {PAYOUT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Payout details"><Textarea value={form.payoutDetails ?? ""} onChange={(e) => setForm({ ...form, payoutDetails: e.target.value })} rows={3} placeholder="Account number, email, or handle depending on method" /></Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void submit()} disabled={save.isPending}>
          {saved ? <Check className="mr-2 h-4 w-4" /> : null}
          {save.isPending ? "Saving…" : saved ? "Saved" : "Save profile"}
        </Button>
      </div>
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
