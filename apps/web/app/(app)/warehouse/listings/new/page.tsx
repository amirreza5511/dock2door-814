"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";

const WAREHOUSE_TYPES = ["Dry", "Chill", "Frozen"] as const;
const STORAGE_TERMS = ["Daily", "Weekly", "Monthly"] as const;

export default function NewWarehouseListingPage() {
  const router = useRouter();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  // Use active company from company_users membership — never reads legacy profiles.company_id
  const activeCompanyId = useActiveCompanyId("warehouse_provider");

  const [form, setForm] = useState({
    name: "",
    address: "",
    city: "",
    warehouse_type: "Dry" as typeof WAREHOUSE_TYPES[number],
    available_pallet_capacity: 100,
    min_pallets: 1,
    max_pallets: 100,
    storage_term: "Monthly" as typeof STORAGE_TERMS[number],
    storage_rate_per_pallet: 0,
    inbound_handling_fee_per_pallet: 0,
    outbound_handling_fee_per_pallet: 0,
    receiving_hours: "",
    access_restrictions: "",
    notes: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!activeCompanyId) throw new Error("No active warehouse company. Please select your company first.");

      const { error } = await supabase.from("warehouse_listings").insert({
        company_id: activeCompanyId,
        name: form.name.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        warehouse_type: form.warehouse_type,
        available_pallet_capacity: form.available_pallet_capacity,
        min_pallets: form.min_pallets,
        max_pallets: form.max_pallets,
        storage_term: form.storage_term,
        storage_rate_per_pallet: form.storage_rate_per_pallet,
        inbound_handling_fee_per_pallet: form.inbound_handling_fee_per_pallet,
        outbound_handling_fee_per_pallet: form.outbound_handling_fee_per_pallet,
        receiving_hours: form.receiving_hours.trim(),
        access_restrictions: form.access_restrictions.trim(),
        notes: form.notes.trim(),
        status: "Draft",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse", "listings"] });
      router.push("/warehouse/listings");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New warehouse listing</h1>
          <p className="text-sm text-muted-foreground">Create a new storage listing. It will start as a Draft.</p>
        </div>
        <Link href="/warehouse/listings">
          <Button variant="secondary">Cancel</Button>
        </Link>
      </div>

      {create.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(create.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Listing details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Listing name *</Label>
              <Input value={form.name} onChange={set("name")} placeholder="e.g. Delta Dry Storage Unit A" />
            </div>
            <div className="space-y-1.5">
              <Label>Warehouse type *</Label>
              <select value={form.warehouse_type} onChange={set("warehouse_type")}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                {WAREHOUSE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>City *</Label>
              <Input value={form.city} onChange={set("city")} placeholder="Vancouver" />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={set("address")} placeholder="1234 Industrial Way" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Capacity &amp; pricing</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Available pallet capacity</Label>
              <Input type="number" min={0} value={form.available_pallet_capacity} onChange={set("available_pallet_capacity")} />
            </div>
            <div className="space-y-1.5">
              <Label>Min pallets</Label>
              <Input type="number" min={1} value={form.min_pallets} onChange={set("min_pallets")} />
            </div>
            <div className="space-y-1.5">
              <Label>Max pallets</Label>
              <Input type="number" min={1} value={form.max_pallets} onChange={set("max_pallets")} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Storage term</Label>
              <select value={form.storage_term} onChange={set("storage_term")}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                {STORAGE_TERMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Storage rate / pallet ($)</Label>
              <Input type="number" min={0} step={0.01} value={form.storage_rate_per_pallet} onChange={set("storage_rate_per_pallet")} />
            </div>
            <div className="space-y-1.5">
              <Label>Inbound handling / pallet ($)</Label>
              <Input type="number" min={0} step={0.01} value={form.inbound_handling_fee_per_pallet} onChange={set("inbound_handling_fee_per_pallet")} />
            </div>
            <div className="space-y-1.5">
              <Label>Outbound handling / pallet ($)</Label>
              <Input type="number" min={0} step={0.01} value={form.outbound_handling_fee_per_pallet} onChange={set("outbound_handling_fee_per_pallet")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Operating details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Receiving hours</Label>
            <Input value={form.receiving_hours} onChange={set("receiving_hours")} placeholder="e.g. Mon–Fri 7am–3pm" />
          </div>
          <div className="space-y-1.5">
            <Label>Access restrictions</Label>
            <Input value={form.access_restrictions} onChange={set("access_restrictions")} placeholder="e.g. No hazardous materials" />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Any additional notes for customers…"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/warehouse/listings"><Button variant="secondary">Cancel</Button></Link>
        <Button
          disabled={!form.name || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Creating…" : "Create listing"}
        </Button>
      </div>
    </div>
  );
}
