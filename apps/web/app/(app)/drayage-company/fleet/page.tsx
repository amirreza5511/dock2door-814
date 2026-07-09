"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck, Container as ContainerIcon, User, Plus } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface TruckRow {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string;
}
interface TrailerRow {
  id: string;
  plate: string;
  trailer_type: string | null;
  status: string;
}
interface DriverRow {
  id: string;
  driver_user_id: string | null;
  name: string | null;
  data: { name?: string; truck_plate?: string } | null;
  status: string | null;
}

type FleetStatus = "Active" | "Maintenance" | "Retired" | "Suspended";

function statusVariant(s: string | null): "default" | "secondary" | "outline" {
  if (s === "Active") return "default";
  if (s === "Maintenance" || s === "Suspended") return "outline";
  return "secondary";
}

const TRAILER_TYPES = ["Container Chassis", "Dry Van", "Reefer", "Flatbed", "Tri-axle", "Other"];

export default function DrayageFleetPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const companyId = useActiveCompanyId("DrayageCompany") ?? null;
  const [tab, setTab] = useState<"trucks" | "trailers" | "drivers">("trucks");
  const [showAdd, setShowAdd] = useState(false);
  const [truckForm, setTruckForm] = useState({ plate: "", make: "", model: "", year: new Date().getFullYear() });
  const [trailerForm, setTrailerForm] = useState({ plate: "", trailer_type: "Container Chassis" });

  const trucksQ = useQuery({
    queryKey: ["drayage", "fleet", "trucks", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<TruckRow[]> => {
      const { data, error } = await supabase
        .from("trucks")
        .select("id,plate,make,model,year,status")
        .eq("company_id", companyId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as TruckRow[] | null) ?? [];
    },
  });

  const trailersQ = useQuery({
    queryKey: ["drayage", "fleet", "trailers", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<TrailerRow[]> => {
      const { data, error } = await supabase
        .from("trailers")
        .select("id,plate,trailer_type,status")
        .eq("company_id", companyId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as TrailerRow[] | null) ?? [];
    },
  });

  const driversQ = useQuery({
    queryKey: ["drayage", "fleet", "drivers", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<DriverRow[]> => {
      const { data, error } = await supabase.from("drivers").select("*").eq("company_id", companyId);
      if (error) throw error;
      return (data as DriverRow[] | null) ?? [];
    },
  });

  const addTruck = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No active drayage company.");
      const { error } = await supabase.from("trucks").insert({
        company_id: companyId,
        plate: truckForm.plate.trim().toUpperCase(),
        make: truckForm.make.trim() || null,
        model: truckForm.model.trim() || null,
        year: truckForm.year || null,
        status: "Active" as FleetStatus,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["drayage", "fleet", "trucks"] });
      setShowAdd(false);
      setTruckForm({ plate: "", make: "", model: "", year: new Date().getFullYear() });
    },
  });

  const addTrailer = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No active drayage company.");
      const { error } = await supabase.from("trailers").insert({
        company_id: companyId,
        plate: trailerForm.plate.trim().toUpperCase(),
        trailer_type: trailerForm.trailer_type || null,
        status: "Active" as FleetStatus,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["drayage", "fleet", "trailers"] });
      setShowAdd(false);
      setTrailerForm({ plate: "", trailer_type: "Container Chassis" });
    },
  });

  const trucks = trucksQ.data ?? [];
  const trailers = trailersQ.data ?? [];
  const drivers = driversQ.data ?? [];

  const tabs: { key: typeof tab; label: string; count: number; icon: typeof Truck }[] = [
    { key: "trucks", label: "Trucks", count: trucks.length, icon: Truck },
    { key: "trailers", label: "Chassis", count: trailers.length, icon: ContainerIcon },
    { key: "drivers", label: "Drivers", count: drivers.length, icon: User },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Drayage Company</p>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your trucks, chassis and drivers.</p>
        </div>
        {tab !== "drivers" ? (
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add {tab === "trucks" ? "truck" : "chassis"}
          </Button>
        ) : null}
      </div>

      <div className="flex gap-2">
        {tabs.map((t) => (
          <Button key={t.key} variant={tab === t.key ? "default" : "outline"} size="sm" onClick={() => setTab(t.key)}>
            <t.icon className="mr-1.5 h-4 w-4" /> {t.label} ({t.count})
          </Button>
        ))}
      </div>

      {tab === "trucks" ? (
        <FleetList
          loading={trucksQ.isLoading}
          empty="No trucks yet"
          rows={trucks.map((t) => ({
            id: t.id,
            title: t.plate || "—",
            sub: [t.year, t.make, t.model].filter(Boolean).join(" ") || "—",
            status: t.status,
          }))}
        />
      ) : tab === "trailers" ? (
        <FleetList
          loading={trailersQ.isLoading}
          empty="No chassis yet"
          rows={trailers.map((t) => ({ id: t.id, title: t.plate || "—", sub: t.trailer_type ?? "—", status: t.status }))}
        />
      ) : (
        <FleetList
          loading={driversQ.isLoading}
          empty="No drivers yet"
          rows={drivers.map((d) => ({
            id: d.id,
            title: d.name ?? d.data?.name ?? "Driver",
            sub: d.data?.truck_plate ?? "No truck assigned",
            status: d.status,
          }))}
        />
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {tab === "trucks" ? "truck" : "chassis"}</DialogTitle>
          </DialogHeader>
          {tab === "trucks" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Plate</Label>
                <Input value={truckForm.plate} onChange={(e) => setTruckForm({ ...truckForm, plate: e.target.value })} placeholder="ABC 1234" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label>Make</Label>
                  <Input value={truckForm.make} onChange={(e) => setTruckForm({ ...truckForm, make: e.target.value })} placeholder="Freightliner" />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label>Model</Label>
                  <Input value={truckForm.model} onChange={(e) => setTruckForm({ ...truckForm, model: e.target.value })} placeholder="Cascadia" />
                </div>
              </div>
              {addTruck.isError ? <p className="text-sm text-red-500">{addTruck.error instanceof Error ? addTruck.error.message : "Failed"}</p> : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Plate</Label>
                <Input value={trailerForm.plate} onChange={(e) => setTrailerForm({ ...trailerForm, plate: e.target.value })} placeholder="CH 5678" />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select
                  value={trailerForm.trailer_type}
                  onChange={(e) => setTrailerForm({ ...trailerForm, trailer_type: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {TRAILER_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              {addTrailer.isError ? <p className="text-sm text-red-500">{addTrailer.error instanceof Error ? addTrailer.error.message : "Failed"}</p> : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              onClick={() => (tab === "trucks" ? addTruck.mutate() : addTrailer.mutate())}
              disabled={addTruck.isPending || addTrailer.isPending}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FleetList({
  loading,
  empty,
  rows,
}: {
  loading: boolean;
  empty: string;
  rows: { id: string; title: string; sub: string; status: string | null }[];
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0)
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">{empty}</CardContent>
      </Card>
    );
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id}>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="font-mono font-medium">{r.title}</p>
              <p className="text-sm text-muted-foreground">{r.sub}</p>
            </div>
            <Badge variant={statusVariant(r.status)}>{r.status ?? "—"}</Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
