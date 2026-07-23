"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Container, Loader2, Send, Ship } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/hooks/use-loads";
import { useExplore, useActionGuard } from "@/lib/explore-store";
import { SAMPLE_DRAYAGE_DASHBOARD } from "@/lib/explore-samples";

interface DrayageOrder {
  id: string;
  container_number: string | null;
  container_size: string | null;
  direction: string | null;
  status: string;
  commodity: string | null;
  pickup_city: string | null;
  delivery_city: string | null;
  created_at: string;
  [k: string]: unknown;
}

interface DrayageQuote {
  id: string;
  order_id: string;
  price: number;
  currency: string | null;
  status: string;
  eta_note: string | null;
  updated_at: string;
  [k: string]: unknown;
}

function useOpenOrders() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["drayage", "open"],
    queryFn: async (): Promise<DrayageOrder[]> => {
      const { data, error } = await supabase.from("drayage_orders").select("*").eq("status", "Open").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data as DrayageOrder[] | null) ?? [];
    },
  });
}

function useMyQuotes() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["drayage", "myQuotes"],
    queryFn: async (): Promise<DrayageQuote[]> => {
      const { data, error } = await supabase.from("drayage_quotes").select("*").order("updated_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data as DrayageQuote[] | null) ?? [];
    },
  });
}

export default function DrayageCompanyPage() {
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const [tab, setTab] = useState<"open" | "quotes">("open");
  const openQ = useOpenOrders();
  const quotesQ = useMyQuotes();
  const openOrders = isExploring
    ? (SAMPLE_DRAYAGE_DASHBOARD.openOrders as unknown as DrayageOrder[])
    : (openQ.data ?? []);
  const myQuotes = isExploring ? ([] as DrayageQuote[]) : (quotesQ.data ?? []);
  const qc = useQueryClient();
  const supabase = getBrowserSupabase();
  const [priceById, setPriceById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async ({ orderId, price }: { orderId: string; price: number }) => {
      const { error } = await supabase.rpc("submit_drayage_quote", {
        p_order_id: orderId,
        p_price: price,
        p_currency: "CAD",
        p_eta_note: "",
        p_message: "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["drayage"] });
    },
  });

  const quotedOrderIds = useMemo(() => new Set(myQuotes.map((q) => q.order_id)), [myQuotes]);

  const doSubmit = async (orderId: string) => {
    if (!guard("Submit a drayage quote")) return;
    const price = Number(priceById[orderId]);
    if (!Number.isFinite(price) || price <= 0) { window.alert("Enter a valid price."); return; }
    setBusyId(orderId);
    try {
      await submit.mutateAsync({ orderId, price });
      setPriceById((p) => ({ ...p, [orderId]: "" }));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to submit quote");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Drayage Company</p>
        <h1 className="text-2xl font-semibold tracking-tight">Container work</h1>
        <p className="mt-1 text-sm text-muted-foreground">Bid on open container moves and track your quotes.</p>
      </div>

      <div className="flex gap-2">
        <TabButton active={tab === "open"} onClick={() => setTab("open")}>Open orders</TabButton>
        <TabButton active={tab === "quotes"} onClick={() => setTab("quotes")}>My quotes ({myQuotes.length})</TabButton>
      </div>

      {tab === "open" ? (
        !isExploring && openQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : openOrders.length === 0 ? (
          <Empty icon={<Ship className="h-8 w-8 text-muted-foreground" />} text="No open container orders right now." />
        ) : (
          <div className="grid gap-3">
            {openOrders.map((o) => {
              const alreadyQuoted = quotedOrderIds.has(o.id);
              return (
                <Card key={o.id}>
                  <CardContent className="space-y-3 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Container className="h-4 w-4 text-blue-400" />
                        <span className="font-mono text-sm font-semibold">{o.container_number || "Container"}</span>
                        <Badge className="bg-blue-500/15 text-blue-300">{o.container_size ?? "—"}</Badge>
                      </div>
                      <Badge>{o.direction ?? o.status}</Badge>
                    </div>
                    <div className="space-y-1.5 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />{o.pickup_city || "Origin"}</div>
                      <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />{o.delivery_city || "Destination"}</div>
                      {o.commodity && <p className="pt-1">Commodity: {o.commodity}</p>}
                    </div>
                    <div className="flex items-center gap-2 border-t border-white/5 pt-3">
                      {alreadyQuoted ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300">Quote submitted</Badge>
                      ) : (
                        <>
                          <Input
                            type="number"
                            placeholder="Your price (CAD)"
                            value={priceById[o.id] ?? ""}
                            onChange={(e) => setPriceById((p) => ({ ...p, [o.id]: e.target.value }))}
                            className="max-w-[180px]"
                          />
                          <Button size="sm" onClick={() => void doSubmit(o.id)} disabled={busyId === o.id}>
                            {busyId === o.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Submit quote
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : !isExploring && quotesQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : myQuotes.length === 0 ? (
        <Empty icon={<Send className="h-8 w-8 text-muted-foreground" />} text="You haven't quoted any orders yet." />
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Your quotes</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {myQuotes.map((qt) => (
              <div key={qt.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{money(Number(qt.price))} {qt.currency ?? "CAD"}</p>
                  {qt.eta_note && <p className="text-xs text-muted-foreground">{qt.eta_note}</p>}
                </div>
                <Badge>{qt.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
      {children}
    </button>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
        {icon}
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
