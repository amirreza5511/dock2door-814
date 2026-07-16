"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck, Container as ContainerIcon, User, Plus, Layers } from "lucide-react";
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
  cost_per_mile?: number | null;
}
interface TrailerRow {
  id: string;
  plate: string;
  trailer_type: string | null;
  status: string;
  is_rental?: boolean | null;
  rental_daily_rate?: number | null;
  rental_return_date?: string | null;
  is_dropped?: boolean | null;
  dropped_label?: string | null;
}
interface ChassisRow {
  id: string;
  chassis_number: string;
  plate: string | null;
  chassis_type: string | null;
  status: string;
  is_rental?: boolean | null;
  rental_daily_rate?: number | null;
  rental_return_date?: string | null;
  is_dropped?: boolean | null;
  dropped_label?: string | null;
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
const CHASSIS_TYPES = ["20ft", "40ft", "40/45 Slider", "Tri-axle", "Gooseneck", "Combo"];

export default function DrayageFleetPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const companyId = useActiveCompanyId("DrayageCompany") ?? null;
  const [tab, setTab] = useState<"trucks" | "chassis" | "trailers" | "drivers">("trucks");
  const [showAdd, setShowAdd] = useState(false);
  const [truckForm, setTruckForm] = useState({ plate: "", make: "", model: "", year: new Date().getFullYear(), cost_per_mile: "" });
  const [trailerForm, setTrailerForm] = useState({ plate: "", trailer_type: "Container Chassis", is_rental: false, rental_daily_rate: "", rental_return_date: "" });
  const [chassisForm, setChassisForm] = useState({ chassis_number: "", plate: "", chassis_type: "40ft", is_rental: false, rental_daily_rate: "", rental_return_date: "" });

