"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  Repeat2,
  Ship,
  Truck,
  User,
  X,
  Layers,
  DollarSign,
  ClipboardCheck,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { orderCharges, chargeChipLabel } from "@/lib/drayage-charges";

const URGENCY_TEXT: Record<string, string> = { over: "text-red-400", soon: "text-yellow-400", ok: "text-emerald-400", none: "text-muted-foreground" };
const URGENCY_BG: Record<string, string> = { over: "bg-red-500/15", soon: "bg-yellow-500/15", ok: "bg-emerald-500/15", none: "bg-muted" };

interface DrayageOrder {
  id: string;
  reference_code: string | null;
  direction: string | null;
  status: string;
  container_number: string | null;
  container_size: string | null;
  container_type: string | null;
  weight_kg: number | null;
  bol_number: string | null;
  booking_number: string | null;
  commodity: string | null;
  is_hazmat: boolean | null;
  is_overweight: boolean | null;
  is_oversized: boolean | null;
  origin_terminal_id: string | null;
  destination_terminal_id: string | null;
  pickup_address: string | null;
  delivery_address: string | null;
  port_reservation_date: string | null;
  port_reservation_time: string | null;
  port_reservation_confirmed: boolean | null;
  is_prepull: boolean | null;
  prepull_pickup_date: string | null;
  prepull_yard_terminal_id: string | null;
  drayage_company_id: string | null;
  truck_id?: string | null;
  chassis_id?: string | null;
  trailer_id?: string | null;
  shipping_line_id?: string | null;
  mt_reported_at?: string | null;
  street_turn_order_id?: string | null;
  street_turn_role?: string | null;
  street_turn_saved_miles?: number | null;
  per_diem_last_free_day?: string | null;
  per_diem_daily_rate?: number | null;
  demurrage_last_free_day?: string | null;
  demurrage_daily_rate?: number | null;
  storage_last_free_day?: string | null;
  storage_daily_rate?: number | null;
  [k: string]: unknown;
}

interface MoveRow {
  id: string;
  move_type: string;
  status: string;
  driver_user_id: string | null;
  appt_date: string | null;
  appt_time: string | null;
  pickup_photo_path: string | null;
  delivery_photo_path: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  captured_container_number: string | null;
  receiver_name: string | null;
}

interface TrackingRow {
  id: string;
  lat: number;
  lng: number;
  recorded_at: string;
}

interface TerminalRow {
  id: string;
  name: string;
  code: string;
}

interface DriverRow {
  id: string;
  driver_user_id: string | null;
  name: string | null;
  license_number: string | null;
  license_class: string | null;
  data: { name?: string; userId?: string } | null;
}

