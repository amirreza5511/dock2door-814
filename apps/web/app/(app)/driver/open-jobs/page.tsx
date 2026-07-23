"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine, MapPin, Package, Truck, Warehouse } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const VEHICLE_LABEL: Record<string, string> = {
  Bicycle: "Bicycle",
  Motorcycle: "Motorcycle",
  Car: "Car",
  Pickup: "Pickup truck",
  MovingTruck: "Moving truck",
  FiveTon: "5-ton truck",
  FlatDeck: "Flat deck",
  Semi: "Semi truck",
};

interface OpenLeg {
  id: string;
  vehicle_type: string;
  pallets: number;
  distance_km: number;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  pickup_city?: string | null;
  dropoff_city?: string | null;
  hub_name?: string | null;
  hub_leg_status: string;
  provider_net: number;
  [k: string]: unknown;
}

type LegKind = "pickup" | "delivery";

function legOf(l: OpenLeg): LegKind {
  return l.hub_leg_status === "Released" ? "delivery" : "pickup";
}

/** Open jobs board — hub-routed pickup/delivery legs a driver can self-claim. */
const SAMPLE_LEGS: OpenLeg[] = [
  { id: "ex-lg-1", vehicle_type: "FiveTon", pallets: 6, distance_km: 18, pickup_address: "1200 Industrial Ave, Vancouver", dropoff_address: null, pickup_city: "Vancouver", dropoff_city: null, hub_name: "Metro Hub — Burnaby", hub_leg_status: "Pending", provider_net: 142 },
  { id: "ex-lg-2", vehicle_type: "Pickup", pallets: 2, distance_km: 12, pickup_address: null, dropoff_address: "8800 Bridgeport Rd, Richmond", pickup_city: null, dropoff_city: "Richmond", hub_name: "Metro Hub — Burnaby", hub_leg_status: "Released", provider_net: 88 },
  { id: "ex-lg-3", vehicle_type: "MovingTruck", pallets: 4, distance_km: 27, pickup_address: "455 Fraser St, Surrey", dropoff_address: null, pickup_city: "Surrey", dropoff_city: null, hub_name: "South Hub — Delta", hub_leg_status: "Pending", provider_net: 176 },
  { id: "ex-lg-4", vehicle_type: "Car", pallets: 1, distance_km: 9, pickup_address: null, dropoff_address: "120 Lonsdale Ave, North Vancouver", pickup_city: null, dropoff_city: "North Vancouver", hub_name: "Metro Hub — Burnaby", hub_leg_status: "Released", provider_net: 61 },
];

export default function DriverOpenJobsPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const supabase = getBrowserSupabase();
  const router = useRouter();
  const qc = useQueryClient();
  const [zone, setZone] = useState<string>("");
  const [filter, setFilter] = useState<"all" | LegKind>("all");
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["driver", "open-legs"],
    enabled: !isExploring,
    refetchInterval: isExploring ? false : 20000,
    queryFn: async (): Promise<OpenLeg[]> => {
      const { data, error: err } = await supabase
        .from("loads")
        .select("*")
        .eq("uses_hub", true)
        .is("archived_at", null)
        .or("and(hub_leg_status.eq.Pending,pickup_leg_driver_user_id.is.null),and(hub_leg_status.eq.Released,delivery_leg_driver_user_id.is.null)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (err) return [];
      return (data as OpenLeg[] | null) ?? [];
    },
  });

  const claim = useMutation({
    mutationFn: async ({ id, leg }: { id: string; leg: LegKind }) => {
      if (!guard("Take this leg")) return;
      const { error: err } = await supabase.rpc("claim_load_leg", { p_load_id: id, p_leg: leg });
      if (err) throw new Error(err.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["driver", "open-legs"] });
      router.push("/driver/my-loads");
    },
    onError: (e: Error) => setError(e.message),
  });

  const legs = useMemo(() => (isExploring ? SAMPLE_LEGS : (q.data ?? [])), [q.data, isExploring]);
  const filtered = useMemo(() => {
    const z = zone.trim().toLowerCase();
    return legs.filter((l) => {
      const kind = legOf(l);
      if (filter !== "all" && kind !== filter) return false;
      if (!z) return true;
      const city = kind === "delivery" ? String(l.dropoff_city ?? "") : String(l.pickup_city ?? "");
      return city.toLowerCase().includes(z);
    });
  }, [legs, zone, filter]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Driver</p>
        <h1 className="text-2xl font-semibold tracking-tight">Open jobs board</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hub-routed pickup and delivery legs. Take a leg and it moves into My loads to start.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          placeholder="Filter by zone / city (e.g. Coquitlam)"
          className="sm:max-w-xs"
        />
        <div className="flex gap-1 rounded-lg border border-white/10 bg-card p-1">
          {([["all", "All legs"], ["pickup", "Pickup → hub"], ["delivery", "Hub → drop"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Card className="border-red-500/40">
          <CardContent className="pt-6 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      {!isExploring && q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading open jobs…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Truck className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No open jobs</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Pickup and delivery legs routed through the hub network will appear here. Check back — new next-day and
            next-week runs post throughout the day.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((l) => {
            const kind = legOf(l);
            const from = kind === "delivery" ? (l.hub_name || "Hub") : (l.pickup_address || "Pickup point");
            const to = kind === "delivery" ? (l.dropoff_address || "Drop-off point") : (l.hub_name || "Hub");
            return (
              <Card key={l.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <Badge className={kind === "delivery" ? "gap-1 bg-primary/15 text-primary" : "gap-1 bg-blue-500/15 text-blue-300"}>
                      {kind === "delivery" ? <ArrowUpFromLine className="h-3 w-3" /> : <Warehouse className="h-3 w-3" />}
                      {kind === "delivery" ? "Delivery leg" : "Pickup leg"}
                    </Badge>
                    <Badge variant="secondary">{VEHICLE_LABEL[l.vehicle_type] ?? l.vehicle_type}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                      <span className="truncate">{from}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                      <span className="truncate">{to}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Package className="h-3 w-3" />{l.pallets} {l.pallets === 1 ? "pallet" : "pallets"}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{l.distance_km} km</span>
                    <span className="ml-auto text-sm font-bold text-emerald-400">${Number(l.provider_net).toFixed(2)}</span>
                  </div>
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={claim.isPending}
                    onClick={() => {
                      setError(null);
                      const ok = window.confirm(
                        kind === "pickup"
                          ? "Take the pickup leg? You run pickup → hub. It moves into My loads to start."
                          : "Take the delivery leg? You run hub → final drop-off. It moves into My loads to start.",
                      );
                      if (ok) claim.mutate({ id: l.id, leg: kind });
                    }}
                  >
                    <Truck className="mr-2 h-4 w-4" />
                    Take this leg
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
