"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";

const WAREHOUSE_TYPES = ["Dry", "Chill", "Frozen"] as const;
const STORAGE_TERMS = ["Daily", "Weekly", "Monthly"] as const;
const STATUSES = ["Draft", "PendingApproval", "Available", "Active", "Hidden"] as const;

export default function EditWarehouseListingPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name: "",
    address: "",
    city: "",
    warehouse_type: "Dry" as typeof WAREHOUSE_TYPES[number],
    available_pallet_capacity: 0,
    min_pallets: 1,
    max_pallets: 100,
    storage_term: "Monthly" as typeof STORAGE_TERMS[number],
    storage_rate_per_pallet: 0,
    inbound_handling_fee_per_pallet: 0,
    outbound_handling_fee_per_pallet: 0,
    receiving_hours: "",
    access_restrictions: "",
    insurance_requirements: "",
    notes: "",
    status: "Draft" as typeof STATUSES[number],
  });

  const listing = useQuery({
    queryKey: ["warehouse", "listing", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_listings")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (listing.data) {
      const d = listing.data as any;
      setForm({
        name: d.name ?? "",
        address: d.address ?? "",
        city: d.city ?? "",
        warehouse_type: d.warehouse_type ?? "Dry",
        available_pallet_capacity: d.available_pallet_capacity ?? 0,
        min_pallets: d.min_pallets ?? 1,
        max_pallets: d.max_pallets ?? 100,
        storage_term: d.storage_term ?? "Monthly",
        storage_rate_per_pallet: d.storage_rate_per_pallet ?? 0,
        inbound_handling_fee_per_pallet: d.inbound_handling_fee_per_pallet ?? 0,
        outbound_handling_fee_per_pallet: d.outbound_handling_fee_per_pallet ?? 0,
        receiving_hours: d.receiving_hours ?? "",
        access_restrictions: d.access_restrictions ?? "",
        insurance_requirements: d.insurance_requirements ?? "",
        notes: d.notes ?? "",
        status: d.status ?? "Draft",
      });
    }
  }, [listing.data]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("warehouse_listings")
        .update({
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
          insurance_requirements: form.insurance_requirements.trim(),
          notes: form.notes.trim(),
          status: form.status,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse", "listings"] });
      qc.invalidateQueries({ queryKey: ["warehouse", "listing", id] });
      router.push("/warehouse/listings");
    },
  });

  if (listing.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (listing.error) return <div className="p-6 text-sm text-red-600">{(listing.error as Error).message}</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit listing</h1>
          <p className="text-sm text-muted-foreground">{form.name}</p>
        </div>
        <Link href="/warehouse/listings"><Button variant="secondary">Cancel</Button></Link>
      </div>

      {save.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(save.error as Error).message}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Listing details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Listing name *</Label>
              <Input value={form.name} onChange={set("name")} />
            </div>
            <div className="space-y-1.5">
              <Label>Warehouse type *</Label>
              <select value={form.warehouse_type} onChange={set("warehouse_type")}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                {WAREHOUSE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.city} onChange={set("city")} />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={set("address")} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <select value={form.status} onChange={set("status")}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
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
            <Input value={form.receiving_hours} onChange={set("receiving_hours")} placeholder="Mon–Fri 7am–3pm" />
          </div>
          <div className="space-y-1.5">
            <Label>Access restrictions</Label>
            <Input value={form.access_restrictions} onChange={set("access_restrictions")} />
          </div>
          <div className="space-y-1.5">
            <Label>Insurance requirements</Label>
            <Input value={form.insurance_requirements} onChange={set("insurance_requirements")} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/warehouse/listings"><Button variant="secondary">Cancel</Button></Link>
        <Button disabled={!form.name || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
