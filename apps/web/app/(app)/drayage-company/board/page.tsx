"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ship, Zap, Package, CalendarClock, DollarSign, CheckCircle2 } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

interface OrderRow {
  id: string;
  reference_code: string | null;
  status: string;
  direction: string | null;
  container_number: string | null;
  container_size: string | null;
  weight_kg: number | null;
  commodity: string | null;
  bol_number: string | null;
  booking_number: string | null;
  port_reservation_date: string | null;
  port_reservation_time: string | null;
  is_prepull: boolean | null;
  prepull_pickup_date: string | null;
  is_hazmat: boolean | null;
  is_overweight: boolean | null;
  is_oversized: boolean | null;
  target_drayage_company_id: string | null;
  drayage_company_id: string | null;
  created_at: string | null;
}

interface QuoteRow {
  id: string;
  order_id: string;
  price: number;
  currency: string;
  status: string;
  eta_note: string | null;
  message: string | null;
}

function useOrders(filter: "open" | "mine", companyId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["drayage", "board", filter, companyId],
    queryFn: async (): Promise<OrderRow[]> => {
      let q = supabase.from("drayage_orders").select("*").order("created_at", { ascending: false }).limit(100);
      if (filter === "open") q = q.eq("status", "Open");
      else if (companyId) q = q.eq("drayage_company_id", companyId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as OrderRow[] | null) ?? [];
    },
  });
}

function useMyQuotes(companyId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["drayage", "myQuotes", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<QuoteRow[]> => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("drayage_quotes")
        .select("*")
        .eq("drayage_company_id", companyId)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as QuoteRow[] | null) ?? [];
    },
  });
}

const DIRECTION_COLOR: Record<string, string> = { Import: "text-blue-500", Export: "text-emerald-500" };

