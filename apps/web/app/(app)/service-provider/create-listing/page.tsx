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

const CATEGORIES = [
  { value: "Labour", label: "General Labour" },
  { value: "Forklift", label: "Forklift Operation" },
  { value: "PalletRework", label: "Pallet Rework" },
  { value: "Devanning", label: "Devanning" },
  { value: "LocalTruck", label: "Local Truck" },
  { value: "IndustrialCleaning", label: "Industrial Cleaning" },
] as const;

const COVERAGE_OPTIONS = ["Vancouver", "Burnaby", "Richmond", "Surrey", "Delta", "Langley", "Coquitlam", "Abbotsford", "Other"];

export default function CreateServiceListingPage() {
  const router = useRouter();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [category, setCategory] = useState<typeof CATEGORIES[number]["value"]>("Labour");
  const [hourlyRate, setHourlyRate] = useState(35);
  const [perJobRate, setPerJobRate] = useState(0);
  const [minHours, setMinHours] = useState(4);
  const [certifications, setCertifications] = useState("");
  const [coverage, setCoverage] = useState<string[]>(["Vancouver"]);

  const toggleCoverage = (city: string) => {
    setCoverage((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
  };

  const create = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: membership, error: memErr } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      if (memErr || !membership?.company_id) throw new Error("No company associated.");
      const { error } = await supabase.from("service_listings").insert({
        company_id: membership.company_id,
        category,
        coverage_area: coverage,
        hourly_rate: hourlyRate,
        per_job_rate: perJobRate || null,
        minimum_hours: minHours,
        certifications: certifications.trim() || null,
        status: "Draft",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-provider", "listings"] });
      router.push("/service-provider/listings");
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New service listing</h1>
          <p className="text-sm text-muted-foreground">Create a new service offering. It will start as a Draft.</p>
        </div>
        <Link href="/service-provider/listings"><Button variant="secondary">Cancel</Button></Link>
      </div>

      {create.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(create.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Service details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Service category *</Label>
            <select value={category} onChange={(e) => setCategory(e.target.value as any)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Hourly rate ($) *</Label>
              <Input type="number" min={0} step={0.5} value={hourlyRate} onChange={(e) => setHourlyRate(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Flat per-job rate (optional)</Label>
              <Input type="number" min={0} step={5} value={perJobRate} onChange={(e) => setPerJobRate(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Minimum hours</Label>
              <Input type="number" min={1} value={minHours} onChange={(e) => setMinHours(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Certifications / requirements</Label>
            <Input value={certifications} onChange={(e) => setCertifications(e.target.value)}
              placeholder="e.g. Forklift certification required" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Coverage area</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {COVERAGE_OPTIONS.map((city) => (
              <button
                key={city}
                type="button"
                onClick={() => toggleCoverage(city)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  coverage.includes(city)
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {city}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Select all cities where you provide this service.</p>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/service-provider/listings"><Button variant="secondary">Cancel</Button></Link>
        <Button disabled={coverage.length === 0 || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creating…" : "Create listing"}
        </Button>
      </div>
    </div>
  );
}
