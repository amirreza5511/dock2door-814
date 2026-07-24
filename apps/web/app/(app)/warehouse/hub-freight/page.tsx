"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Clock, Layers, PackageCheck } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const SAMPLE_HUB_LOADS: HubLoad[] = [
  { id: "ex-hl-1", cargo_type: "Pallet", pallets: 6, status: "EnRoute", pickup_address: "Seattle, WA", dropoff_address: "Surrey, BC", hub_leg_status: "Pending", created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
  { id: "ex-hl-2", cargo_type: "Box", pallets: 1, status: "EnRoute", pickup_address: "Kelowna, BC", dropoff_address: "Vancouver, BC", hub_leg_status: "Pending", created_at: new Date(Date.now() - 3600000 * 2).toISOString() },
  { id: "ex-hl-3", cargo_type: "Pallet", pallets: 4, status: "AtHub", dropoff_address: "Burnaby, BC", hub_leg_status: "AtHub", hub_arrived_at: new Date(Date.now() - 86400000 * 2).toISOString(), storage_per_day: 12, storage_payer: "receiver", created_at: new Date(Date.now() - 86400000 * 3).toISOString() },
];

const CARGO_LABEL: Record<string, string> = {
  Envelope: "Envelope / Letter",
  Box: "Box / Parcel",
  Pallet: "Pallet(s)",
  Crate: "Crate",
  Container: "Container",
  FullLoad: "Full truckload",
};

interface HubLoad {
  id: string;
  cargo_type: string;
  pallets: number;
  status: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  hub_leg_status: string;
  hub_arrived_at?: string | null;
  storage_per_day?: number;
  storage_payer?: string;
  created_at: string;
  [k: string]: unknown;
}

function daysAtHub(arrivedAt?: string | null): number {
  if (!arrivedAt) return 0;
  const ms = Date.now() - new Date(arrivedAt).getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

/** Network Hub — inbound & outbound freight for the warehouse hub. Mirrors mobile hub-freight. */
export default function HubFreightPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const companyId = useActiveCompanyId();
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["warehouse", "hub-freight", companyId],
    enabled: !!companyId && !isExploring,
    refetchInterval: 20000,
    queryFn: async (): Promise<HubLoad[]> => {
      const { data, error: err } = await supabase
        .from("loads")
        .select("*")
        .eq("hub_company_id", companyId as string)
        .in("hub_leg_status", ["Pending", "AtHub"])
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (err) return [];
      return (data as HubLoad[] | null) ?? [];
    },
  });

  const confirmInbound = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.rpc("hub_confirm_inbound", { p_load_id: id });
      if (err) throw new Error(err.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["warehouse", "hub-freight"] }); },
    onError: (e: Error) => setError(e.message),
  });

  const release = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.rpc("hub_release_load", { p_load_id: id });
      if (err) throw new Error(err.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["warehouse", "hub-freight"] }); },
    onError: (e: Error) => setError(e.message),
  });

  const loads = useMemo(() => (isExploring ? SAMPLE_HUB_LOADS : q.data ?? []), [q.data, isExploring]);
  const inbound = useMemo(() => loads.filter((l) => l.hub_leg_status === "Pending"), [loads]);
  const atHub = useMemo(() => loads.filter((l) => l.hub_leg_status === "AtHub"), [loads]);
  const palletsStored = useMemo(() => atHub.reduce((s, l) => s + Number(l.pallets ?? 0), 0), [atHub]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Network Hub</p>
        <h1 className="text-2xl font-semibold tracking-tight">Inbound &amp; outbound freight</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check freight in when it arrives, hold it in storage, and release it for its final delivery leg.
        </p>
      </div>

      {error && (
        <Card className="border-red-500/40">
          <CardContent className="pt-6 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<ArrowDownToLine className="h-5 w-5 text-blue-400" />} value={String(inbound.length)} label="Expected in" />
        <Stat icon={<Layers className="h-5 w-5 text-primary" />} value={String(atHub.length)} label="In storage" />
        <Stat icon={<PackageCheck className="h-5 w-5 text-emerald-400" />} value={String(palletsStored)} label="Pallets held" />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Expected inbound</h2>
        {!isExploring && q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : inbound.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-white/5 py-10 text-center">
            <ArrowDownToLine className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing expected</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Freight routed to your hub from the delivery network will appear here to check in.
            </p>
          </div>
        ) : (
          inbound.map((l) => (
            <Card key={l.id}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-500/15 text-blue-300">{CARGO_LABEL[l.cargo_type] ?? l.cargo_type}</Badge>
                  <span className="text-xs font-medium text-muted-foreground">
                    {l.pallets} {l.pallets === 1 ? "pallet" : "pallets"}
                  </span>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    From: {l.pickup_address || "Pickup point"}
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                    To: {l.dropoff_address || "Drop-off point"}
                  </p>
                </div>
                <Button size="sm" className="w-full" onClick={() => { if (!guard("Confirm arrival at hub")) return; setError(null); confirmInbound.mutate(l.id); }} disabled={confirmInbound.isPending}>
                  <ArrowDownToLine className="mr-2 h-4 w-4" /> Confirm arrival at hub
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">In storage</h2>
        {atHub.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-white/5 py-10 text-center">
            <Layers className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-medium">Storage empty</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Once you check freight in, it shows here with accruing daily storage until you release it.
            </p>
          </div>
        ) : (
          atHub.map((l) => {
            const days = daysAtHub(l.hub_arrived_at);
            const charge = (Number(l.storage_per_day ?? 0) * days).toFixed(2);
            return (
              <Card key={l.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-blue-500/15 text-blue-300">{CARGO_LABEL[l.cargo_type] ?? l.cargo_type}</Badge>
                    <span className="text-xs font-medium text-muted-foreground">
                      {l.pallets} {l.pallets === 1 ? "pallet" : "pallets"}
                    </span>
                    <Badge className="ml-auto gap-1 bg-primary/15 text-primary">
                      <Clock className="h-3 w-3" />{days}d
                    </Badge>
                  </div>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                    To: {l.dropoff_address || "Drop-off point"}
                  </p>
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Storage so far</span>
                    <span className="font-bold">
                      ${charge}{" "}
                      <span className="text-xs font-medium text-muted-foreground">
                        ({l.storage_payer === "receiver" ? "receiver pays" : "shipper pays"})
                      </span>
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={release.isPending}
                    onClick={() => {
                      if (!guard("Release for final delivery")) return;
                      setError(null);
                      const ok = window.confirm(
                        `Release for delivery? Storage: ${days} day(s) · $${charge} (${l.storage_payer === "receiver" ? "billed to receiver" : "billed to shipper"}). This releases the goods for their final leg.`,
                      );
                      if (ok) release.mutate(l.id);
                    }}
                  >
                    <ArrowUpFromLine className="mr-2 h-4 w-4" /> Release for final delivery
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
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