export default function DrayageBoardPage() {
  const companyId = useActiveCompanyId("DrayageCompany") ?? null;
  const [filter, setFilter] = useState<"open" | "mine">("open");
  const ordersQ = useOrders(filter, companyId);
  const quotesQ = useMyQuotes(companyId);
  const queryClient = useQueryClient();
  const supabase = getBrowserSupabase();

  const [quoteOrder, setQuoteOrder] = useState<OrderRow | null>(null);
  const [price, setPrice] = useState("");
  const [eta, setEta] = useState("");
  const [message, setMessage] = useState("");

  const quoteByOrder = useMemo(() => {
    const m: Record<string, QuoteRow> = {};
    for (const q of quotesQ.data ?? []) m[q.order_id] = q;
    return m;
  }, [quotesQ.data]);

  const submitQuote = useMutation({
    mutationFn: async () => {
      if (!quoteOrder) return;
      const p = Number(price);
      if (!p || p <= 0) throw new Error("Enter your quoted price.");
      const { error } = await supabase.rpc("submit_drayage_quote", {
        p_order_id: quoteOrder.id,
        p_price: p,
        p_currency: "CAD",
        p_eta_note: eta.trim(),
        p_message: message.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setQuoteOrder(null);
      setPrice("");
      setEta("");
      setMessage("");
      await queryClient.invalidateQueries({ queryKey: ["drayage", "myQuotes"] });
      await queryClient.invalidateQueries({ queryKey: ["drayage", "board"] });
    },
  });

  const claim = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc("assign_drayage_order", { p_order_id: orderId });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["drayage", "board"] });
    },
  });

  const openSheet = (o: OrderRow) => {
    const existing = quoteByOrder[o.id];
    setPrice(existing?.price ? String(existing.price) : "");
    setEta(existing?.eta_note ?? "");
    setMessage(existing?.message ?? "");
    setQuoteOrder(o);
  };

  const orders = ordersQ.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Drayage Company</p>
        <h1 className="text-2xl font-semibold tracking-tight">Orders board</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {filter === "open" ? "Container orders available to quote and claim." : "Orders assigned to your company."}
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant={filter === "open" ? "default" : "outline"} size="sm" onClick={() => setFilter("open")}>
          <Zap className="mr-1.5 h-4 w-4" /> Open
        </Button>
        <Button variant={filter === "mine" ? "default" : "outline"} size="sm" onClick={() => setFilter("mine")}>
          <Package className="mr-1.5 h-4 w-4" /> Mine
        </Button>
      </div>

      {ordersQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Ship className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">{filter === "open" ? "No open orders" : "No assigned orders"}</p>
            <p className="text-sm text-muted-foreground">
              {filter === "open" ? "When forwarders post container orders, they appear here." : "Claim an open order to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const q = quoteByOrder[o.id];
            const invited = o.target_drayage_company_id && companyId && o.target_drayage_company_id === companyId;
            return (
              <Card key={o.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold uppercase ${DIRECTION_COLOR[o.direction ?? ""] ?? "text-blue-500"}`}>
                      {o.direction}
                    </span>
                    <Badge variant="secondary">{o.status}</Badge>
                  </div>
                  <p className="text-base font-semibold">{o.reference_code}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-muted/50 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Container</p>
                      <p className="text-sm font-semibold">{o.container_number || "TBD"}</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Size</p>
                      <p className="text-sm font-semibold">{o.container_size}</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Weight</p>
                      <p className="text-sm font-semibold">{o.weight_kg ? `${o.weight_kg}kg` : "—"}</p>
                    </div>
                  </div>
                  {o.commodity ? <p className="text-sm text-muted-foreground">{o.commodity}</p> : null}
                  {o.bol_number ? <p className="text-xs text-muted-foreground">BOL: {o.bol_number}</p> : null}
                  {o.booking_number ? <p className="text-xs text-muted-foreground">Booking: {o.booking_number}</p> : null}
                  {o.port_reservation_date ? (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                      <CalendarClock className="h-3.5 w-3.5" /> Port appt: {o.port_reservation_date} {o.port_reservation_time}
                    </p>
                  ) : null}
                  {o.is_prepull ? (
                    <Badge variant="outline" className="border-purple-500/40 text-purple-500">
                      PREPULL — pickup {o.prepull_pickup_date ?? "TBD"}
                    </Badge>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {o.is_hazmat ? <Badge variant="outline" className="border-red-500/40 text-red-500">Hazmat</Badge> : null}
                    {o.is_overweight ? <Badge variant="outline" className="border-yellow-500/40 text-yellow-600">Overweight</Badge> : null}
                    {o.is_oversized ? <Badge variant="outline" className="border-orange-500/40 text-orange-500">Oversized</Badge> : null}
                  </div>
                  {invited ? (
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Invited directly to you
                    </p>
                  ) : null}

                  {o.status === "Open" ? (
                    <div className="space-y-2">
                      {q ? (
                        <p className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-500">
                          <DollarSign className="h-3.5 w-3.5" /> Your quote: {q.currency} {q.price}
                          {q.status !== "Pending" ? ` · ${q.status}` : ""}
                        </p>
                      ) : null}
                      <Button className="w-full" onClick={() => openSheet(o)}>
                        <DollarSign className="mr-1.5 h-4 w-4" /> {q ? "Update quote" : "Send a quote"}
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={claim.isPending}
                        onClick={() => claim.mutate(o.id)}
                      >
                        Claim instantly
                      </Button>
                    </div>
                  ) : (
                    <Link href={`/drayage-company/${o.id}`}>
                      <Button variant="outline" className="w-full">View details</Button>
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={quoteOrder !== null} onOpenChange={(v) => !v && setQuoteOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a quote</DialogTitle>
          </DialogHeader>
          {quoteOrder ? (
            <p className="text-sm text-muted-foreground">{quoteOrder.reference_code} · {quoteOrder.direction}</p>
          ) : null}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Your price (CAD)</Label>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 650" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label>ETA / availability</Label>
              <Input value={eta} onChange={(e) => setEta(e.target.value)} placeholder="e.g. Pickup tomorrow AM, deliver same day" />
            </div>
            <div className="space-y-1.5">
              <Label>Message (optional)</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything the customer should know…" />
            </div>
            {submitQuote.isError ? (
              <p className="text-sm text-red-500">{submitQuote.error instanceof Error ? submitQuote.error.message : "Failed"}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteOrder(null)}>Cancel</Button>
            <Button onClick={() => submitQuote.mutate()} disabled={submitQuote.isPending}>
              {submitQuote.isPending ? "Submitting…" : "Submit quote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
