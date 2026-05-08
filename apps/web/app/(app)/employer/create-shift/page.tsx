"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";

const CATEGORIES = ["General", "Driver", "Forklift", "HighReach"] as const;

export default function CreateShiftPage() {
  const router = useRouter();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    title: "",
    category: "General" as typeof CATEGORIES[number],
    location_address: "",
    location_city: "Vancouver",
    date: "",
    start_time: "08:00",
    end_time: "17:00",
    hourly_rate: 20,
    workers_needed: 1,
    requirements: "",
    notes: "",
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const v = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const create = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .single();

      if (!profile?.company_id) throw new Error("No company associated with your account.");

      const { error } = await supabase.from("shift_posts").insert({
        employer_company_id: profile.company_id,
        title: form.title.trim(),
        category: form.category,
        location_address: form.location_address.trim(),
        location_city: form.location_city.trim(),
        date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        hourly_rate: form.hourly_rate,
        workers_needed: form.workers_needed,
        requirements: form.requirements.trim(),
        notes: form.notes.trim(),
        status: "Posted",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employer", "shifts"] });
      router.push("/employer");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Post a shift</h1>
          <p className="text-sm text-muted-foreground">Create a new labour shift posting for workers to apply.</p>
        </div>
        <Link href="/employer"><Button variant="secondary">Cancel</Button></Link>
      </div>

      {create.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(create.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Shift details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Shift title *</Label>
              <Input value={form.title} onChange={set("title")} placeholder="e.g. Forklift Operator — Delta warehouse" />
            </div>
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <select value={form.category} onChange={set("category")}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={form.date} onChange={set("date")} />
            </div>
            <div className="space-y-1.5">
              <Label>Workers needed</Label>
              <Input type="number" min={1} value={form.workers_needed} onChange={set("workers_needed")} />
            </div>
            <div className="space-y-1.5">
              <Label>Start time *</Label>
              <Input type="time" value={form.start_time} onChange={set("start_time")} />
            </div>
            <div className="space-y-1.5">
              <Label>End time *</Label>
              <Input type="time" value={form.end_time} onChange={set("end_time")} />
            </div>
            <div className="space-y-1.5">
              <Label>Hourly rate ($)</Label>
              <Input type="number" min={0} step={0.5} value={form.hourly_rate} onChange={set("hourly_rate")} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.location_city} onChange={set("location_city")} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Address</Label>
              <Input value={form.location_address} onChange={set("location_address")} placeholder="1234 Industrial Way" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Requirements &amp; notes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Certification requirements</Label>
            <Input value={form.requirements} onChange={set("requirements")} placeholder="e.g. Forklift certification required" />
          </div>
          <div className="space-y-1.5">
            <Label>Additional notes</Label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Any special instructions for workers…"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/employer"><Button variant="secondary">Cancel</Button></Link>
        <Button
          disabled={!form.title || !form.date || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Posting…" : "Post shift"}
        </Button>
      </div>
    </div>
  );
}
