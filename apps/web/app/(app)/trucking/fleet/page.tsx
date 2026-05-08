"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

interface TruckRow {
  id: string;
  unit_number: string | null;
  plate_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
}

interface TrailerRow {
  id: string;
  unit_number: string | null;
  plate_number: string | null;
  trailer_type: string | null;
  length_ft: number | null;
  status: string | null;
  notes: string | null;
  created_at: string;
}

export default function TruckingFleetPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"trucks" | "trailers">("trucks");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ unit_number: "", plate_number: "", make: "", model: "", year: new Date().getFullYear(), vin: "", notes: "" });
  const [addTrailerForm, setAddTrailerForm] = useState({ unit_number: "", plate_number: "", trailer_type: "Dry Van", length_ft: 53, notes: "" });

  const trucksQ = useQuery({
    queryKey: ["trucking", "fleet", "trucks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trucks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TruckRow[];
    },
  });

  const trailersQ = useQuery({
    queryKey: ["trucking", "fleet", "trailers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trailers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TrailerRow[];
    },
  });

  const addTruck = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: profile } = await supabase.from("profiles").select("company_id").eq("id", user.id).single();
      if (!profile?.company_id) throw new Error("No company found.");
      const { error } = await supabase.from("trucks").insert({
        company_id: profile.company_id,
        ...addForm,
        year: addForm.year || null,
        vin: addForm.vin.trim() || null,
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trucking", "fleet", "trucks"] }); setShowAdd(false); },
  });

  const addTrailer = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: profile } = await supabase.from("profiles").select("company_id").eq("id", user.id).single();
      if (!profile?.company_id) throw new Error("No company found.");
      const { error } = await supabase.from("trailers").insert({
        company_id: profile.company_id,
        ...addTrailerForm,
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trucking", "fleet", "trailers"] }); setShowAdd(false); },
  });

  const setVehicleStatus = useMutation({
    mutationFn: async ({ table, id, status }: { table: string; id: string; status: string }) => {
      const { error } = await supabase.from(table).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["trucking", "fleet", vars.table === "trucks" ? "trucks" : "trailers"] }),
  });

  const truckCols: Column<TruckRow>[] = [
    {
      key: "unit",
      header: "Unit",
      render: (t) => (
        <div>
          <div className="font-medium">{t.unit_number ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{[t.year, t.make, t.model].filter(Boolean).join(" ") || "—"}</div>
        </div>
      ),
      sortable: true,
      sortValue: (t) => t.unit_number,
    },
    { key: "plate", header: "Plate", render: (t) => t.plate_number ?? "—" },
    { key: "vin", header: "VIN", render: (t) => t.vin ? <span className="font-mono text-xs">{t.vin}</span> : "—" },
    {
      key: "status",
      header: "Status",
      render: (t) => (
        <Badge variant={t.status === "active" ? "success" : t.status === "maintenance" ? "warning" : "secondary"}>
          {t.status ?? "—"}
        </Badge>
      ),
      sortable: true,
      sortValue: (t) => t.status,
    },
    {
      key: "created",
      header: "Added",
      render: (t) => <span className="text-xs text-muted-foreground">{formatDate(t.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (t) => (
        <div className="flex justify-end gap-2">
          {t.status !== "active" && (
            <Button size="sm" variant="secondary" disabled={setVehicleStatus.isPending}
              onClick={() => setVehicleStatus.mutate({ table: "trucks", id: t.id, status: "active" })}>
              Set Active
            </Button>
          )}
          {t.status === "active" && (
            <Button size="sm" variant="outline" disabled={setVehicleStatus.isPending}
              onClick={() => setVehicleStatus.mutate({ table: "trucks", id: t.id, status: "maintenance" })}>
              Maintenance
            </Button>
          )}
        </div>
      ),
    },
  ];

  const trailerCols: Column<TrailerRow>[] = [
    {
      key: "unit",
      header: "Unit",
      render: (t) => (
        <div>
          <div className="font-medium">{t.unit_number ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{t.trailer_type ?? "—"} {t.length_ft ? `· ${t.length_ft}ft` : ""}</div>
        </div>
      ),
    },
    { key: "plate", header: "Plate", render: (t) => t.plate_number ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (t) => (
        <Badge variant={t.status === "active" ? "success" : t.status === "maintenance" ? "warning" : "secondary"}>
          {t.status ?? "—"}
        </Badge>
      ),
    },
    {
      key: "created",
      header: "Added",
      render: (t) => <span className="text-xs text-muted-foreground">{formatDate(t.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (t) => (
        <div className="flex justify-end gap-2">
          {t.status !== "active" && (
            <Button size="sm" variant="secondary" disabled={setVehicleStatus.isPending}
              onClick={() => setVehicleStatus.mutate({ table: "trailers", id: t.id, status: "active" })}>
              Set Active
            </Button>
          )}
          {t.status === "active" && (
            <Button size="sm" variant="outline" disabled={setVehicleStatus.isPending}
              onClick={() => setVehicleStatus.mutate({ table: "trailers", id: t.id, status: "maintenance" })}>
              Maintenance
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet management</h1>
          <p className="text-sm text-muted-foreground">Manage your trucks and trailers.</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          + Add {tab === "trucks" ? "truck" : "trailer"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Total trucks", value: trucksQ.data?.length ?? 0 },
          { label: "Active trucks", value: (trucksQ.data ?? []).filter(t => t.status === "active").length },
          { label: "Total trailers", value: trailersQ.data?.length ?? 0 },
          { label: "Active trailers", value: (trailersQ.data ?? []).filter(t => t.status === "active").length },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="flex gap-1 border-b">
        {(["trucks", "trailers"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t === "trucks" ? "Trucks" : "Trailers"}
          </button>
        ))}
      </div>

      {tab === "trucks" && (
        <Card>
          <CardHeader><CardTitle>Trucks</CardTitle><CardDescription>{trucksQ.data?.length ?? 0} total</CardDescription></CardHeader>
          <CardContent>
            <DataTable rows={trucksQ.data ?? []} columns={truckCols} rowKey={(t) => t.id}
              isLoading={trucksQ.isLoading} error={trucksQ.error as Error | null}
              searchPlaceholder="Search unit, plate, make…"
              filters={[
                { value: "active", label: "Active", predicate: (t) => t.status === "active" },
                { value: "maintenance", label: "Maintenance", predicate: (t) => t.status === "maintenance" },
              ]} emptyMessage="No trucks added yet." />
          </CardContent>
        </Card>
      )}

      {tab === "trailers" && (
        <Card>
          <CardHeader><CardTitle>Trailers</CardTitle><CardDescription>{trailersQ.data?.length ?? 0} total</CardDescription></CardHeader>
          <CardContent>
            <DataTable rows={trailersQ.data ?? []} columns={trailerCols} rowKey={(t) => t.id}
              isLoading={trailersQ.isLoading} error={trailersQ.error as Error | null}
              searchPlaceholder="Search unit or plate…"
              emptyMessage="No trailers added yet." />
          </CardContent>
        </Card>
      )}

      {showAdd && tab === "trucks" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold">Add truck</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>✕</Button>
            </div>
            {addTruck.error && <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{(addTruck.error as Error).message}</div>}
            <div className="grid gap-3 md:grid-cols-2">
              {([["unit_number", "Unit number"], ["plate_number", "Plate number"], ["make", "Make"], ["model", "Model"]] as const).map(([k, lbl]) => (
                <div key={k} className="space-y-1.5">
                  <Label>{lbl}</Label>
                  <Input value={(addForm as any)[k]} onChange={(e) => setAddForm(f => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Input type="number" value={addForm.year} onChange={(e) => setAddForm(f => ({ ...f, year: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1.5">
                <Label>VIN</Label>
                <Input value={addForm.vin} onChange={(e) => setAddForm(f => ({ ...f, vin: e.target.value }))} />
              </div>
            </div>
            <div className="mt-4">
              <Button className="w-full" disabled={addTruck.isPending} onClick={() => addTruck.mutate()}>
                {addTruck.isPending ? "Adding…" : "Add truck"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showAdd && tab === "trailers" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold">Add trailer</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>✕</Button>
            </div>
            {addTrailer.error && <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{(addTrailer.error as Error).message}</div>}
            <div className="space-y-3">
              {([["unit_number", "Unit number"], ["plate_number", "Plate number"]] as const).map(([k, lbl]) => (
                <div key={k} className="space-y-1.5">
                  <Label>{lbl}</Label>
                  <Input value={(addTrailerForm as any)[k]} onChange={(e) => setAddTrailerForm(f => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label>Trailer type</Label>
                <select value={addTrailerForm.trailer_type} onChange={(e) => setAddTrailerForm(f => ({ ...f, trailer_type: e.target.value }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                  {["Dry Van", "Reefer", "Flatbed", "Step Deck", "Container", "Tanker"].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Length (ft)</Label>
                <Input type="number" value={addTrailerForm.length_ft} onChange={(e) => setAddTrailerForm(f => ({ ...f, length_ft: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="mt-4">
              <Button className="w-full" disabled={addTrailer.isPending} onClick={() => addTrailer.mutate()}>
                {addTrailer.isPending ? "Adding…" : "Add trailer"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
