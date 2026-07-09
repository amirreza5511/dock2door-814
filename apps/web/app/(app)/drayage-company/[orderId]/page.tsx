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
  Ship,
  Truck,
  User,
  X,
} from "lucide-react";

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

  const detailsQuery = useQuery({
    queryKey: ["dc", "drayage-order", orderId],
    refetchInterval: 15000,
    enabled: !!orderId,
    queryFn: async () => {
      const [orderRes, movesRes, trackingRes] = await Promise.all([
        supabase.from("drayage_orders").select("*").eq("id", orderId).maybeSingle(),
        supabase.from("drayage_moves").select("*").eq("order_id", orderId).order("sequence", { ascending: true }),
        supabase.from("container_tracking").select("*").eq("order_id", orderId).order("recorded_at", { ascending: false }).limit(20),
      ]);
      if (orderRes.error || !orderRes.data) throw new Error(orderRes.error?.message ?? "Order not found");
      return {
        order: orderRes.data as DrayageOrder,
        moves: (movesRes.data as MoveRow[] | null) ?? [],
        tracking: (trackingRes.data as TrackingRow[] | null) ?? [],
      };
    },
  });

  const order = detailsQuery.data?.order;
  const moves = useMemo(() => detailsQuery.data?.moves ?? [], [detailsQuery.data]);
  const allTracking = useMemo(() => detailsQuery.data?.tracking ?? [], [detailsQuery.data]);
  const latestTracking = allTracking[0] ?? null;

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
