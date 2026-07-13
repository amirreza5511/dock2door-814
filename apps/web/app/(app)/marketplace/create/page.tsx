"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import {
  SERVICE_TYPES, SUBCATEGORIES, type ServiceType,
} from "@/lib/serviceMarketplace";

export default function CreateMarketplaceListingPage() {
  const router = useRouter();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [serviceType, setServiceType] = useState<ServiceType>("equipment_rental");
  const [subcategory, setSubcategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [coverage, setCoverage] = useState<string[]>([]);
  const [hourlyRate, setHourlyRate] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [weeklyRate, setWeeklyRate] = useState("");
  const [perJobRate, setPerJobRate] = useState("");
  const [minHours, setMinHours] = useState("2");
  const [cargoRatePercent, setCargoRatePercent] = useState("");
  const [minPremium, setMinPremium] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [certifications, setCertifications] = useState("");

  const isRental = serviceType === "equipment_rental";
  const isInsurance = serviceType === "cargo_insurance";
  const num = (s: string): number | null => {
    const n = Number(s);
    return s.trim() !== "" && Number.isFinite(n) ? n : null;
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim() && !subcategory) throw new Error("Add a title or pick a category.");
      if (!city.trim()) throw new Error("Primary city is required.");
      const hasPrice = num(hourlyRate) || num(dailyRate) || num(weeklyRate) || num(perJobRate) || num(cargoRatePercent) || num(minPremium);
      if (!hasPrice && !negotiable) throw new Error("Set at least one rate, or mark it negotiable.");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: membership, error: memErr } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin", "staff", "supervisor"])
        .limit(1)
        .single();
      if (memErr || !membership?.company_id) throw new Error("No company associated with your account.");

      const coverageArea = coverage.length > 0 ? coverage : [city.trim()];
      const { error } = await supabase.from("service_listings").insert({
        company_id: membership.company_id,
        service_type: serviceType,
        subcategory,
        title: title.trim(),
        description: description.trim(),
        coverage_area: coverageArea,
        hourly_rate: num(hourlyRate) ?? 0,
        per_job_rate: num(perJobRate),
        daily_rate: num(dailyRate),
        weekly_rate: num(weeklyRate),
        minimum_hours: num(minHours) ?? 1,
        cargo_rate_percent: num(cargoRatePercent),
        min_premium: num(minPremium),
        negotiable,
        certifications: certifications.trim() || null,
        status: "Active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace", "listings"] });
      router.push("/marketplace");
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New marketplace listing</h1>
          <p className="text-sm text-muted-foreground">Publish equipment, a repair service or labour. It goes live immediately.</p>
        </div>
        <Link href="/marketplace"><Button variant="secondary">Cancel</Button></Link>
      </div>

      {create.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(create.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Type & category</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Listing type</Label>
            <div className="flex flex-wrap gap-2">
              {SERVICE_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setServiceType(t.id); setSubcategory(""); }}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    serviceType === t.id
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <div className="flex flex-wrap gap-2">
              {SUBCATEGORIES[serviceType].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSubcategory(s.id)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    subcategory === s.id
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isRental ? "e.g. Toyota 5,000 lb Forklift" : "e.g. On-site forklift technician"} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Describe specs, condition, what's included…" />
          </div>
          <div className="space-y-1.5">
            <Label>Primary city *</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Chicago" />
          </div>
          <div className="space-y-1.5">
            <Label>Coverage cities (comma-separated)</Label>
            <Input
              value={coverage.join(", ")}
              onChange={(e) => setCoverage(e.target.value.split(",").map((c) => c.trim()).filter(Boolean))}
              placeholder="Chicago, Aurora, Naperville"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pricing</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {isInsurance ? (
              <>
                <div className="space-y-1.5">
                  <Label>Rate (% of cargo value)</Label>
                  <Input type="number" min={0} step="0.01" value={cargoRatePercent} onChange={(e) => setCargoRatePercent(e.target.value)} placeholder="0.8" />
                </div>
                <div className="space-y-1.5">
                  <Label>Minimum premium ($)</Label>
                  <Input type="number" min={0} value={minPremium} onChange={(e) => setMinPremium(e.target.value)} placeholder="150" />
                </div>
              </>
            ) : isRental ? (
              <>
                <div className="space-y-1.5">
                  <Label>Daily rate ($)</Label>
                  <Input type="number" min={0} value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} placeholder="180" />
                </div>
                <div className="space-y-1.5">
                  <Label>Weekly rate ($)</Label>
                  <Input type="number" min={0} value={weeklyRate} onChange={(e) => setWeeklyRate(e.target.value)} placeholder="750" />
                </div>
                <div className="space-y-1.5">
                  <Label>Hourly rate ($)</Label>
                  <Input type="number" min={0} value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="35" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Hourly rate ($)</Label>
                  <Input type="number" min={0} value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="65" />
                </div>
                <div className="space-y-1.5">
                  <Label>Per-job rate ($)</Label>
                  <Input type="number" min={0} value={perJobRate} onChange={(e) => setPerJobRate(e.target.value)} placeholder="450" />
                </div>
                <div className="space-y-1.5">
                  <Label>Minimum hours</Label>
                  <Input type="number" min={1} value={minHours} onChange={(e) => setMinHours(e.target.value)} placeholder="2" />
                </div>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={negotiable} onChange={(e) => setNegotiable(e.target.checked)} className="h-4 w-4 rounded border-border" />
            Price negotiable
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Certifications / notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea value={certifications} onChange={(e) => setCertifications(e.target.value)} rows={3} placeholder="Operator license, insurance, WHMIS…" />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/marketplace"><Button variant="secondary">Cancel</Button></Link>
        <Button disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Publishing…" : "Publish listing"}
        </Button>
      </div>
    </div>
  );
}
