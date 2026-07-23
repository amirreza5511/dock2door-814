"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ship, MapPin, Package, Anchor, MessageCircle, Send, Check,
  Truck, Warehouse, CircleDot, Route, Plus,
} from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CONTAINER_SIZES = ["20ft", "40ft", "40ft HC", "LCL"];
const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AED", "CNY"];

type LegType = "OriginPort" | "OceanTransit" | "DestPort" | "Warehouse" | "FinalMile";
const LEG_ICON: Record<LegType, React.ComponentType<{ className?: string }>> = {
  OriginPort: Anchor, OceanTransit: Ship, DestPort: Anchor, Warehouse, FinalMile: Truck,
};

interface OceanRequest {
  id: string;
  title: string;
  origin_country: string;
  origin_port: string;
  dest_country: string;
  dest_port: string;
  container_size: string;
  cargo_type: string;
  weight: number;
  weight_unit: string;
  currency: string;
  notes: string;
  status: string;
  awarded_amount: number;
  awarded_name: string;
  offer_count: number;
  created_at: string;
}

interface OceanOffer {
  id: string;
  forwarder_name: string;
  amount: number;
  currency: string;
  transit_days: number;
  sailing_date: string | null;
  note: string;
  status: string;
}

interface OceanMessage {
  id: string;
  sender_name: string;
  body: string;
}

interface OceanLeg {
  id: string;
  leg_type: LegType;
  title: string;
  status: string;
  [k: string]: unknown;
}

