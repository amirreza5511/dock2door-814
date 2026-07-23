"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane, MapPin, Package, MessageCircle, Send, Check, Plus, Sparkles } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AED", "CNY"];

interface AirRequest {
  id: string;
  title: string;
  shipment_kind: string;
  origin_city: string;
  origin_airport: string;
  dest_city: string;
  dest_airport: string;
  cargo_type: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  dim_unit: string;
  weight: number;
  weight_unit: string;
  pieces: number;
  commodity: string;
  declared_value: number;
  currency: string;
  notes: string;
  estimate_low: number;
  estimate_high: number;
  estimate_currency: string;
  status: string;
  awarded_amount: number;
  awarded_name: string;
  offer_count: number;
  created_at: string;
}

interface AirOffer {
  id: string;
  forwarder_name: string;
  amount: number;
  currency: string;
  transit_days: number;
  departure_date: string | null;
  note: string;
  status: string;
}

interface AirMessage {
  id: string;
  sender_name: string;
  body: string;
}

export default function CustomerAirPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [postOpen, setPostOpen] = useState<boolean>(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const mineQuery = useQuery({
    queryKey: ["air", "mine"],
    queryFn: async (): Promise<AirRequest[]> => {
      const { data, error } = await supabase.rpc("air_list_mine");
      if (error) return [];
      return (data as AirRequest[] | null) ?? [];
    },
  });

  const requests = useMemo(() => mineQuery.data ?? [], [mineQuery.data]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Air Cargo</p>
          <h1 className="text-2xl font-semibold tracking-tight">Air requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">Post an air cargo shipment — freight forwarders bid to win it.</p>
        </div>
        <Button onClick={() => setPostOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New request
        </Button>
      </div>

      {mineQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Plane className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No air requests yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">Post an air cargo shipment to receive offers from freight forwarders worldwide.</p>
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
                <Badge className="gap-1 bg-purple-500/15 text-purple-300">
                  <Plane className="h-3 w-3" />
                  {r.shipment_kind === "commercial" ? "Commercial" : "Personal"}
                </Badge>
                <Badge variant="secondary">{r.status}</Badge>
              </div>
              <p className="mt-1.5 font-semibold">{r.title}</p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {r.origin_airport || r.origin_city || "—"} → {r.dest_airport || r.dest_city || "—"}
              </p>
              <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-xs">
                {r.status === "Open" ? (
                  <span className="font-semibold text-primary">{r.offer_count} offer{r.offer_count === 1 ? "" : "s"}</span>
                ) : (
                  <span className="font-semibold text-emerald-400">{r.awarded_name} · {r.currency} {r.awarded_amount}</span>
                )}
                <span className="text-muted-foreground">{r.weight} {r.weight_unit} · {r.pieces} pc</span>
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
          await qc.invalidateQueries({ queryKey: ["air", "mine"] });
        }}
      />
      {detailId && <DetailDialog requestId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function PostDialog({ open, onOpenChange, onPosted }: { open: boolean; onOpenChange: (o: boolean) => void; onPosted: () => Promise<void> }) {
  const supabase = getBrowserSupabase();
  const [kind, setKind] = useState<"personal" | "commercial">("personal");
  const [title, setTitle] = useState<string>("");
  const [originCity, setOriginCity] = useState<string>("");
  const [originAirport, setOriginAirport] = useState<string>("");
  const [destCity, setDestCity] = useState<string>("");
  const [destAirport, setDestAirport] = useState<string>("");
  const [cargoType, setCargoType] = useState<string>("");
  const [len, setLen] = useState<string>("");
  const [wid, setWid] = useState<string>("");
  const [hei, setHei] = useState<string>("");
  const [dimUnit, setDimUnit] = useState<"cm" | "in">("cm");
  const [weight, setWeight] = useState<string>("");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lb">("kg");
  const [pieces, setPieces] = useState<string>("1");
  const [commodity, setCommodity] = useState<string>("");
  const [declaredValue, setDeclaredValue] = useState<string>("");
  const [hsCode, setHsCode] = useState<string>("");
  const [currency, setCurrency] = useState<string>("CAD");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Give your shipment a short title.");
      const { error: err } = await supabase.rpc("air_create_request", {
        p_title: title.trim(),
        p_shipment_kind: kind,
        p_origin_country: "",
        p_origin_city: originCity,
        p_origin_airport: originAirport,
        p_dest_country: "",
        p_dest_city: destCity,
        p_dest_airport: destAirport,
        p_cargo_type: cargoType,
        p_photos: [],
        p_length_cm: Number(len) || 0,
        p_width_cm: Number(wid) || 0,
        p_height_cm: Number(hei) || 0,
        p_dim_unit: dimUnit,
        p_weight: Number(weight) || 0,
        p_weight_unit: weightUnit,
        p_pieces: Number(pieces) || 1,
        p_ready_date: null,
        p_commodity: commodity,
        p_declared_value: Number(declaredValue) || 0,
        p_hs_code: hsCode,
        p_currency: currency,
        p_notes: notes,
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
          <DialogTitle>New air request</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["personal", "commercial"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-xl border py-2.5 text-sm font-semibold capitalize transition-colors ${
                  kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <Field label="Shipment title *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Spare parts Toronto → Tehran" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origin city"><Input value={originCity} onChange={(e) => setOriginCity(e.target.value)} placeholder="Toronto" /></Field>
            <Field label="Origin airport"><Input value={originAirport} onChange={(e) => setOriginAirport(e.target.value)} placeholder="YYZ" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dest. city"><Input value={destCity} onChange={(e) => setDestCity(e.target.value)} placeholder="Dubai" /></Field>
            <Field label="Dest. airport"><Input value={destAirport} onChange={(e) => setDestAirport(e.target.value)} placeholder="DXB" /></Field>
          </div>
          <Field label="Cargo type"><Input value={cargoType} onChange={(e) => setCargoType(e.target.value)} placeholder="Electronics, documents…" /></Field>
          <Field label="Dimensions">
            <div className="grid grid-cols-3 gap-2">
              <Input value={len} onChange={(e) => setLen(e.target.value)} inputMode="numeric" placeholder="L" />
              <Input value={wid} onChange={(e) => setWid(e.target.value)} inputMode="numeric" placeholder="W" />
              <Input value={hei} onChange={(e) => setHei(e.target.value)} inputMode="numeric" placeholder="H" />
            </div>
          </Field>
          <ChipRow options={["cm", "in"]} value={dimUnit} onChange={(v) => setDimUnit(v as "cm" | "in")} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="Weight"><Input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" placeholder="12" /></Field>
              </div>
              <ChipRow options={["kg", "lb"]} value={weightUnit} onChange={(v) => setWeightUnit(v as "kg" | "lb")} />
            </div>
            <Field label="Pieces"><Input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" placeholder="1" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Commodity"><Input value={commodity} onChange={(e) => setCommodity(e.target.value)} placeholder="What's inside" /></Field>
            <Field label="Declared value"><Input value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} inputMode="numeric" placeholder="0" /></Field>
          </div>
          <Field label="HS code"><Input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="Optional" /></Field>
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
    queryKey: ["air", "get", requestId],
    queryFn: async (): Promise<AirRequest | null> => {
      const { data, error } = await supabase.rpc("air_list_mine");
      if (error) return null;
      const rows = (data as AirRequest[] | null) ?? [];
      return rows.find((r) => r.id === requestId) ?? null;
    },
  });
  const offersQuery = useQuery({
    queryKey: ["air", "offers", requestId],
    queryFn: async (): Promise<AirOffer[]> => {
      const { data, error } = await supabase.rpc("air_list_offers", { p_request_id: requestId });
      if (error) return [];
      return (data as AirOffer[] | null) ?? [];
    },
  });
  const messagesQuery = useQuery({
    queryKey: ["air", "messages", requestId],
    refetchInterval: 8000,
    queryFn: async (): Promise<AirMessage[]> => {
      const { data, error } = await supabase.from("air_messages").select("*").eq("request_id", requestId).order("created_at", { ascending: true });
      if (error) return [];
      return (data as AirMessage[] | null) ?? [];
    },
  });

  const accept = useMutation({
    mutationFn: async (offerId: string) => {
      const { error } = await supabase.rpc("air_accept_offer", { p_offer_id: offerId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["air", "offers", requestId] }),
        qc.invalidateQueries({ queryKey: ["air", "get", requestId] }),
        qc.invalidateQueries({ queryKey: ["air", "mine"] }),
      ]);
    },
  });
  const send = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.rpc("air_send_message", { p_request_id: requestId, p_body: body });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setMsg("");
      await qc.invalidateQueries({ queryKey: ["air", "messages", requestId] });
    },
  });

  const req = reqQuery.data;
  const offers = offersQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
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
                <Plane className="h-4 w-4 text-purple-300" />
                {req.origin_airport || req.origin_city} → {req.dest_airport || req.dest_city}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-md bg-muted px-2 py-1 font-semibold">{req.weight} {req.weight_unit}</span>
                <span className="rounded-md bg-muted px-2 py-1 font-semibold">{req.length_cm}×{req.width_cm}×{req.height_cm} {req.dim_unit}</span>
                <span className="rounded-md bg-muted px-2 py-1 font-semibold">{req.pieces} pc</span>
                <Badge variant="secondary">{req.status}</Badge>
              </div>
              {(req.estimate_low > 0 || req.estimate_high > 0) && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <Sparkles className="h-3 w-3" /> AI guide: {req.estimate_currency} {req.estimate_low}–{req.estimate_high}
                </p>
              )}
              {req.cargo_type ? <p className="mt-2 text-sm text-muted-foreground">{req.cargo_type}{req.commodity ? ` · ${req.commodity}` : ""}</p> : null}
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
                      {o.departure_date ? <span>Departs {o.departure_date}</span> : null}
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