export default function DrayageCompanyOrderDetailPage() {
  const supabase = getBrowserSupabase();
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const queryClient = useQueryClient();

  const [portModal, setPortModal] = useState(false);
  const [dispatchModal, setDispatchModal] = useState<MoveRow | null>(null);
  const [resDate, setResDate] = useState("");
  const [resTime, setResTime] = useState("");
  const [equipModal, setEquipModal] = useState(false);
  const [chargeModal, setChargeModal] = useState(false);
  const [lineModal, setLineModal] = useState(false);
  const [handlingModal, setHandlingModal] = useState(false);
  const [handlingMode, setHandlingMode] = useState<"LiveLoad" | "LiveUnload" | "DropPick">("LiveUnload");
  const [pickupBackDate, setPickupBackDate] = useState("");
  const [selTruck, setSelTruck] = useState<string | null>(null);
  const [selChassis, setSelChassis] = useState<string | null>(null);
  const [selTrailer, setSelTrailer] = useState<string | null>(null);
  const [pdRate, setPdRate] = useState(""); const [pdLfd, setPdLfd] = useState("");
  const [dmRate, setDmRate] = useState(""); const [dmLfd, setDmLfd] = useState("");
  const [stRate, setStRate] = useState(""); const [stLfd, setStLfd] = useState("");

  const detailsQuery = useQuery({
    queryKey: ["dc", "drayage-order", orderId],
    refetchInterval: 15000,
    enabled: !!orderId,
    queryFn: async () => {
      const [orderRes, movesRes, trackingRes, inspRes, docsRes] = await Promise.all([
        supabase.from("drayage_orders").select("*").eq("id", orderId).maybeSingle(),
        supabase.from("drayage_moves").select("*").eq("order_id", orderId).order("sequence", { ascending: true }),
        supabase.from("container_tracking").select("*").eq("order_id", orderId).order("recorded_at", { ascending: false }).limit(20),
        supabase.from("equipment_inspections").select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
        supabase.from("drayage_documents").select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
      ]);
      if (orderRes.error || !orderRes.data) throw new Error(orderRes.error?.message ?? "Order not found");
      const ord = orderRes.data as DrayageOrder;
      const [truckRes, chassisRes, trailerRes, lineRes, stRes] = await Promise.all([
        ord.truck_id ? supabase.from("trucks").select("*").eq("id", ord.truck_id as string).maybeSingle() : Promise.resolve({ data: null }),
        ord.chassis_id ? supabase.from("chassis").select("*").eq("id", ord.chassis_id as string).maybeSingle() : Promise.resolve({ data: null }),
        ord.trailer_id ? supabase.from("trailers").select("*").eq("id", ord.trailer_id as string).maybeSingle() : Promise.resolve({ data: null }),
        ord.shipping_line_id ? supabase.from("shipping_lines").select("*").eq("id", ord.shipping_line_id as string).maybeSingle() : Promise.resolve({ data: null }),
        ord.street_turn_order_id
          ? supabase.from("drayage_orders").select("id, reference_code, status").eq("id", ord.street_turn_order_id as string).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        order: ord,
        moves: (movesRes.data as MoveRow[] | null) ?? [],
        tracking: (trackingRes.data as TrackingRow[] | null) ?? [],
        inspections: (inspRes.data as Record<string, unknown>[] | null) ?? [],
        documents: (docsRes.data as Record<string, unknown>[] | null) ?? [],
        truck: truckRes.data as Record<string, unknown> | null,
        chassis: chassisRes.data as Record<string, unknown> | null,
        trailer: trailerRes.data as Record<string, unknown> | null,
        shippingLine: lineRes.data as Record<string, unknown> | null,
        streetTurnOrder: stRes.data as { id: string; reference_code: string | null; status: string } | null,
      };
    },
  });

  const order = detailsQuery.data?.order;
  const moves = useMemo(() => detailsQuery.data?.moves ?? [], [detailsQuery.data]);
  const allTracking = useMemo(() => detailsQuery.data?.tracking ?? [], [detailsQuery.data]);
  const latestTracking = allTracking[0] ?? null;
  const inspections = useMemo(() => detailsQuery.data?.inspections ?? [], [detailsQuery.data]);
  const documents = useMemo(() => detailsQuery.data?.documents ?? [], [detailsQuery.data]);
  const linkedTruck = detailsQuery.data?.truck ?? null;
  const linkedChassis = detailsQuery.data?.chassis ?? null;
  const linkedTrailer = detailsQuery.data?.trailer ?? null;
  const shippingLine = detailsQuery.data?.shippingLine ?? null;
  const streetTurnOrder = detailsQuery.data?.streetTurnOrder ?? null;
  const charges = useMemo(() => (order ? orderCharges(order as Record<string, unknown>) : []), [order]);

  const terminalsQuery = useQuery({
    queryKey: ["terminals-active"],
    queryFn: async (): Promise<TerminalRow[]> => {
      const { data } = await supabase.from("terminals").select("id, name, code").eq("is_active", true).order("name");
      return (data as TerminalRow[] | null) ?? [];
    },
  });
  const terminals = useMemo(() => terminalsQuery.data ?? [], [terminalsQuery.data]);

  const driversQuery = useQuery({
    queryKey: ["dc", "drivers", order?.drayage_company_id],
    enabled: !!order?.drayage_company_id,
    queryFn: async (): Promise<DriverRow[]> => {
      const { data } = await supabase
        .from("drivers")
        .select("*")
        .eq("company_id", order!.drayage_company_id!)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      return (data as DriverRow[] | null) ?? [];
    },
  });
  const drivers = useMemo(() => driversQuery.data ?? [], [driversQuery.data]);

  useEffect(() => {
    if (order?.port_reservation_date) setResDate(String(order.port_reservation_date));
    if (order?.port_reservation_time) setResTime(order.port_reservation_time);
  }, [order?.port_reservation_date, order?.port_reservation_time]);

  const terminalName = (id: string | null): string => {
    if (!id) return "—";
    const t = terminals.find((t) => t.id === id);
    return t ? `${t.name} (${t.code})` : "—";
  };

  const portResMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_port_reservation", {
        p_order_id: orderId,
        p_reservation_date: resDate.trim(),
        p_reservation_time: resTime.trim(),
        p_confirmed: true,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dc", "drayage-order", orderId] });
      setPortModal(false);
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async ({ moveId, driverUserId }: { moveId: string; driverUserId: string }) => {
      const { error } = await supabase.rpc("dispatch_drayage_move", {
        p_move_id: moveId,
        p_driver_user_id: driverUserId,
        p_appt_date: null,
        p_appt_time: "",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dc", "drayage-order", orderId] });
      setDispatchModal(null);
    },
  });

  const unlinkStreetTurn = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("unlink_street_turn", { p_order_id: orderId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dc", "drayage-order", orderId] });
    },
  });

  const equipQuery = useQuery({
    queryKey: ["dc", "equip-lists", order?.drayage_company_id, equipModal],
    enabled: !!order?.drayage_company_id && equipModal,
    queryFn: async () => {
      const cid = order!.drayage_company_id!;
      const [tk, ch, tr] = await Promise.all([
        supabase.from("trucks").select("id,plate,data").eq("company_id", cid).is("archived_at", null),
        supabase.from("chassis").select("id,chassis_number,is_rental").eq("company_id", cid).is("archived_at", null),
        supabase.from("trailers").select("id,plate,data").eq("company_id", cid).is("archived_at", null),
      ]);
      return {
        trucks: (tk.data as Record<string, unknown>[] | null) ?? [],
        chassis: (ch.data as Record<string, unknown>[] | null) ?? [],
        trailers: (tr.data as Record<string, unknown>[] | null) ?? [],
      };
    },
  });

  const linesQuery = useQuery({
    queryKey: ["shipping-lines", lineModal],
    enabled: lineModal,
    queryFn: async (): Promise<Record<string, unknown>[]> => {
      const { data } = await supabase.from("shipping_lines").select("*").eq("is_active", true).order("name");
      return (data as Record<string, unknown>[] | null) ?? [];
    },
  });

  useEffect(() => {
    if (equipModal && order) {
      setSelTruck((order.truck_id as string) ?? null);
      setSelChassis((order.chassis_id as string) ?? null);
      setSelTrailer((order.trailer_id as string) ?? null);
    }
  }, [equipModal, order]);

  const assignEquipMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("assign_drayage_equipment", {
        p_order_id: orderId, p_truck_id: selTruck, p_chassis_id: selChassis, p_trailer_id: selTrailer,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["dc", "drayage-order", orderId] }); setEquipModal(false); },
  });

  const chargesMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_drayage_charges", {
        p_order_id: orderId,
        p_per_diem_free_days: null, p_per_diem_last_free_day: pdLfd.trim() || null, p_per_diem_daily_rate: pdRate.trim() === "" ? 0 : Number(pdRate),
        p_demurrage_free_days: null, p_demurrage_last_free_day: dmLfd.trim() || null, p_demurrage_daily_rate: dmRate.trim() === "" ? 0 : Number(dmRate),
        p_storage_free_days: null, p_storage_last_free_day: stLfd.trim() || null, p_storage_daily_rate: stRate.trim() === "" ? 0 : Number(stRate),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["dc", "drayage-order", orderId] }); setChargeModal(false); },
  });

  const lineMutation = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await supabase.rpc("set_order_shipping_line", { p_order_id: orderId, p_shipping_line_id: lineId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["dc", "drayage-order", orderId] }); setLineModal(false); },
  });

  // Dispatch finalizes/changes how the container is handled at the stop. Migration 0151.
  const handlingMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_drayage_handling_mode", {
        p_order_id: orderId,
        p_handling_mode: handlingMode,
        p_pickup_back_date: handlingMode === "DropPick" ? (pickupBackDate.trim() || null) : null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["dc", "drayage-order", orderId] }); setHandlingModal(false); },
  });

  const openHandlingModal = () => {
    if (!order) return;
    setHandlingMode(((order.handling_mode as string) as "LiveLoad" | "LiveUnload" | "DropPick") ?? "LiveUnload");
    setPickupBackDate((order.pickup_back_date as string) ?? "");
    setHandlingModal(true);
  };

  const openChargeModal = () => {
    if (!order) return;
    setPdRate(order.per_diem_daily_rate ? String(order.per_diem_daily_rate) : ""); setPdLfd((order.per_diem_last_free_day as string) ?? "");
    setDmRate(order.demurrage_daily_rate ? String(order.demurrage_daily_rate) : ""); setDmLfd((order.demurrage_last_free_day as string) ?? "");
    setStRate(order.storage_daily_rate ? String(order.storage_daily_rate) : ""); setStLfd((order.storage_last_free_day as string) ?? "");
    setChargeModal(true);
  };

  // Resolve signed URLs for captured pickup/delivery proof photos.
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const paths = moves
      .flatMap((m) => [m.pickup_photo_path, m.delivery_photo_path])
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (paths.length === 0) return;
    void (async () => {
      const entries = await Promise.all(
        paths.map(async (p) => {
          try {
            const { data, error } = await supabase.functions.invoke("get-signed-url", {
              body: { bucket: "attachments", path: p, expiresIn: 3600 },
            });
            if (error || !data?.signedUrl) return null;
            return [p, data.signedUrl as string] as const;
          } catch {
            return null;
          }
        }),
      );
      setProofUrls((prev) => {
        const next = { ...prev };
        for (const e of entries) if (e) next[e[0]] = e[1];
        return next;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsQuery.data]);

  if (detailsQuery.isLoading) {
    return <p className="p-8 text-sm text-muted-foreground">Loading order…</p>;
  }
  if (detailsQuery.isError || !order) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Order not found.</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-16">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{order.reference_code}</h1>
          <p className="text-xs text-muted-foreground">
            {order.direction} · {order.container_number || "Container TBD"}
          </p>
        </div>
        <Badge>{order.status}</Badge>
      </div>

      {/* Container details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" /> Container details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Detail label="Container #" value={order.container_number || "TBD"} />
            <Detail label="Size" value={order.container_size || "—"} />
            <Detail label="Type" value={order.container_type || "Standard"} />
            <Detail label="Weight" value={order.weight_kg ? `${order.weight_kg}kg` : "—"} />
            <Detail label="BOL" value={order.bol_number || "—"} />
            <Detail label="Booking" value={order.booking_number || "—"} />
          </div>
          {order.commodity ? <p className="text-sm italic text-muted-foreground">{order.commodity}</p> : null}
          {order.is_hazmat || order.is_overweight || order.is_oversized ? (
            <div className="flex flex-wrap gap-2">
              {order.is_hazmat ? <Badge className="bg-red-500/15 text-red-300">Hazmat</Badge> : null}
              {order.is_overweight ? <Badge className="bg-yellow-500/15 text-yellow-300">Overweight</Badge> : null}
              {order.is_oversized ? <Badge className="bg-orange-500/15 text-orange-300">Oversized</Badge> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Route */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ship className="h-4 w-4 text-blue-400" /> Route
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {order.direction === "Import" ? (
            <>
              <RouteStop color="bg-blue-400" label="From (Pickup):" value={terminalName(order.origin_terminal_id)} />
              <RouteLine />
              <RouteStop
                color="bg-emerald-400"
                label="To (Delivery):"
                value={order.delivery_address || terminalName(order.destination_terminal_id)}
              />
            </>
          ) : (
            <>
              <RouteStop color="bg-yellow-400" label="Empty pickup:" value={terminalName(order.origin_terminal_id)} />
              <RouteLine />
              <RouteStop color="bg-primary" label="Load at:" value={order.pickup_address || "Warehouse"} />
              <RouteLine />
              <RouteStop
                color="bg-emerald-400"
                label="Deliver to port/rail:"
                value={terminalName(order.destination_terminal_id)}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Equipment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-blue-400" /> Equipment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Detail label="Truck" value={(linkedTruck?.plate as string) || "—"} />
            <Detail label="Chassis" value={(linkedChassis?.chassis_number as string) || "—"} />
            <Detail label="Trailer" value={(linkedTrailer?.plate as string) || "—"} />
            <Detail label="Container" value={order.container_number || "TBD"} />
          </div>
          {linkedTruck && !linkedChassis && !linkedTrailer ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-yellow-400"><AlertTriangle className="h-3.5 w-3.5" /> Bobtail — no chassis or trailer attached</p>
          ) : null}
          {order.drayage_company_id ? (
            <Button variant="outline" className="w-full" onClick={() => setEquipModal(true)}><Layers className="mr-2 h-4 w-4" /> Assign equipment set</Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Shipping line */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ship className="h-4 w-4 text-primary" /> Shipping line
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">{shippingLine ? `${shippingLine.name as string}${shippingLine.scac ? ` (${shippingLine.scac as string})` : ""}` : "Not set"}</p>
          {order.drayage_company_id ? (
            <Button variant="outline" className="w-full" onClick={() => setLineModal(true)}>{shippingLine ? "Change shipping line" : "Set shipping line"}</Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Handling at the stop */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-blue-400" /> Handling at the stop
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm font-medium">
            {order.handling_mode === "LiveLoad" ? "Live load" : order.handling_mode === "DropPick" ? "Drop & pick" : "Live unload"}
          </p>
          {order.handling_mode === "DropPick" && order.pickup_back_date ? (
            <p className="text-xs text-muted-foreground">Pick-up back on {String(order.pickup_back_date)}</p>
          ) : null}
          {order.drayage_company_id ? (
            <Button variant="outline" className="w-full" onClick={openHandlingModal}><Package className="mr-2 h-4 w-4" /> Change handling</Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Free days & accessorials */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4 text-yellow-400" /> Free days &amp; accessorials
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {charges.map((c) => (
              <span key={c.kind} className={`rounded-full px-2.5 py-1 text-xs font-bold ${URGENCY_BG[c.urgency]} ${URGENCY_TEXT[c.urgency]}`}>{chargeChipLabel(c)}</span>
            ))}
          </div>
          {charges.some((c) => c.amount > 0) ? (
            <p className="text-xs text-muted-foreground">Accrued to date: ${charges.reduce((s, c) => s + c.amount, 0).toFixed(2)} — added to the customer invoice.</p>
          ) : null}
          {order.drayage_company_id ? (
            <Button variant="outline" className="w-full" onClick={openChargeModal}><DollarSign className="mr-2 h-4 w-4" /> Set free days &amp; rates</Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Inspections */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-emerald-400" /> Inspections
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {inspections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inspections recorded yet. Drivers log condition at pickup and drop.</p>
          ) : inspections.map((ins) => (
            <div key={ins.id as string} className="flex items-start gap-2">
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${ins.condition === "Damaged" ? "bg-red-500" : "bg-emerald-500"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{ins.equipment_type as string} · {ins.phase as string} · {ins.condition as string}</p>
                <p className="text-xs text-muted-foreground">{(ins.reference as string) || ""}{ins.damage_notes ? ` — ${ins.damage_notes as string}` : ""}</p>
                <p className="text-[11px] text-muted-foreground">{ins.inspector_role as string} · {new Date(ins.created_at as string).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Documents / POD */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-blue-400" /> Documents (POD / BOL / Interchange)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents attached yet. Drivers scan and upload POD pages from their app.</p>
          ) : documents.map((doc) => (
            <div key={doc.id as string} className="flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{doc.doc_type as string} · {((doc.file_paths as unknown[])?.length ?? 0)} page(s)</p>
                <p className="text-xs text-muted-foreground">{doc.signer_name ? `Signed by ${doc.signer_name as string}` : "Unsigned"} · {new Date(doc.created_at as string).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Port reservation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className={`h-4 w-4 ${order.port_reservation_confirmed ? "text-emerald-400" : "text-yellow-400"}`} />
            Port reservation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {order.port_reservation_date ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold">{order.port_reservation_date}</p>
                <p className="text-xs text-muted-foreground">{order.port_reservation_time}</p>
              </div>
              {order.port_reservation_confirmed ? (
                <Badge className="bg-emerald-500/15 text-emerald-300">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Confirmed
                </Badge>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No port reservation entered yet.</p>
          )}
          <Button variant="outline" className="w-full" onClick={() => setPortModal(true)}>
            <CalendarClock className="mr-2 h-4 w-4" />
            {order.port_reservation_date ? "Update reservation" : "Enter port reservation"}
          </Button>
        </CardContent>
      </Card>

      {/* Prepull */}
      {order.is_prepull ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-purple-400" /> Prepull
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Container picked up {order.prepull_pickup_date ? `on ${order.prepull_pickup_date}` : "day before"} and held at{" "}
              {terminalName(order.prepull_yard_terminal_id)}. Delivered next day.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Street turn pairing */}
      {order.street_turn_order_id ? (
        <Card className="border-purple-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Repeat2 className="h-4 w-4 text-purple-400" /> Street Turn
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {order.street_turn_role === "provider"
                ? "This order’s empty return is paired with a pickup at the same terminal — one loaded round trip instead of two dead runs."
                : "This order’s pickup is covered by a paired empty return arriving at the same terminal."}
              {Number(order.street_turn_saved_miles ?? 0) > 0 ? ` ≈${order.street_turn_saved_miles} empty miles avoided.` : ""}
            </p>
            {streetTurnOrder ? (
              <button
                className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-left transition hover:bg-accent"
                onClick={() => router.push(`/drayage-company/${streetTurnOrder.id}`)}
              >
                <span className="text-sm font-semibold">Paired with {streetTurnOrder.reference_code}</span>
                <Badge variant="secondary">{streetTurnOrder.status}</Badge>
              </button>
            ) : null}
            <Button variant="outline" size="sm" className="w-full" disabled={unlinkStreetTurn.isPending} onClick={() => unlinkStreetTurn.mutate()}>
              {unlinkStreetTurn.isPending ? "Unpairing…" : "Unpair street turn"}
            </Button>
            {unlinkStreetTurn.isError ? <p className="text-xs text-red-400">{(unlinkStreetTurn.error as Error).message}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Moves & driver assignments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4 text-primary" /> Moves &amp; driver assignments
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {moves.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No moves yet — moves are generated when you dispatch drivers for this order.
            </p>
          ) : (
            moves.map((m, i) => {
              const driverName =
                drivers.find((d) => (d.driver_user_id ?? d.data?.userId) === m.driver_user_id)?.data?.name ??
                (m.driver_user_id ? "Assigned" : "Unassigned");
              return (
                <div key={m.id} className="space-y-2 rounded-lg border border-white/5 bg-card/60 p-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-7 w-7 place-items-center rounded-lg bg-muted text-xs font-bold text-primary">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{m.move_type}</p>
                      <p className="text-xs text-muted-foreground">{driverName}</p>
                    </div>
                    <Badge>{m.status}</Badge>
                  </div>
                  {m.appt_date ? (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                      <CalendarClock className="h-3 w-3" /> Appt: {m.appt_date} {m.appt_time}
                    </p>
                  ) : null}
                  {m.pickup_photo_path || m.delivery_photo_path ? (
                    <div className="flex gap-3">
                      {m.pickup_photo_path ? (
                        <ProofCell
                          label="Pickup"
                          color="text-blue-400"
                          url={proofUrls[m.pickup_photo_path]}
                          time={m.picked_up_at}
                          meta={m.captured_container_number ? `#${m.captured_container_number}` : null}
                        />
                      ) : null}
                      {m.delivery_photo_path ? (
                        <ProofCell
                          label="Delivery"
                          color="text-emerald-400"
                          url={proofUrls[m.delivery_photo_path]}
                          time={m.delivered_at}
                          meta={m.receiver_name ? `By ${m.receiver_name}` : null}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  {m.status === "Pending" && order.drayage_company_id ? (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setDispatchModal(m)}>
                      <User className="mr-2 h-4 w-4" /> Assign driver
                    </Button>
                  ) : m.driver_user_id && m.status !== "Completed" && m.status !== "Cancelled" ? (
                    <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      <Truck className="h-3.5 w-3.5" /> Driver handles pickup, transit &amp; drop-off from their app. Track
                      live progress here.
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Live location */}
      {latestTracking ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-emerald-400" /> Live truck location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-6 rounded-lg bg-muted px-4 py-3">
              <span className="text-2xl font-bold tracking-tight text-emerald-400">{latestTracking.lat.toFixed(4)}</span>
              <span className="text-2xl font-bold tracking-tight text-emerald-400">{latestTracking.lng.toFixed(4)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Updated {new Date(latestTracking.recorded_at).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Port reservation modal */}
      {portModal ? (
        <Modal title="Port reservation" onClose={() => setPortModal(false)}>
          <p className="text-sm text-muted-foreground">Enter the reservation date &amp; time from the port portal:</p>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Reservation date (YYYY-MM-DD)</span>
            <Input value={resDate} onChange={(e) => setResDate(e.target.value)} placeholder="2026-07-15" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Reservation time</span>
            <Input value={resTime} onChange={(e) => setResTime(e.target.value)} placeholder="14:30" />
          </label>
          {portResMutation.isError ? (
            <p className="text-xs text-red-400">{(portResMutation.error as Error).message}</p>
          ) : null}
          <Button
            className="w-full"
            disabled={portResMutation.isPending || !resDate.trim() || !resTime.trim()}
            onClick={() => portResMutation.mutate()}
          >
            Save reservation
          </Button>
        </Modal>
      ) : null}

      {/* Dispatch driver modal */}
      {dispatchModal ? (
        <Modal title="Assign driver" onClose={() => setDispatchModal(null)}>
          <p className="text-sm text-muted-foreground">Select a driver from your fleet:</p>
          {dispatchMutation.isError ? (
            <p className="text-xs text-red-400">{(dispatchMutation.error as Error).message}</p>
          ) : null}
          {drivers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No drivers — add drivers in Fleet first.</p>
          ) : (
            <div className="space-y-2">
              {drivers.map((d) => {
                const driverUserId = d.driver_user_id ?? d.data?.userId;
                return (
                  <button
                    key={d.id}
                    disabled={dispatchMutation.isPending}
                    onClick={() => {
                      if (!driverUserId) {
                        window.alert(
                          "This driver has no linked account yet. Edit the driver in Fleet and set the email they signed up with.",
                        );
                        return;
                      }
                      dispatchMutation.mutate({ moveId: dispatchModal.id, driverUserId });
                    }}
                    className="flex w-full items-center gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3 text-left hover:bg-card disabled:opacity-50"
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15">
                      <User className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{d.data?.name ?? d.name ?? "Driver"}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.license_number ?? d.license_class ?? "Tap to assign"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Modal>
      ) : null}

      {/* Equipment assignment modal */}
      {equipModal ? (
        <Modal title="Assign equipment set" onClose={() => setEquipModal(false)}>
          <PickGroup
            label="Truck"
            items={(equipQuery.data?.trucks ?? []).map((t) => ({ id: t.id as string, label: (t.plate as string) || "Truck" }))}
            selected={selTruck}
            onSelect={(id) => setSelTruck(selTruck === id ? null : id)}
            empty="No trucks in fleet."
          />
          <PickGroup
            label="Chassis"
            items={(equipQuery.data?.chassis ?? []).map((c) => ({ id: c.id as string, label: `${c.chassis_number as string}${c.is_rental ? " · R" : ""}` }))}
            selected={selChassis}
            onSelect={(id) => setSelChassis(selChassis === id ? null : id)}
            empty="No chassis in fleet."
          />
          <PickGroup
            label="Trailer (optional)"
            items={(equipQuery.data?.trailers ?? []).map((t) => ({ id: t.id as string, label: (t.plate as string) || "Trailer" }))}
            selected={selTrailer}
            onSelect={(id) => setSelTrailer(selTrailer === id ? null : id)}
            empty="No trailers in fleet."
          />
          {assignEquipMutation.isError ? <p className="text-xs text-red-400">{(assignEquipMutation.error as Error).message}</p> : null}
          <Button className="w-full" disabled={assignEquipMutation.isPending} onClick={() => assignEquipMutation.mutate()}>Save equipment</Button>
        </Modal>
      ) : null}

      {/* Charges modal */}
      {chargeModal ? (
        <Modal title="Free days & rates" onClose={() => setChargeModal(false)}>
          <ChargeInputs title="Per diem (steamship line)" lfd={pdLfd} rate={pdRate} onLfd={setPdLfd} onRate={setPdRate} />
          <ChargeInputs title="Demurrage (port/terminal)" lfd={dmLfd} rate={dmRate} onLfd={setDmLfd} onRate={setDmRate} />
          <ChargeInputs title="Storage (yard/warehouse)" lfd={stLfd} rate={stRate} onLfd={setStLfd} onRate={setStRate} />
          {chargesMutation.isError ? <p className="text-xs text-red-400">{(chargesMutation.error as Error).message}</p> : null}
          <Button className="w-full" disabled={chargesMutation.isPending} onClick={() => chargesMutation.mutate()}>Save charges</Button>
        </Modal>
      ) : null}

      {/* Shipping line modal */}
      {lineModal ? (
        <Modal title="Shipping line" onClose={() => setLineModal(false)}>
          {(linesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {(linesQuery.data ?? []).map((l) => (
                <button
                  key={l.id as string}
                  disabled={lineMutation.isPending}
                  onClick={() => lineMutation.mutate(l.id as string)}
                  className="flex w-full items-center gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3 text-left hover:bg-card disabled:opacity-50"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15"><Ship className="h-4 w-4 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{l.name as string}</p>
                    {l.scac ? <p className="text-xs text-muted-foreground">{l.scac as string}</p> : null}
                  </div>
                  {shippingLine?.id === l.id ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : null}
                </button>
              ))}
            </div>
          )}
        </Modal>
      ) : null}

      {/* Handling mode modal */}
      {handlingModal ? (
        <Modal title="Handling at the stop" onClose={() => setHandlingModal(false)}>
          <p className="text-xs text-muted-foreground">The customer proposed a handling mode. Finalize or change it here for how the container is actually handled at the warehouse stop.</p>
          <div className="space-y-2">
            {([
              { key: "LiveLoad" as const, title: "Live load", desc: "Driver waits while it\u2019s loaded" },
              { key: "LiveUnload" as const, title: "Live unload", desc: "Driver waits while it\u2019s unloaded" },
              { key: "DropPick" as const, title: "Drop & pick", desc: "Drop now, pick up after load/unload" },
            ]).map((m) => {
              const active = handlingMode === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => setHandlingMode(m.key)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left ${active ? "border-primary bg-primary/10" : "border-white/5 bg-card/60 hover:bg-card"}`}
                >
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15"><Package className="h-4 w-4 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{m.title}</p>
                    <p className="text-xs text-muted-foreground">{m.desc}</p>
                  </div>
                  {active ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : null}
                </button>
              );
            })}
          </div>
          {handlingMode === "DropPick" ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Pick-up back date</label>
              <Input type="date" value={pickupBackDate} onChange={(e) => setPickupBackDate(e.target.value)} />
            </div>
          ) : null}
          {handlingMutation.isError ? <p className="text-xs text-red-400">{(handlingMutation.error as Error).message}</p> : null}
          <Button className="w-full" disabled={handlingMutation.isPending} onClick={() => handlingMutation.mutate()}>Save handling</Button>
        </Modal>
      ) : null}
    </div>
  );
}

function PickGroup({ label, items, selected, onSelect, empty }: { label: string; items: { id: string; label: string }[]; selected: string | null; onSelect: (id: string) => void; empty: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => onSelect(it.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${selected === it.id ? "border-primary bg-primary/15 text-primary" : "border-white/10 bg-card/60 text-muted-foreground"}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChargeInputs({ title, lfd, rate, onLfd, onRate }: { title: string; lfd: string; rate: string; onLfd: (v: string) => void; onRate: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="flex gap-3">
        <label className="flex-1 space-y-1">
          <span className="text-[11px] text-muted-foreground">Last free day</span>
          <Input type="date" value={lfd} onChange={(e) => onLfd(e.target.value)} />
        </label>
        <label className="flex-1 space-y-1">
          <span className="text-[11px] text-muted-foreground">Daily rate ($/day)</span>
          <Input value={rate} onChange={(e) => onRate(e.target.value)} placeholder="150" inputMode="decimal" />
        </label>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-3 rounded-xl border border-white/10 bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="outline" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function RouteStop({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`h-3 w-3 rounded-full ${color}`} />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function RouteLine() {
  return <div className="ml-[5px] h-5 w-0.5 bg-border" />;
}

function ProofCell({
  label,
  color,
  url,
  time,
  meta,
}: {
  label: string;
  color: string;
  url: string | undefined;
  time: string | null;
  meta: string | null;
}) {
  return (
    <div className="flex-1 space-y-1">
      <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${color}`}>
        <CheckCircle2 className="h-3 w-3" /> {label}
      </div>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-24 w-full rounded-lg object-cover" />
      ) : (
        <div className="h-24 w-full rounded-lg border border-white/5 bg-muted" />
      )}
      {time ? <p className="text-[10px] text-muted-foreground">{new Date(time).toLocaleString()}</p> : null}
      {meta ? <p className="text-xs font-medium">{meta}</p> : null}
    </div>
  );
}