export default function CustomerOceanPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [postOpen, setPostOpen] = useState<boolean>(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const mineQuery = useQuery({
    queryKey: ["ocean", "mine"],
    queryFn: async (): Promise<OceanRequest[]> => {
      const { data, error } = await supabase.rpc("ocean_mine");
      if (error) return [];
      return (data as OceanRequest[] | null) ?? [];
    },
  });

  const requests = useMemo(() => mineQuery.data ?? [], [mineQuery.data]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Ocean Booking</p>
          <h1 className="text-2xl font-semibold tracking-tight">Container requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">Post a container shipment — freight forwarders bid to win it.</p>
        </div>
        <Button onClick={() => setPostOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New request
        </Button>
      </div>

      {mineQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Ship className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No ocean requests yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">Post a container shipment to receive offers from freight forwarders worldwide.</p>
          <Button onClick={() => setPostOpen(true)}>Post a request</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <button
              key={r.id}
              onClick={() => setDetailId(r.id)}
              className="block w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-white/20"
            >
              <div className="flex items-center justify-between">
                <Badge className="gap-1 bg-blue-500/15 text-blue-300">
                  <Ship className="h-3 w-3" />
                  {r.container_size}
                </Badge>
                <Badge variant="secondary">{r.status}</Badge>
              </div>
              <p className="mt-1.5 font-semibold">{r.title}</p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {r.origin_port || r.origin_country || "—"} → {r.dest_port || r.dest_country || "—"}
              </p>
              <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-xs">
                {r.status === "Open" ? (
                  <span className="font-semibold text-primary">{r.offer_count} offer{r.offer_count === 1 ? "" : "s"}</span>
                ) : (
                  <span className="font-semibold text-emerald-400">{r.awarded_name} · {r.currency} {r.awarded_amount}</span>
                )}
                <span className="text-muted-foreground">{r.cargo_type || "General cargo"}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <PostDialog
        open={postOpen}
        onOpenChange={setPostOpen}
        onPosted={async () => {
          setPostOpen(false);
          await qc.invalidateQueries({ queryKey: ["ocean", "mine"] });
        }}
      />
      {detailId && <DetailDialog requestId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function PostDialog({ open, onOpenChange, onPosted }: { open: boolean; onOpenChange: (o: boolean) => void; onPosted: () => Promise<void> }) {
  const supabase = getBrowserSupabase();
  const [title, setTitle] = useState<string>("");
  const [originCountry, setOriginCountry] = useState<string>("");
  const [originPort, setOriginPort] = useState<string>("");
  const [destCountry, setDestCountry] = useState<string>("");
  const [destPort, setDestPort] = useState<string>("");
  const [containerSize, setContainerSize] = useState<string>("40ft");
  const [cargoType, setCargoType] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lb">("kg");
  const [currency, setCurrency] = useState<string>("CAD");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Give your shipment a short title.");
      const { error: err } = await supabase.rpc("ocean_create", {
        p_title: title.trim(),
        p_origin_country: originCountry,
        p_origin_port: originPort,
        p_dest_country: destCountry,
        p_dest_port: destPort,
        p_container_size: containerSize,
        p_cargo_type: cargoType,
        p_weight: Number(weight) || 0,
        p_weight_unit: weightUnit,
        p_currency: currency,
        p_notes: notes,
        p_dest_hub_id: "",
        p_dest_hub_city: "",
        p_dest_hub_is_member: false,
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: () => void onPosted(),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New ocean request</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <Field label="Shipment title *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Furniture Vancouver → Dubai" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origin country"><Input value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} placeholder="Canada" /></Field>
            <Field label="Origin port"><Input value={originPort} onChange={(e) => setOriginPort(e.target.value)} placeholder="Vancouver" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dest. country"><Input value={destCountry} onChange={(e) => setDestCountry(e.target.value)} placeholder="UAE" /></Field>
            <Field label="Dest. port"><Input value={destPort} onChange={(e) => setDestPort(e.target.value)} placeholder="Jebel Ali" /></Field>
          </div>
          <Field label="Container size">
            <ChipRow options={CONTAINER_SIZES} value={containerSize} onChange={setContainerSize} />
          </Field>
          <Field label="Cargo type"><Input value={cargoType} onChange={(e) => setCargoType(e.target.value)} placeholder="Furniture, machinery…" /></Field>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Weight"><Input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" placeholder="8000" /></Field>
            </div>
            <ChipRow options={["kg", "lb"]} value={weightUnit} onChange={(v) => setWeightUnit(v as "kg" | "lb")} />
          </div>
          <Field label="Quote currency">
            <ChipRow options={CURRENCIES} value={currency} onChange={setCurrency} />
          </Field>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Ready date, special requirements…" /></Field>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button className="w-full" disabled={create.isPending} onClick={() => { setError(null); create.mutate(); }}>
            Post request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string>("");

  const reqQuery = useQuery({
    queryKey: ["ocean", "get", requestId],
    queryFn: async (): Promise<OceanRequest | null> => {
      const { data, error } = await supabase.rpc("ocean_get", { p_request_id: requestId });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as OceanRequest) ?? null;
    },
  });
  const offersQuery = useQuery({
    queryKey: ["ocean", "offers", requestId],
    queryFn: async (): Promise<OceanOffer[]> => {
      const { data, error } = await supabase.rpc("ocean_offers", { p_request_id: requestId });
      if (error) return [];
      return (data as OceanOffer[] | null) ?? [];
    },
  });
  const messagesQuery = useQuery({
    queryKey: ["ocean", "messages", requestId],
    refetchInterval: 8000,
    queryFn: async (): Promise<OceanMessage[]> => {
      const { data, error } = await supabase.from("ocean_messages").select("*").eq("request_id", requestId).order("created_at", { ascending: true });
      if (error) return [];
      return (data as OceanMessage[] | null) ?? [];
    },
  });
  const legsQuery = useQuery({
    queryKey: ["ocean", "legs", requestId],
    queryFn: async (): Promise<OceanLeg[]> => {
      const { data, error } = await supabase.rpc("ocean_list_legs", { p_request_id: requestId });
      if (error) return [];
      return (data as OceanLeg[] | null) ?? [];
    },
  });

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["ocean", "offers", requestId] }),
      qc.invalidateQueries({ queryKey: ["ocean", "get", requestId] }),
      qc.invalidateQueries({ queryKey: ["ocean", "legs", requestId] }),
      qc.invalidateQueries({ queryKey: ["ocean", "mine"] }),
    ]);
  };

  const accept = useMutation({
    mutationFn: async (offerId: string) => {
      const { error } = await supabase.rpc("ocean_accept_offer", { p_offer_id: offerId });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidateAll,
  });
  const advance = useMutation({
    mutationFn: async (legId: string) => {
      const { error } = await supabase.rpc("ocean_advance_leg", { p_leg_id: legId, p_notes: "" });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidateAll,
  });
  const send = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.rpc("ocean_send_message", { p_request_id: requestId, p_body: body });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setMsg("");
      await qc.invalidateQueries({ queryKey: ["ocean", "messages", requestId] });
    },
  });

  const req = reqQuery.data;
  const offers = offersQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const legs = legsQuery.data ?? [];
  const isBooked = Boolean(req?.status && req.status !== "Open");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">{req?.title ?? "Request"}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          {req && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="flex items-center gap-2 font-medium">
                <Anchor className="h-4 w-4 text-blue-300" />
                {req.origin_port || req.origin_country} → {req.dest_port || req.dest_country}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-md bg-muted px-2 py-1 font-semibold">{req.container_size}</span>
                <span className="rounded-md bg-muted px-2 py-1 font-semibold">{req.weight} {req.weight_unit}</span>
                <Badge variant="secondary">{req.status}</Badge>
              </div>
              {req.cargo_type ? <p className="mt-2 text-sm text-muted-foreground">{req.cargo_type}</p> : null}
              {req.notes ? <p className="text-sm text-muted-foreground">{req.notes}</p> : null}
            </div>
          )}

          <div>
            <p className="mb-2 text-base font-bold">Offers ({offers.length})</p>
            {offersQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offers yet. Forwarders will send quotes soon.</p>
            ) : (
              <div className="space-y-2">
                {offers.map((o) => (
                  <div key={o.id} className={`rounded-xl border p-3 ${o.status === "Accepted" ? "border-emerald-400" : "border-border"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{o.forwarder_name}</span>
                      <span className="font-bold text-primary">{o.currency} {o.amount}</span>
                    </div>
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      {o.transit_days > 0 ? <span>{o.transit_days} days transit</span> : null}
                      {o.sailing_date ? <span>Sails {o.sailing_date}</span> : null}
                    </div>
                    {o.note ? <p className="mt-1 text-sm text-muted-foreground">{o.note}</p> : null}
                    <div className="mt-2">
                      {o.status === "Accepted" ? (
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-400"><Check className="h-4 w-4" /> Accepted</span>
                      ) : !isBooked ? (
                        <Button size="sm" disabled={accept.isPending} onClick={() => accept.mutate(o.id)}>Accept offer</Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{o.status}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isBooked && (
            <>
              {legs.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-base font-bold"><Route className="h-4 w-4" /> Delivery &amp; tracking</p>
                  <div className="space-y-0">
                    {legs.map((leg, idx) => {
                      const Icon = LEG_ICON[leg.leg_type] ?? CircleDot;
                      const done = leg.status === "Done";
                      const active = leg.status === "Active";
                      const tint = done ? "text-emerald-400" : active ? "text-primary" : "text-muted-foreground";
                      return (
                        <div key={leg.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className={`grid h-8 w-8 place-items-center rounded-full border-2 ${done ? "border-emerald-400 bg-emerald-400/20" : active ? "border-primary" : "border-border"}`}>
                              <Icon className={`h-3.5 w-3.5 ${tint}`} />
                            </div>
                            {idx < legs.length - 1 && <div className={`w-0.5 flex-1 ${done ? "bg-emerald-400" : "bg-border"}`} />}
                          </div>
                          <div className="flex-1 pb-4">
                            <p className={`text-sm font-semibold ${done ? "text-muted-foreground" : ""}`}>{leg.title}</p>
                            <p className={`text-xs font-medium ${tint}`}>{done ? "Done" : active ? "In progress" : "Pending"}</p>
                            {active && (
                              <Button size="sm" variant="secondary" className="mt-1.5" disabled={advance.isPending} onClick={() => advance.mutate(leg.id)}>Mark complete</Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-base font-bold"><MessageCircle className="h-4 w-4" /> Chat</p>
                <div className="max-h-52 space-y-2 overflow-y-auto">
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No messages yet. Say hello to coordinate documents.</p>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className="rounded-lg border border-border bg-card p-3">
                        <p className="text-[11px] font-semibold text-primary">{m.sender_name}</p>
                        <p className="text-sm">{m.body}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Input
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    placeholder="Message forwarder…"
                    onKeyDown={(e) => { if (e.key === "Enter" && msg.trim()) send.mutate(msg.trim()); }}
                  />
                  <Button size="icon" disabled={!msg.trim() || send.isPending} onClick={() => msg.trim() && send.mutate(msg.trim())}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
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
            value === o ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