  const trucksQ = useQuery({
    queryKey: ["drayage", "fleet", "trucks", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<TruckRow[]> => {
      let res = await supabase
        .from("trucks")
        .select("id,plate,make,model,year,status,cost_per_mile")
        .eq("company_id", companyId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (res.error && res.error.message.includes("cost_per_mile")) {
        // Migration 0149 not applied yet — fall back to the base columns.
        res = await supabase
          .from("trucks")
          .select("id,plate,make,model,year,status")
          .eq("company_id", companyId)
          .is("archived_at", null)
          .order("created_at", { ascending: false });
      }
      if (res.error) throw res.error;
      return (res.data as TruckRow[] | null) ?? [];
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

  const chassisQ = useQuery({
    queryKey: ["drayage", "fleet", "chassis", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ChassisRow[]> => {
      const { data, error } = await supabase
        .from("chassis")
        .select("id,chassis_number,plate,chassis_type,status,is_rental,rental_daily_rate,rental_return_date,is_dropped,dropped_label")
        .eq("company_id", companyId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as ChassisRow[] | null) ?? [];
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
      const base = {
        company_id: companyId,
        plate: truckForm.plate.trim().toUpperCase(),
        make: truckForm.make.trim() || null,
        model: truckForm.model.trim() || null,
        year: truckForm.year || null,
        status: "Active" as FleetStatus,
      };
      const cpm = truckForm.cost_per_mile.trim() === "" ? 0 : Number(truckForm.cost_per_mile);
      let { error } = await supabase.from("trucks").insert({ ...base, cost_per_mile: cpm });
      if (error && error.message.includes("cost_per_mile")) {
        ({ error } = await supabase.from("trucks").insert(base));
      }
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["drayage", "fleet", "trucks"] });
      setShowAdd(false);
      setTruckForm({ plate: "", make: "", model: "", year: new Date().getFullYear(), cost_per_mile: "" });
    },
  });

  const addTrailer = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No active drayage company.");
      const { error } = await supabase.from("trailers").insert({
        company_id: companyId,
        plate: trailerForm.plate.trim().toUpperCase(),
        trailer_type: trailerForm.trailer_type || null,
        is_rental: trailerForm.is_rental,
        rental_daily_rate: trailerForm.rental_daily_rate.trim() === "" ? 0 : Number(trailerForm.rental_daily_rate),
        rental_return_date: trailerForm.rental_return_date.trim() || null,
        status: "Active" as FleetStatus,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["drayage", "fleet", "trailers"] });
      setShowAdd(false);
      setTrailerForm({ plate: "", trailer_type: "Container Chassis", is_rental: false, rental_daily_rate: "", rental_return_date: "" });
    },
  });

  const addChassis = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No active drayage company.");
      const { error } = await supabase.from("chassis").insert({
        company_id: companyId,
        chassis_number: chassisForm.chassis_number.trim().toUpperCase(),
        plate: chassisForm.plate.trim().toUpperCase() || "",
        chassis_type: chassisForm.chassis_type || "",
        is_rental: chassisForm.is_rental,
        rental_daily_rate: chassisForm.rental_daily_rate.trim() === "" ? 0 : Number(chassisForm.rental_daily_rate),
        rental_return_date: chassisForm.rental_return_date.trim() || null,
        status: "Active" as FleetStatus,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["drayage", "fleet", "chassis"] });
      setShowAdd(false);
      setChassisForm({ chassis_number: "", plate: "", chassis_type: "40ft", is_rental: false, rental_daily_rate: "", rental_return_date: "" });
    },
  });

  const trucks = trucksQ.data ?? [];
  const trailers = trailersQ.data ?? [];
  const chassis = chassisQ.data ?? [];
  const drivers = driversQ.data ?? [];

  const tabs: { key: typeof tab; label: string; count: number; icon: typeof Truck }[] = [
    { key: "trucks", label: "Trucks", count: trucks.length, icon: Truck },
    { key: "chassis", label: "Chassis", count: chassis.length, icon: Layers },
    { key: "trailers", label: "Trailers", count: trailers.length, icon: ContainerIcon },
    { key: "drivers", label: "Drivers", count: drivers.length, icon: User },
  ];

  const rentalSub = (r: { is_rental?: boolean | null; rental_daily_rate?: number | null; is_dropped?: boolean | null; dropped_label?: string | null }, base: string): string => {
    const parts = [base];
    if (r.is_rental) parts.push(`Rental $${r.rental_daily_rate ?? 0}/d`);
    if (r.is_dropped) parts.push(`Dropped${r.dropped_label ? ` · ${r.dropped_label}` : ""}`);
    return parts.filter(Boolean).join(" · ");
  };

  const addLabel = tab === "trucks" ? "truck" : tab === "chassis" ? "chassis" : "trailer";

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
            <Plus className="mr-1.5 h-4 w-4" /> Add {addLabel}
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
            sub: [[t.year, t.make, t.model].filter(Boolean).join(" ") || "—", t.cost_per_mile ? `$${t.cost_per_mile}/mi` : ""].filter(Boolean).join(" · "),
            status: t.status,
          }))}
        />
      ) : tab === "chassis" ? (
        <FleetList
          loading={chassisQ.isLoading}
          empty="No chassis yet"
          rows={chassis.map((c) => ({ id: c.id, title: c.chassis_number || "—", sub: rentalSub(c, c.chassis_type ?? "Chassis"), status: c.status }))}
        />
      ) : tab === "trailers" ? (
        <FleetList
          loading={trailersQ.isLoading}
          empty="No trailers yet"
          rows={trailers.map((t) => ({ id: t.id, title: t.plate || "—", sub: rentalSub(t, t.trailer_type ?? "—"), status: t.status }))}
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
            <DialogTitle>Add {addLabel}</DialogTitle>
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
              <div className="space-y-1.5">
                <Label>Cost per mile ($/mi)</Label>
                <Input value={truckForm.cost_per_mile} onChange={(e) => setTruckForm({ ...truckForm, cost_per_mile: e.target.value })} placeholder="2.10" inputMode="decimal" />
                <p className="text-xs text-muted-foreground">Used to price dead runs (empty miles). Leave blank to use the company default.</p>
              </div>
              {addTruck.isError ? <p className="text-sm text-red-500">{addTruck.error instanceof Error ? addTruck.error.message : "Failed"}</p> : null}
            </div>
          ) : tab === "chassis" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Chassis number</Label>
                <Input value={chassisForm.chassis_number} onChange={(e) => setChassisForm({ ...chassisForm, chassis_number: e.target.value })} placeholder="CH-2201" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label>Plate</Label>
                  <Input value={chassisForm.plate} onChange={(e) => setChassisForm({ ...chassisForm, plate: e.target.value })} placeholder="CHS 4421" />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label>Type</Label>
                  <select value={chassisForm.chassis_type} onChange={(e) => setChassisForm({ ...chassisForm, chassis_type: e.target.value })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {CHASSIS_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
              </div>
              <RentalFields
                isRental={chassisForm.is_rental}
                dailyRate={chassisForm.rental_daily_rate}
                returnDate={chassisForm.rental_return_date}
                onChange={(patch) => setChassisForm({ ...chassisForm, ...patch })}
              />
              {addChassis.isError ? <p className="text-sm text-red-500">{addChassis.error instanceof Error ? addChassis.error.message : "Failed"}</p> : null}
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
              <RentalFields
                isRental={trailerForm.is_rental}
                dailyRate={trailerForm.rental_daily_rate}
                returnDate={trailerForm.rental_return_date}
                onChange={(patch) => setTrailerForm({ ...trailerForm, ...patch })}
              />
              {addTrailer.isError ? <p className="text-sm text-red-500">{addTrailer.error instanceof Error ? addTrailer.error.message : "Failed"}</p> : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              onClick={() => (tab === "trucks" ? addTruck.mutate() : tab === "chassis" ? addChassis.mutate() : addTrailer.mutate())}
              disabled={addTruck.isPending || addTrailer.isPending || addChassis.isPending}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RentalFields({
  isRental,
  dailyRate,
  returnDate,
  onChange,
}: {
  isRental: boolean;
  dailyRate: string;
  returnDate: string;
  onChange: (patch: { is_rental?: boolean; rental_daily_rate?: string; rental_return_date?: string }) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Ownership</Label>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={!isRental ? "default" : "outline"} onClick={() => onChange({ is_rental: false })}>Owned</Button>
          <Button type="button" size="sm" variant={isRental ? "default" : "outline"} onClick={() => onChange({ is_rental: true })}>Rental</Button>
        </div>
      </div>
      {isRental ? (
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label>Daily rate ($/day)</Label>
            <Input value={dailyRate} onChange={(e) => onChange({ rental_daily_rate: e.target.value })} placeholder="25" inputMode="decimal" />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>Return date</Label>
            <Input type="date" value={returnDate} onChange={(e) => onChange({ rental_return_date: e.target.value })} />
          </div>
        </div>
      ) : null}
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
