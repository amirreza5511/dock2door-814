"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserRole, CompanyType } from "@/lib/types";

const COMPANY_TYPE_BY_ROLE: Record<string, CompanyType | undefined> = {
  WarehouseProvider: "WarehouseProvider",
  Customer: "Customer",
  ServiceProvider: "ServiceProvider",
  Employer: "Employer",
  TruckingCompany: "TruckingCompany",
};

const ROLE_LABEL: Record<string, string> = {
  WarehouseProvider: "Warehouse Provider",
  Customer: "Customer (Shipper / Retailer)",
  ServiceProvider: "Service Provider",
  Employer: "Employer (Labour Agency)",
  TruckingCompany: "Trucking Company",
};

const ROLE_DESCRIPTION: Record<string, string> = {
  WarehouseProvider: "List your warehouse space, manage bookings, dock appointments, and fulfillment operations.",
  Customer: "Find warehouse space, book storage, manage inventory and shipping integrations.",
  ServiceProvider: "Post service offerings, manage jobs and contracts for logistics work.",
  Employer: "Post shifts, manage workers, assignments, and payroll.",
  TruckingCompany: "Manage fleet, dispatch, dock appointments, and driver PODs.",
};

export default function CompanySetupPage() {
  const router = useRouter();
  const supabase = getBrowserSupabase();
  const [name, setName] = useState("");
  const [city, setCity] = useState("Vancouver");
  const [error, setError] = useState<string | null>(null);

  const profileQ = useQuery({
    queryKey: ["onboarding", "profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("id, name, role")
        .eq("id", user.id)
        .single();
      return data;
    },
  });

  const membershipQ = useQuery({
    queryKey: ["onboarding", "memberships"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id);
      return data ?? [];
    },
  });

  // If user already has a company, redirect to dashboard
  useEffect(() => {
    if (membershipQ.data && membershipQ.data.length > 0) {
      router.replace("/dashboard");
    }
  }, [membershipQ.data, router]);

  const role = (profileQ.data?.role as UserRole | null) ?? null;
  const companyType = role ? COMPANY_TYPE_BY_ROLE[role] : undefined;

  const createMut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Company name is required");
      if (!city.trim()) throw new Error("City is required");
      if (!companyType) throw new Error("Unable to determine company type for your role");

      const { error } = await supabase.rpc("setup_my_company", {
        p_name: name.trim(),
        p_city: city.trim(),
        p_type: companyType,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      router.replace("/dashboard");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to create company");
    },
  });

  if (profileQ.isLoading || membershipQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-background pt-16 px-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-2xl font-black">
            D2
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Set up your company</h1>
          <p className="text-sm text-muted-foreground">
            Create your company profile to get started on Dock2Door.
          </p>
        </div>

        {/* Role card */}
        {role && companyType && (
          <div className="rounded-lg border bg-primary/5 border-primary/20 px-4 py-3">
            <p className="text-sm font-semibold text-primary">
              {ROLE_LABEL[role] ?? role}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ROLE_DESCRIPTION[role] ?? ""}
            </p>
          </div>
        )}

        {!companyType && role && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-700">
              Your role (<strong>{role}</strong>) does not require a company. You can proceed to your dashboard directly.
            </p>
            <Button
              className="mt-2"
              size="sm"
              onClick={() => router.replace("/dashboard")}
            >
              Go to dashboard →
            </Button>
          </div>
        )}

        {companyType && (
          <Card>
            <CardHeader>
              <CardTitle>Company details</CardTitle>
              <CardDescription>
                This will be your company profile visible to other parties on the platform.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="company-name">Company name *</Label>
                <Input
                  id="company-name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(null); }}
                  placeholder="e.g. Pacific Logistics Inc."
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="company-city">City *</Label>
                <Input
                  id="company-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Vancouver"
                />
              </div>

              <div className="space-y-1">
                <Label>Company type</Label>
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  {ROLE_LABEL[role ?? ""] ?? companyType}
                  <span className="text-xs ml-2">(determined by your role)</span>
                </div>
              </div>

              <Button
                className="w-full"
                disabled={!name.trim() || !city.trim() || createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? "Creating company…" : "Create company & continue →"}
              </Button>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Your company profile can be updated later in your settings.
        </p>
      </div>
    </div>
  );
}
