"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane, MapPin, Package, Send, MessageCircle, Sparkles } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CURRENCIES = ["CAD", "USD", "EUR", "AED", "CNY", "GBP"] as const;

interface BoardRow {
  id: string;
  title: string;
  shipment_kind: string;
  origin_country: string;
  origin_city: string;
  origin_airport: string;
  dest_country: string;
  dest_city: string;
  dest_airport: string;
  cargo_type: string;
  photos: string[];
  length_cm: number;
  width_cm: number;
  height_cm: number;
  dim_unit: string;
  weight: number;
  weight_unit: string;
  pieces: number;
  ready_date: string | null;
  commodity: string;
  declared_value: number;
  hs_code: string;
  currency: string;
  notes: string;
  estimate_low: number;
  estimate_high: number;
  estimate_currency: string;
  status: string;
  customer_name: string;
  my_offer_amount: number | null;
  my_offer_status: string | null;
  awarded_amount: number;
  created_at: string;
}

interface AirMessage {
  id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

export default function ForwarderAirPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [scope, setScope] = useState<"open" | "mine">("open");
  const [offerRow, setOfferRow] = useState<BoardRow | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ["air", "board", scope],
    queryFn: async (): Promise<BoardRow[]> => {
      const { data, error: err } = await supabase.rpc("air_forwarder_board", { p_scope: scope });
      if (err) return [];
      return (data as BoardRow[] | null) ?? [];
    },
  });

  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("CAD");
  const [transit, setTransit] = useState<string>("");
  const [departure, setDeparture] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const openOffer = useCallback((row: BoardRow) => {
    setAmount(row.my_offer_amount ? String(row.my_offer_amount) : "");
    setCurrency(row.currency || "CAD");
    setTransit("");
    setDeparture("");
    setNote("");
    setError(null);
    setOfferRow(row);
  }, []);

  const submit = useMutation({
    mutationFn: async () => {
      if (!offerRow) return;
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a quote greater than zero.");
      const { error: err } = await supabase.rpc("air_submit_offer", {
        p_request_id: offerRow.id,
        p_amount: amt,
        p_currency: currency,
        p_transit_days: Number(transit) || 0,
        p_departure_date: departure || null,
        p_note: note,
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: async () => {
      setOfferRow(null);
      await qc.invalidateQueries({ queryKey: ["air", "board"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const rows = useMemo(() => boardQuery.data ?? [], [boardQuery.data]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Freight Forwarder</p>
        <h1 className="text-2xl font-semibold tracking-tight">Air cargo board</h1>
        <p className="mt-1 text-sm text-muted-foreground">Bid on air freight requests from customers.</p>
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
          <Plane className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{scope === "open" ? "No open requests" : "No offers yet"}</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {scope === "open" ? "New air cargo requests will appear here." : "Requests you have quoted appear here."}
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
                    <Badge className="gap-1 bg-purple-500/15 text-purple-300">
                      <Plane className="h-3 w-3" />
                      {r.shipment_kind === "commercial" ? "Commercial" : "Personal"}
                    </Badge>
                    <Badge variant="secondary">{r.status}</Badge>
                  </div>
                  <div>
                    <p className="font-semibold">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.customer_name}</p>
                  </div>
                  {r.photos?.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto">
                      {r.photos.map((p) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={p} src={p} alt="cargo" className="h-16 w-16 shrink-0 rounded-md object-cover" />
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="truncate">
                      {r.origin_airport || r.origin_city || "—"} → {r.dest_airport || r.dest_city || "—"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                      <Package className="h-3 w-3" />
                      {r.weight} {r.weight_unit}
                    </span>
                    <span className="rounded-md bg-muted px-2 py-1">
                      {r.length_cm}×{r.width_cm}×{r.height_cm} {r.dim_unit}
                    </span>
                    <span className="rounded-md bg-muted px-2 py-1">{r.pieces} pc</span>
                  </div>
                  {(r.estimate_low > 0 || r.estimate_high > 0) && (
                    <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                      <Sparkles className="h-3 w-3" />
                      Customer AI guide: {r.estimate_currency} {r.estimate_low}–{r.estimate_high}
                    </div>
                  )}
                  {r.cargo_type ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {r.cargo_type}
                      {r.commodity ? ` · ${r.commodity}` : ""}
                    </p>
                  ) : null}
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
                  <Plane className="h-4 w-4 text-purple-300" />
                  {offerRow.origin_airport || offerRow.origin_city} → {offerRow.dest_airport || offerRow.dest_city}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {offerRow.weight} {offerRow.weight_unit} · {offerRow.length_cm}×{offerRow.width_cm}×
                  {offerRow.height_cm} {offerRow.dim_unit} · {offerRow.pieces} pc
                  {offerRow.cargo_type ? ` · ${offerRow.cargo_type}` : ""}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Quote amount *</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="1050" />
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
                  <Input value={transit} onChange={(e) => setTransit(e.target.value)} inputMode="numeric" placeholder="4" />
                </div>
                <div className="space-y-1.5">
                  <Label>Departure date</Label>
                  <Input value={departure} onChange={(e) => setDeparture(e.target.value)} placeholder="2026-08-01" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Direct flight, includes screening…" />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <Button className="w-full" disabled={submit.isPending} onClick={() => submit.mutate()}>
                Send offer
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {chatId && <AirChatDialog requestId={chatId} onClose={() => setChatId(null)} />}
    </div>
  );
}

function AirChatDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string>("");

  const messagesQuery = useQuery({
    queryKey: ["air", "messages", requestId],
    refetchInterval: 8000,
    queryFn: async (): Promise<AirMessage[]> => {
      const { data, error } = await supabase
        .from("air_messages")
        .select("*")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true });
      if (error) return [];
      return (data as AirMessage[] | null) ?? [];
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

  const messages = messagesQuery.data ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> Chat
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
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
