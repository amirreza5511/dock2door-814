"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Ship, Train, Anchor, Building2, Users, Boxes, Truck, CheckCircle2, MapPin,
  Package, Plus, Clock, CalendarClock,
} from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useExplore, useActionGuard } from "@/lib/explore-store";
import { SAMPLE_CONTAINER_ORDERS } from "@/lib/explore-samples";

const CONTAINER_SIZES = ["20ft", "40ft", "40HC", "45HC", "53ft"];
const CONTAINER_TYPES = ["Standard", "Reefer", "Flatrack", "Tank", "Open Top", "High Cube"];
const HANDLING_MODES = [
  { key: "LiveLoad", title: "Live load", desc: "Driver waits while it's loaded" },
  { key: "LiveUnload", title: "Live unload", desc: "Driver waits while it's unloaded" },
  { key: "DropPick", title: "Drop & pick", desc: "Drop now, pick up after load/unload" },
] as const;

const DIRECTION_COLOR: Record<string, string> = {
  Import: "bg-blue-500/15 text-blue-300",
  Export: "bg-emerald-500/15 text-emerald-300",
};

type HandlingMode = (typeof HANDLING_MODES)[number]["key"];

interface DrayageOrder {
  id: string;
  reference_code: string | null;
  container_number: string | null;
  container_size: string | null;
  direction: string | null;
  status: string;
  commodity: string | null;
  port_reservation_date: string | null;
  port_reservation_time: string | null;
  is_prepull: boolean | null;
  created_at: string;
  [k: string]: unknown;
}

interface Terminal {
  id: string;
  name: string;
  code: string;
  city: string | null;
  terminal_type: string;
}

interface DrayCompany {
  id: string;
  name: string;
  city: string | null;
}

