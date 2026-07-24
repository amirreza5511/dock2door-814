"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  MapPin,
  Package,
  Radio,
  Ship,
  Truck,
} from "lucide-react";
import { useExplore, useActionGuard } from "@/lib/explore-store";

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
  target_drayage_company_id: string | null;
  [k: string]: unknown;
}

interface MoveRow {
  id: string;
  move_type: string;
  status: string;
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
  speed_kph: number | null;
  heading: number | null;
  recorded_at: string;
}

interface TerminalRow {
  id: string;
  name: string;
  code: string;
  geo_lat: number | null;
  geo_lng: number | null;
}

interface QuoteRow {
  id: string;
  status: string;
  price: number;
  currency: string;
  eta_note: string | null;
  message: string | null;
  companies: { id: string; name: string; city: string | null } | null;
}

function sampleDrayageDetail(orderId: string): { order: DrayageOrder; moves: MoveRow[]; tracking: TrackingRow[] } {
  const order: DrayageOrder = {
    id: orderId, reference_code: "DRY-10428", direction: "Import", status: "Assigned",
    container_number: "MSKU7841200", container_size: "40ft", container_type: "Standard", weight_kg: 18500,
    bol_number: "BOL-55821", booking_number: "BKG-2201", commodity: "Retail furniture, palletized",
    is_hazmat: false, is_overweight: false, is_oversized: false, origin_terminal_id: "ex-term-1",
    destination_terminal_id: null, pickup_address: null, delivery_address: "Burnaby DC, 4000 Still Creek Ave",
    port_reservation_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), port_reservation_time: "10:00",
    port_reservation_confirmed: true, is_prepull: false, prepull_pickup_date: null, target_drayage_company_id: null,
  };
  const moves: MoveRow[] = [
    { id: "ex-mv-1", move_type: "Port pickup", status: "Completed", appt_date: new Date().toISOString().slice(0, 10), appt_time: "10:00", pickup_photo_path: null, delivery_photo_path: null, picked_up_at: new Date(Date.now() - 3600000 * 3).toISOString(), delivered_at: null, captured_container_number: "MSKU7841200", receiver_name: null },
    { id: "ex-mv-2", move_type: "Delivery to DC", status: "InProgress", appt_date: new Date().toISOString().slice(0, 10), appt_time: "14:00", pickup_photo_path: null, delivery_photo_path: null, picked_up_at: null, delivered_at: null, captured_container_number: null, receiver_name: null },
  ];
  return { order, moves, tracking: [] };
}

const STATUS_LABEL: Record<string, string> = {
  Open: "Open — waiting for drayage company",
  Assigned: "Drayage company assigned",
  Dispatched: "Driver dispatched",
  EnRoute: "Driver en route to pickup",
  PickedUp: "Container picked up",
  InTransit: "Container in transit",
  Delivered: "Delivered",
  EmptyReturned: "Empty returned",
  Cancelled: "Cancelled",
};

