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

// ── Real schema from migration 0002 ──────────────────────────────────────────
// trucks  : id, company_id, plate, make, model, year, status, data, archived_at, created_at
// trailers: id, company_id, plate, trailer_type, status, data, archived_at, created_at
// fleet_status enum: 'Active' | 'Maintenance' | 'Retired' | 'Suspended'  (capitalised!)
// There is NO unit_number, plate_number, vin, or length_ft column.
// Extra ad-hoc fields can be stored in the `data` jsonb column.

interface TruckRow {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string; // fleet_status
  created_at: string;
}

interface TrailerRow {
  id: string;
  plate: string;
  trailer_type: string | null;
  status: string; // fleet_status
  created_at: string;
}

type FleetStatus = "Active" | "Maintenance" | "Retired" | "Suspended";

function statusVariant(s: string | null): "success" | "warning" | "secondary" | "destructive" {
  if (s === "Active") return "success";
  if (s === "Maintenance") return "warning";
  if (s === "Suspended") return "destructive";
  return "secondary"; // Retired
}

const TRAILER_TYPES = ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Container", "Tanker", "Other"];

export default function TruckingFleetPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"trucks" | "trailers">("trucks");
  const [showAdd, setShowAdd] = useState(false);

  // Truck form — only real schema columns
  const [truckForm, setTruckForm] = useState({ plate: "", make: "", model: "", year: new Date().getFullYear() });
  // Trailer form — only real schema columns
  const [trailerForm, setTrailerForm] = useState({ plate: "", trailer_type: "Dry Van" });

  // ── Data fetching ────────────────────────────────────────────────────────
  const trucksQ = useQuery({
    queryKey: ["trucking", "fleet", "trucks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trucks")
        .select("id,plate,make,model,year,status,created_at")
        .is("archived_at", null)
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
        .select("id,plate,trailer_type,status,created_at")
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TrailerRow[];
    },
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const addTruck = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      // Look up the user's trucking company via profiles.company_id
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .single();
      if (!profile?.company_id) throw new Error("No company associated with your account.");

      const { error } = await supabase.from("trucks").insert({
        company_id: profile.company_id,
        plate: truckForm.plate.trim().toUpperCase(),
        make: truckForm.make.trim() || null,
        model: truckForm.model.trim() || null,
        year: truckForm.year || null,
        status: "Active" as FleetStatus, // fleet_status enum is capitalised
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trucking", "fleet", "trucks"] });
      setShowAdd(false);
      setTruckForm({ plate: "", make: "", model: "", year: new Date().getFullYear() });
    },
  });

  const addTrailer = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .single();
      if (!profile?.company_id) throw new Error("No company associated with your account.");

      const { error } = await supabase.from("trailers").insert({
        company_id: profile.company_id,
        plate: trailerForm.plate.trim().toUpperCase(),
        trailer_type: trailerForm.trailer_type || null,
        status: "Active" as FleetStatus,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trucking", "fleet", "trailers"] });
      setShowAdd(false);
      setTrailerForm({ plate: "", trailer_type: "Dry Van" });
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ table, id, status }: { table: "trucks" | "trailers"; id: string; status: FleetStatus }) => {
      const { error } = await supabase.from(table).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["trucking", "fleet", vars.table] });
    },
  });

  // ── Table column definitions ─────────────────────────────────────────────
  const truckCols: Column<TruckRow>[] = [
    {
      key: "plate",
      header: "Plate",
      render: (t) => (
        <div>
          <div className="font-mono font-medium">{t.plate || "—"}</div>
          <div className="text-xs text-muted-foreground">
            {[t.year, t.make, t.model].filter(Boolean).join(" ") || "—"}
          </div>
        </div>
      ),
      sortable: true,
      sortValue: (t) => t.plate,
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <Badge variant={statusVariant(t.status)}>{t.status ?? "—"}</Badge>,
      sortable: true,
      sortValue: (t) => t.status,
    },
    {
      key: "added",
      header: "Added",
      render: (t) => <span className="text-xs text-muted-foreground">{formatDate(t.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (t) => (
        <div className="flex justify-end gap-2">
          {t.status !== "Active" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ table: "trucks", id: t.id, status: "Active" })}
            >
              Set Active
            </Button>
          )}
          {t.status === "Active" && (
            <Button
              size="sm"
              variant="outline"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ table: "trucks", id: t.id, status: "Maintenance" })}
            >
              Maintenance
            </Button>
          )}
        </div>
      ),
    },
  ];

  const trailerCols: Column<TrailerRow>[] = [
    {
      key: "plate",
      header: "Plate",
      render: (t) => (
        <div>
          <div className="font-mono font-medium">{t.plate || "—"}</div>
          {t.trailer_type && <div className="text-xs text-muted-foreground">{t.trailer_type}</div>}
        </div>
      ),
      sortable: true,
      sortValue: (t) => t.plate,
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <Badge variant={statusVariant(t.status)}>{t.status ?? "—"}</Badge>,
      sortable: true,
      sortValue: (t) => t.status,
    },
    {
      key: "added",
      header: "Added",
      render: (t) => <span className="text-xs text-muted-foreground">{formatDate(t.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (t) => (
        <div className="flex justify-end gap-2">
          {t.status !== "Active" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ table: "trailers", id: t.id, status: "Active" })}
            >
              Set Active
            </Button>
          )}
          {t.status === "Active" && (
            <Button
              size="sm"
              variant="outline"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ table: "trailers", id: t.id, status: "Maintenance" })}
            >
              Maintenance
            </Button>
          )}
        </div>
      ),
    },
  ];

  const addError = tab === "trucks" ? addTruck.error : addTrailer.error;

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
          { label: "Total trucks",    value: trucksQ.data?.length ?? 0 },
          { label: "Active trucks",   value: (trucksQ.data ?? []).filter(t => t.status === "Active").length },
          { label: "Total trailers",  value: trailersQ.data?.length ?? 0 },
          { label: "Active trailers", value: (trailersQ.data ?? []).filter(t => t.status === "Active").length },
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
          <button
            key={t}
            onClick={() => { setTab(t); setShowAdd(false); }}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "trucks" ? "Trucks" : "Trailers"}
          </button>
        ))}
      </div>

      {tab === "trucks" && (
        <Card>
          <CardHeader>
            <CardTitle>Trucks</CardTitle>
            <CardDescription>{trucksQ.data?.length ?? 0} total</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={trucksQ.data ?? []}
              columns={truckCols}
              rowKey={(t) => t.id}
              isLoading={trucksQ.isLoading}
              error={trucksQ.error as Error | null}
              searchPlaceholder="Search plate, make, model…"
              searchPredicate={(t, q) =>
                t.plate?.toLowerCase().includes(q) ||
                (t.make?.toLowerCase().includes(q) ?? false) ||
                (t.model?.toLowerCase().includes(q) ?? false)
              }
              filters={[
                { value: "Active",      label: "Active",      predicate: (t) => t.status === "Active" },
                { value: "Maintenance", label: "Maintenance", predicate: (t) => t.status === "Maintenance" },
                { value: "Retired",     label: "Retired",     predicate: (t) => t.status === "Retired" },
              ]}
              emptyMessage="No trucks added yet."
            />
          </CardContent>
        </Card>
      )}

      {tab === "trailers" && (
        <Card>
          <CardHeader>
            <CardTitle>Trailers</CardTitle>
            <CardDescription>{trailersQ.data?.length ?? 0} total</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={trailersQ.data ?? []}
              columns={trailerCols}
              rowKey={(t) => t.id}
              isLoading={trailersQ.isLoading}
              error={trailersQ.error as Error | null}
              searchPlaceholder="Search plate or type…"
              searchPredicate={(t, q) =>
                t.plate?.toLowerCase().includes(q) ||
                (t.trailer_type?.toLowerCase().includes(q) ?? false)
              }
              emptyMessage="No trailers added yet."
            />
          </CardContent>
        </Card>
      )}

      {/* ── Add truck modal ───────────────────────────────────────────────── */}
      {showAdd && tab === "trucks" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold">Add truck</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>✕</Button>
            </div>
            {addError && (
              <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {(addError as Error).message}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="col-span-2 space-y-1.5">
                <Label>Plate number *</Label>
                <Input
                  placeholder="e.g. ABC 1234"
                  value={truckForm.plate}
                  onChange={(e) => setTruckForm(f => ({ ...f, plate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Make</Label>
                <Input placeholder="Kenworth" value={truckForm.make} onChange={(e) => setTruckForm(f => ({ ...f, make: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input placeholder="T680" value={truckForm.model} onChange={(e) => setTruckForm(f => ({ ...f, model: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Year</Label>
                <Input type="number" min={1980} max={new Date().getFullYear() + 1} value={truckForm.year} onChange={(e) => setTruckForm(f => ({ ...f, year: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="mt-4">
              <Button
                className="w-full"
                disabled={!truckForm.plate.trim() || addTruck.isPending}
                onClick={() => addTruck.mutate()}
              >
                {addTruck.isPending ? "Adding…" : "Add truck"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add trailer modal ─────────────────────────────────────────────── */}
      {showAdd && tab === "trailers" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold">Add trailer</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>✕</Button>
            </div>
            {addError && (
              <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {(addError as Error).message}
              </div>
            )}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Plate number *</Label>
                <Input
                  placeholder="e.g. XYZ 5678"
                  value={trailerForm.plate}
                  onChange={(e) => setTrailerForm(f => ({ ...f, plate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Trailer type</Label>
                <select
                  value={trailerForm.trailer_type}
                  onChange={(e) => setTrailerForm(f => ({ ...f, trailer_type: e.target.value }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {TRAILER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <Button
                className="w-full"
                disabled={!trailerForm.plate.trim() || addTrailer.isPending}
                onClick={() => addTrailer.mutate()}
              >
                {addTrailer.isPending ? "Adding…" : "Add trailer"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