export default function FreightForwarderPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState<boolean>(false);

  const ordersQuery = useQuery({
    queryKey: ["forwarder", "orders"],
    enabled: !isExploring,
    refetchInterval: 30000,
    queryFn: async (): Promise<DrayageOrder[]> => {
      const { data, error } = await supabase
        .from("drayage_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return [];
      return (data as DrayageOrder[] | null) ?? [];
    },
  });

  const terminalsQuery = useQuery({
    queryKey: ["forwarder", "terminals"],
    queryFn: async (): Promise<Terminal[]> => {
      const { data, error } = await supabase
        .from("terminals")
        .select("id,name,code,city,terminal_type")
        .eq("is_active", true)
        .order("terminal_type")
        .order("name");
      if (error) return [];
      return (data as Terminal[] | null) ?? [];
    },
  });

  const companiesQuery = useQuery({
    queryKey: ["forwarder", "drayage-companies"],
    queryFn: async (): Promise<DrayCompany[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,city,status")
        .eq("type", "DrayageCompany")
        .eq("status", "Approved")
        .order("name");
      if (error) return [];
      return (data as DrayCompany[] | null) ?? [];
    },
  });

  const orders = useMemo<DrayageOrder[]>(
    () => (isExploring ? (SAMPLE_CONTAINER_ORDERS as unknown as DrayageOrder[]) : (ordersQuery.data ?? [])),
    [ordersQuery.data, isExploring],
  );
  const terminals = useMemo(() => terminalsQuery.data ?? [], [terminalsQuery.data]);
  const companies = useMemo(() => companiesQuery.data ?? [], [companiesQuery.data]);
  const portRailTerminals = useMemo(
    () => terminals.filter((t) => t.terminal_type === "Port" || t.terminal_type === "Rail"),
    [terminals],
  );

  const stats = useMemo(() => {
    const active = orders.filter((o) => !["Delivered", "Cancelled"].includes(o.status));
    const inTransit = orders.filter((o) => ["EnRoute", "PickedUp", "InTransit", "Dispatched"].includes(o.status));
    const delivered = orders.filter((o) => o.status === "Delivered");
    return { total: orders.length, active: active.length, inTransit: inTransit.length, delivered: delivered.length };
  }, [orders]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Freight Forwarder</p>
        <h1 className="text-2xl font-semibold tracking-tight">Container orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Import &amp; export containers — post and track live.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat icon={<Boxes className="h-5 w-5 text-primary" />} value={stats.total} label="Total orders" />
        <Stat icon={<Truck className="h-5 w-5 text-yellow-400" />} value={stats.active} label="Active" />
        <Stat icon={<MapPin className="h-5 w-5 text-blue-400" />} value={stats.inTransit} label="In transit" />
        <Stat icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />} value={stats.delivered} label="Delivered" />
      </div>

      <button
        onClick={() => { if (guard("Post a container order")) setShowForm(true); }}
        className="flex w-full items-center gap-4 rounded-2xl bg-primary p-4 text-left text-primary-foreground transition-opacity hover:opacity-90"
      >
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/20">
          <Plus className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block text-base font-bold">Post a container order</span>
          <span className="block text-xs text-primary-foreground/80">Import or export — port to warehouse</span>
        </span>
        <Ship className="h-5 w-5" />
      </button>

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-bold">How it works</p>
        <div className="space-y-3">
          {[
            { icon: Ship, title: "Post a container", text: "Add your import or export container with terminal, appointment and commodity details." },
            { icon: Building2, title: "Get it claimed", text: "Send it to a specific drayage company or open it to the marketplace for quotes." },
            { icon: MapPin, title: "Track live", text: "Follow every move and see port reservations, pickup and delivery in real time." },
          ].map((g) => (
            <div key={g.title} className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
                <g.icon className="h-4 w-4 text-primary" />
              </span>
              <div>
                <p className="text-sm font-semibold">{g.title}</p>
                <p className="text-xs text-muted-foreground">{g.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-3 text-base font-semibold">Your container orders</p>
        {!isExploring && ordersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Ship className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No container orders yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Post your first import or export container order to get drayage companies bidding.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/freight-forwarder/${o.id}`}
                className="block rounded-lg border border-white/5 bg-card/60 px-4 py-3 transition-colors hover:border-white/15"
              >
                <div className="flex items-center justify-between">
                  <Badge className={DIRECTION_COLOR[o.direction ?? ""] ?? "bg-blue-500/15 text-blue-300"}>
                    {o.direction ?? "Order"}
                  </Badge>
                  <Badge variant="secondary">{o.status}</Badge>
                </div>
                <p className="mt-1.5 font-semibold">{o.reference_code || "Container order"}</p>
                <p className="text-xs text-muted-foreground">
                  Container: {o.container_number || "TBD"} · {o.container_size}
                  {o.commodity ? ` · ${o.commodity}` : ""}
                </p>
                {o.port_reservation_date ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <CalendarClock className="h-3 w-3" />
                    Port appt: {o.port_reservation_date} {o.port_reservation_time}
                  </p>
                ) : null}
                {o.is_prepull ? (
                  <span className="mt-1 inline-block rounded bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold text-purple-300">
                    PREPULL
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>

      <NewOrderDialog
        open={showForm}
        onOpenChange={setShowForm}
        terminals={portRailTerminals}
        companies={companies}
        onCreated={async () => {
          setShowForm(false);
          await qc.invalidateQueries({ queryKey: ["forwarder", "orders"] });
        }}
      />
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted">{icon}</div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function NewOrderDialog({
  open,
  onOpenChange,
  terminals,
  companies,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  terminals: Terminal[];
  companies: DrayCompany[];
  onCreated: () => Promise<void>;
}) {
  const supabase = getBrowserSupabase();
  const [direction, setDirection] = useState<"Import" | "Export">("Import");
  const [containerNumber, setContainerNumber] = useState<string>("");
  const [containerSize, setContainerSize] = useState<string>("40ft");
  const [containerType, setContainerType] = useState<string>("Standard");
  const [bolNumber, setBolNumber] = useState<string>("");
  const [bookingNumber, setBookingNumber] = useState<string>("");
  const [commodity, setCommodity] = useState<string>("");
  const [weightKg, setWeightKg] = useState<string>("");
  const [flags, setFlags] = useState<{ hazmat: boolean; overweight: boolean; oversized: boolean }>({
    hazmat: false,
    overweight: false,
    oversized: false,
  });
  const [originTerminalId, setOriginTerminalId] = useState<string>("");
  const [destinationTerminalId, setDestinationTerminalId] = useState<string>("");
  const [pickupAddress, setPickupAddress] = useState<string>("");
  const [pickupCity, setPickupCity] = useState<string>("");
  const [deliveryAddress, setDeliveryAddress] = useState<string>("");
  const [deliveryCity, setDeliveryCity] = useState<string>("");
  const [resDate, setResDate] = useState<string>("");
  const [resTime, setResTime] = useState<string>("");
  const [handlingMode, setHandlingMode] = useState<HandlingMode>("LiveUnload");
  const [pickupBackDate, setPickupBackDate] = useState<string>("");
  const [isPrepull, setIsPrepull] = useState<boolean>(false);
  const [prepullDate, setPrepullDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!containerNumber.trim() && !bookingNumber.trim()) {
        throw new Error("Enter at least a container number or booking number.");
      }
      const { error: err } = await supabase.rpc("create_drayage_order", {
        p_direction: direction,
        p_container_number: containerNumber.trim(),
        p_container_size: containerSize,
        p_container_type: containerType,
        p_bol_number: bolNumber.trim(),
        p_booking_number: bookingNumber.trim(),
        p_commodity: commodity.trim(),
        p_weight_kg: Number(weightKg) || 0,
        p_is_hazmat: flags.hazmat,
        p_is_overweight: flags.overweight,
        p_is_oversized: flags.oversized,
        p_origin_terminal_id: originTerminalId || null,
        p_destination_terminal_id: destinationTerminalId || null,
        p_warehouse_company_id: null,
        p_pickup_address: pickupAddress.trim(),
        p_pickup_city: pickupCity.trim(),
        p_pickup_lat: 0,
        p_pickup_lng: 0,
        p_delivery_address: deliveryAddress.trim(),
        p_delivery_city: deliveryCity.trim(),
        p_delivery_lat: 0,
        p_delivery_lng: 0,
        p_port_reservation_date: resDate.trim() || null,
        p_port_reservation_time: resTime.trim(),
        p_is_prepull: isPrepull,
        p_prepull_pickup_date: prepullDate.trim() || null,
        p_prepull_yard_terminal_id: null,
        p_notes: notes.trim(),
        p_target_drayage_company_id: targetCompanyId || null,
        p_handling_mode: handlingMode,
        p_pickup_back_date: handlingMode === "DropPick" ? pickupBackDate.trim() || null : null,
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: () => {
      void onCreated();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New container order</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(["Import", "Export"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition-colors ${
                  direction === d
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {d === "Import" ? <Package className="h-4 w-4" /> : <Ship className="h-4 w-4" />}
                {d}
              </button>
            ))}
          </div>

          <Field label="Container number">
            <Input value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} placeholder="e.g. TCLU1234567" />
          </Field>

          <Field label="Container size">
            <ChipRow options={CONTAINER_SIZES} value={containerSize} onChange={setContainerSize} />
          </Field>

          <Field label="Container type">
            <ChipRow options={CONTAINER_TYPES} value={containerType} onChange={setContainerType} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="BOL number">
              <Input value={bolNumber} onChange={(e) => setBolNumber(e.target.value)} placeholder="Bill of lading" />
            </Field>
            <Field label="Booking number">
              <Input value={bookingNumber} onChange={(e) => setBookingNumber(e.target.value)} placeholder="Shipping line booking" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Commodity">
              <Input value={commodity} onChange={(e) => setCommodity(e.target.value)} placeholder="What's in the container" />
            </Field>
            <Field label="Weight (kg)">
              <Input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} inputMode="numeric" placeholder="0" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {([["hazmat", "Hazmat"], ["overweight", "Overweight"], ["oversized", "Oversized"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFlags((f) => ({ ...f, [key]: !f[key] }))}
                className={`rounded-lg border py-2.5 text-xs font-semibold transition-colors ${
                  flags[key]
                    ? "border-yellow-400 bg-yellow-400/10 text-yellow-400"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <Field label={direction === "Import" ? "Pickup terminal (port/rail)" : "Empty pickup terminal (depot)"}>
            <TerminalSelect terminals={terminals} value={originTerminalId} onChange={setOriginTerminalId} icon={<Anchor className="h-4 w-4 text-primary" />} />
          </Field>

          {direction === "Export" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Load at (warehouse address)">
                <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="123 Industrial Way" />
              </Field>
              <Field label="City">
                <Input value={pickupCity} onChange={(e) => setPickupCity(e.target.value)} placeholder="Surrey" />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Deliver to (warehouse address)">
                <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="123 Industrial Way" />
              </Field>
              <Field label="City">
                <Input value={deliveryCity} onChange={(e) => setDeliveryCity(e.target.value)} placeholder="Surrey" />
              </Field>
            </div>
          )}

          <Field label={direction === "Export" ? "Deliver to terminal (port/rail)" : "Return terminal (if different)"}>
            <TerminalSelect terminals={terminals} value={destinationTerminalId} onChange={setDestinationTerminalId} icon={<Train className="h-4 w-4 text-emerald-400" />} />
          </Field>

          <Field label="Handling at the stop">
            <div className="grid grid-cols-3 gap-2">
              {HANDLING_MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setHandlingMode(m.key)}
                  className={`rounded-xl border p-2.5 text-left transition-colors ${
                    handlingMode === m.key ? "border-primary bg-primary/10" : "border-border hover:border-white/20"
                  }`}
                >
                  <p className="text-xs font-bold">{m.title}</p>
                  <p className="text-[10px] text-muted-foreground">{m.desc}</p>
                </button>
              ))}
            </div>
          </Field>
          {handlingMode === "DropPick" && (
            <Field label="Pick-up back date (when to collect after load/unload)">
              <Input value={pickupBackDate} onChange={(e) => setPickupBackDate(e.target.value)} placeholder="2026-07-16" />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Port reservation date">
              <Input value={resDate} onChange={(e) => setResDate(e.target.value)} placeholder="2026-07-15" />
            </Field>
            <Field label="Time">
              <Input value={resTime} onChange={(e) => setResTime(e.target.value)} placeholder="14:30" />
            </Field>
          </div>

          <button
            onClick={() => setIsPrepull((v) => !v)}
            className={`flex w-full items-center gap-2 rounded-xl border px-3.5 py-3 text-sm font-semibold transition-colors ${
              isPrepull ? "border-purple-400/50 bg-purple-500/10 text-purple-300" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="h-4 w-4" />
            Prepull (pick up day before)
          </button>
          {isPrepull && (
            <Field label="Prepull pickup date">
              <Input value={prepullDate} onChange={(e) => setPrepullDate(e.target.value)} placeholder="2026-07-14" />
            </Field>
          )}

          <Field label="Send to">
            <div className="relative">
              <select
                value={targetCompanyId}
                onChange={(e) => setTargetCompanyId(e.target.value)}
                className="flex h-9 w-full appearance-none rounded-md border border-border bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Open to all drayage companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.city ? ` · ${c.city}` : ""}
                  </option>
                ))}
              </select>
              <Users className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {targetCompanyId
                ? "Only this company will see the order and can quote it."
                : "Every drayage company can see it and send you a quote — you pick the winner."}
            </p>
          </Field>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Special instructions…" />
          </Field>

          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button className="w-full" disabled={create.isPending} onClick={() => { setError(null); create.mutate(); }}>
            <Ship className="mr-2 h-4 w-4" />
            Submit order
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ChipRow({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === o ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function TerminalSelect({
  terminals,
  value,
  onChange,
  icon,
}: {
  terminals: Terminal[];
  value: string;
  onChange: (v: string) => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-2.5">{icon}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full appearance-none rounded-md border border-border bg-background pl-9 pr-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">Select terminal</option>
        {terminals.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.code}){t.city ? ` · ${t.city}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