export default function CustomerDrayageOrderDetailPage() {
  const supabase = getBrowserSupabase();
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const queryClient = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();

  const detailsQuery = useQuery({
    queryKey: ["customer", "drayage-order", orderId],
    refetchInterval: 10000,
    enabled: !!orderId && !isExploring,
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

  const quotesQuery = useQuery({
    queryKey: ["customer", "drayage-order-quotes", orderId],
    refetchInterval: 15000,
    enabled: !!orderId && !isExploring,
    queryFn: async (): Promise<QuoteRow[]> => {
      const { data, error } = await supabase
        .from("drayage_quotes")
        .select("*, companies:drayage_company_id(id, name, city)")
        .eq("order_id", orderId)
        .order("price", { ascending: true });
      if (error) return [];
      return (data as QuoteRow[] | null) ?? [];
    },
  });

  const terminalsQuery = useQuery({
    queryKey: ["terminals-active"],
    enabled: !isExploring,
    queryFn: async (): Promise<TerminalRow[]> => {
      const { data } = await supabase.from("terminals").select("*").eq("is_active", true).order("name");
      return (data as TerminalRow[] | null) ?? [];
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      const { error } = await supabase.rpc("accept_drayage_quote", { p_quote_id: quoteId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer", "drayage-order", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["customer", "drayage-order-quotes", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["customer", "drayage-orders"] }),
      ]);
    },
  });

  const exploreData = useMemo(() => (isExploring ? sampleDrayageDetail(orderId) : null), [isExploring, orderId]);
  const order = isExploring ? exploreData?.order : detailsQuery.data?.order;
  const moves = useMemo(() => (isExploring ? exploreData?.moves ?? [] : detailsQuery.data?.moves ?? []), [detailsQuery.data, isExploring, exploreData]);
  const allTracking = useMemo(() => (isExploring ? [] : detailsQuery.data?.tracking ?? []), [detailsQuery.data, isExploring]);
  const terminals = useMemo(() => terminalsQuery.data ?? [], [terminalsQuery.data]);
  const quotes = useMemo(
    () => (quotesQuery.data ?? []).filter((q) => q.status !== "Withdrawn"),
    [quotesQuery.data],
  );
  const latestTracking = allTracking[0] ?? null;

  const terminalName = (id: string | null): string => {
    if (!id) return "—";
    const t = terminals.find((t) => t.id === id);
    return t ? `${t.name} (${t.code})` : "—";
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

  if (!isExploring && detailsQuery.isLoading) {
    return <p className="p-8 text-sm text-muted-foreground">Loading order…</p>;
  }
  if (!isExploring && (detailsQuery.isError || !order)) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Order not found.</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  if (!order) return null;

  const isActive = ["Dispatched", "EnRoute", "PickedUp", "InTransit"].includes(order.status);

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

      {/* Status banner */}
      <Card>
        <CardContent className="flex items-center gap-3 pt-6">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-muted">
            {isActive ? (
              <Radio className="h-5 w-5 text-primary" />
            ) : order.status === "Delivered" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            ) : (
              <Package className="h-5 w-5 text-blue-400" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{STATUS_LABEL[order.status] ?? order.status}</p>
            <p className="text-xs text-muted-foreground">
              {latestTracking
                ? `Last update: ${new Date(latestTracking.recorded_at).toLocaleString()}`
                : isActive
                  ? "Waiting for driver location…"
                  : "Not yet in transit"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Live tracking */}
      {latestTracking ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-emerald-400" /> Live container location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-6 rounded-lg bg-muted px-4 py-3">
              <span className="text-2xl font-bold tracking-tight text-emerald-400">{latestTracking.lat.toFixed(4)}</span>
              <span className="text-2xl font-bold tracking-tight text-emerald-400">{latestTracking.lng.toFixed(4)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetaCell label="Speed" value={latestTracking.speed_kph ? `${latestTracking.speed_kph} kph` : "—"} />
              <MetaCell label="Heading" value={latestTracking.heading ? `${Math.round(latestTracking.heading)}°` : "—"} />
              <MetaCell
                label="Updated"
                value={new Date(latestTracking.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Quotes (only while open) */}
      {order.status === "Open" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-emerald-400" /> Quotes {quotes.length > 0 ? `(${quotes.length})` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {order.target_drayage_company_id
                  ? "Waiting for the invited company to send a quote…"
                  : "No quotes yet — drayage companies will send you prices shortly."}
              </p>
            ) : (
              quotes.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted">
                    <Building2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{q.companies?.name ?? "Drayage company"}</p>
                    {q.eta_note ? <p className="text-xs text-muted-foreground">{q.eta_note}</p> : null}
                    {q.message ? <p className="text-xs italic text-muted-foreground">{q.message}</p> : null}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="text-sm font-bold text-emerald-400">
                      {q.currency} {q.price}
                    </span>
                    <Button
                      size="sm"
                      disabled={acceptMutation.isPending}
                      onClick={() => {
                        if (!guard("Accept this quote")) return;
                        if (
                          window.confirm(
                            `${q.companies?.name ?? "This company"} will be assigned at ${q.currency} ${q.price}. Other quotes will be declined.`,
                          )
                        ) {
                          acceptMutation.mutate(q.id);
                        }
                      }}
                    >
                      Accept
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

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
              <RouteStop color="bg-blue-400" label="Pickup from:" value={terminalName(order.origin_terminal_id)} />
              <RouteLine />
              <RouteStop
                color="bg-emerald-400"
                label="Deliver to:"
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
      {order.port_reservation_date ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className={`h-4 w-4 ${order.port_reservation_confirmed ? "text-emerald-400" : "text-yellow-400"}`} />
              Port reservation
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-base font-semibold">{order.port_reservation_date}</p>
              <p className="text-xs text-muted-foreground">{order.port_reservation_time}</p>
            </div>
            {order.port_reservation_confirmed ? (
              <Badge className="bg-emerald-500/15 text-emerald-300">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Confirmed
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
              Container picked up {order.prepull_pickup_date ? `on ${order.prepull_pickup_date}` : "day before"} and held at
              yard. Delivered next day.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Move progress */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4 text-primary" /> Move progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {moves.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No moves yet — the drayage company will dispatch drivers for this order.
            </p>
          ) : (
            moves.map((m, i) => (
              <div key={m.id} className="space-y-2 rounded-lg border border-white/5 bg-card/60 p-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-muted text-xs font-bold text-primary">
                    {i + 1}
                  </div>
                  <p className="flex-1 text-sm font-semibold">{m.move_type}</p>
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
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Location history */}
      {allTracking.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-muted-foreground" /> Location history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {allTracking.slice(0, 10).map((t, i) => (
              <div key={t.id} className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${i === 0 ? "bg-emerald-400" : "bg-muted-foreground"}`} />
                <div>
                  <p className="text-sm font-medium">
                    {t.lat.toFixed(3)}, {t.lng.toFixed(3)}
                  </p>
                  <p className="text-xs text-muted-foreground">{new Date(t.recorded_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-2.5 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
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
