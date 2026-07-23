"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ship, MapPin, Package, Anchor, Send, MessageCircle, Truck, Warehouse, CircleDot, Route } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CURRENCIES = ["CAD", "USD", "EUR", "AED", "CNY", "GBP"] as const;

type LegType = "OriginPort" | "OceanTransit" | "DestPort" | "Warehouse" | "FinalMile";

const LEG_ICON: Record<LegType, React.ComponentType<{ className?: string }>> = {
  OriginPort: Anchor,
  OceanTransit: Ship,
  DestPort: Anchor,
  Warehouse,
  FinalMile: Truck,
};

interface BoardRow {
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
  ready_date: string | null;
  incoterms: string;
  currency: string;
  notes: string;
  status: string;
  customer_name: string;
  my_offer_amount: number | null;
  my_offer_status: string | null;
  awarded_amount: number;
  created_at: string;
}

interface OceanMessage {
  id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

interface OceanLeg {
  id: string;
  leg_type: LegType;
  title: string;
  status: string;
  [k: string]: unknown;
}

export default function ForwarderOceanPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [scope, setScope] = useState<"open" | "mine">("open");
  const [offerRow, setOfferRow] = useState<BoardRow | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ["ocean", "board", scope],
    queryFn: async (): Promise<BoardRow[]> => {
      const { data, error: err } = await supabase.rpc("ocean_forwarder_board", { p_scope: scope });
      if (err) return [];
      return (data as BoardRow[] | null) ?? [];
    },
  });

  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("CAD");
  const [transit, setTransit] = useState<string>("");
  const [sailing, setSailing] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const openOffer = useCallback((row: BoardRow) => {
    setAmount(row.my_offer_amount ? String(row.my_offer_amount) : "");
    setCurrency(row.currency || "CAD");
    setTransit("");
    setSailing("");
    setNote("");
    setError(null);
    setOfferRow(row);
  }, []);

  const submit = useMutation({
    mutationFn: async () => {
      if (!offerRow) return;
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a quote greater than zero.");
      const { error: err } = await supabase.rpc("ocean_submit_offer", {
        p_request_id: offerRow.id,
        p_amount: amt,
        p_currency: currency,
        p_transit_days: Number(transit) || 0,
        p_sailing_date: sailing || null,
        p_note: note,
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: async () => {
      setOfferRow(null);
      await qc.invalidateQueries({ queryKey: ["ocean", "board"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const rows = useMemo(() => boardQuery.data ?? [], [boardQuery.data]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Freight Forwarder</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ocean board</h1>
        <p className="mt-1 text-sm text-muted-foreground">Bid on container shipping requests from customers.</p>
      </div>

      <div className="flex gap-1 rounded-lg border border-white/10 bg-card p-1 sm:max-w-xs">
        {([["open", "Open board"], ["mine", "My offers"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setScope(key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              scope === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {boardQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Ship className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{scope === "open" ? "No open requests" : "No offers yet"}</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {scope === "open" ? "New ocean freight requests will appear here." : "Requests you have quoted appear here."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => {
            const won = r.my_offer_status === "Accepted";
            return (
              <Card key={r.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <Badge className="gap-1 bg-blue-500/15 text-blue-300">
                      <Ship className="h-3 w-3" />
                      {r.container_size}
                    </Badge>
                    <Badge variant="secondary">{r.status}</Badge>
                  </div>
                  <div>
                    <p className="font-semibold">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.customer_name}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="truncate">
                      {r.origin_port || r.origin_country || "—"} → {r.dest_port || r.dest_country || "—"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                      <Package className="h-3 w-3" />
                      {r.weight} {r.weight_unit}
                    </span>
                    {r.cargo_type ? <span className="rounded-md bg-muted px-2 py-1">{r.cargo_type}</span> : null}
                  </div>
                  {r.notes ? <p className="text-xs text-muted-foreground line-clamp-2">{r.notes}</p> : null}
                  <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-3">
                    {r.my_offer_amount ? (
                      <span className={`text-xs font-semibold ${won ? "text-emerald-400" : "text-primary"}`}>
                        Your offer: {r.currency} {r.my_offer_amount}
                        {r.my_offer_status ? ` · ${r.my_offer_status}` : ""}
                      </span>
                    ) : (
                      <span />
                    )}
                    {won ? (
                      <Button size="sm" variant="secondary" onClick={() => setChatId(r.id)}>
                        <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                        Chat
                      </Button>
                    ) : r.status === "Open" ? (
                      <Button size="sm" onClick={() => openOffer(r)}>
                        {r.my_offer_amount ? "Update offer" : "Send offer"}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!offerRow} onOpenChange={(o) => !o && setOfferRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="truncate">Offer — {offerRow?.title}</DialogTitle>
          </DialogHeader>
          {offerRow && (
            <div className="mt-2 space-y-3">
              <div className="rounded-lg border border-border bg-card p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Anchor className="h-4 w-4 text-blue-300" />
                  {offerRow.origin_port || offerRow.origin_country} → {offerRow.dest_port || offerRow.dest_country}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {offerRow.container_size} · {offerRow.weight} {offerRow.weight_unit}
                  {offerRow.cargo_type ? ` · ${offerRow.cargo_type}` : ""}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Quote amount *</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="3200" />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <div className="flex flex-wrap gap-2">
                  {CURRENCIES.map((cur) => (
                    <button
                      key={cur}
                      onClick={() => setCurrency(cur)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        currency === cur
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {cur}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Transit (days)</Label>
                  <Input value={transit} onChange={(e) => setTransit(e.target.value)} inputMode="numeric" placeholder="21" />
                </div>
                <div className="space-y-1.5">
                  <Label>Sailing date</Label>
                  <Input value={sailing} onChange={(e) => setSailing(e.target.value)} placeholder="2026-08-01" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Direct sailing, includes THC…" />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <Button className="w-full" disabled={submit.isPending} onClick={() => submit.mutate()}>
                Send offer
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {chatId && <OceanChatDialog requestId={chatId} onClose={() => setChatId(null)} />}
    </div>
  );
}

function OceanChatDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string>("");

  const messagesQuery = useQuery({
    queryKey: ["ocean", "messages", requestId],
    refetchInterval: 8000,
    queryFn: async (): Promise<OceanMessage[]> => {
      const { data, error } = await supabase
        .from("ocean_messages")
        .select("*")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true });
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

  const advance = useMutation({
    mutationFn: async (legId: string) => {
      const { error } = await supabase.rpc("ocean_advance_leg", { p_leg_id: legId, p_notes: "" });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ocean", "legs", requestId] }),
        qc.invalidateQueries({ queryKey: ["ocean", "board"] }),
      ]);
    },
  });

  const messages = messagesQuery.data ?? [];
  const legs = legsQuery.data ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> Chat
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2 max-h-96 space-y-3 overflow-y-auto">
          {legs.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Route className="h-4 w-4" /> Delivery legs
              </p>
              <div className="space-y-2">
                {legs.map((leg, idx) => {
                  const Icon = LEG_ICON[leg.leg_type] ?? CircleDot;
                  const done = leg.status === "Done";
                  const active = leg.status === "Active";
                  const tint = done ? "text-emerald-400" : active ? "text-primary" : "text-muted-foreground";
                  return (
                    <div key={leg.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className={`grid h-8 w-8 place-items-center rounded-full border-2 ${
                            done ? "border-emerald-400 bg-emerald-400/20" : active ? "border-primary" : "border-border"
                          }`}
                        >
                          <Icon className={`h-3.5 w-3.5 ${tint}`} />
                        </div>
                        {idx < legs.length - 1 && <div className={`w-0.5 flex-1 ${done ? "bg-emerald-400" : "bg-border"}`} />}
                      </div>
                      <div className="flex-1 pb-3">
                        <p className={`text-sm font-semibold ${done ? "text-muted-foreground" : ""}`}>{leg.title}</p>
                        <p className={`text-xs font-medium ${tint}`}>
                          {done ? "Done" : active ? "In progress" : "Pending"}
                        </p>
                        {active && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="mt-1.5"
                            disabled={advance.isPending}
                            onClick={() => advance.mutate(leg.id)}
                          >
                            Mark complete
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
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
            placeholder="Message customer…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && msg.trim()) send.mutate(msg.trim());
            }}
          />
          <Button size="icon" disabled={!msg.trim() || send.isPending} onClick={() => msg.trim() && send.mutate(msg.trim())}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
