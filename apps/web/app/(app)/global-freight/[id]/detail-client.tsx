"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, FileText, Check, Truck, Ship, Send, MessageCircle, XCircle } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { UserRole } from "@/lib/types";
import {
  freightRoleKind, FREIGHT_MODE_LABEL, DELIVERY_METHOD_LABEL, FREIGHT_STATUS_META,
  formatMoney, type FreightMode, type DeliveryMethod, type FreightQuoteStatus,
} from "@/lib/global-freight";
import { useExplore, useActionGuard } from "@/lib/explore-store";
import { SAMPLE_FREIGHT_QUOTES } from "@/lib/explore-samples";

interface Offer {
  id: string; provider_name: string; offer_kind: string; amount: number; currency: string;
  transit_days: number; valid_until: string | null; note: string; status: string; created_at: string;
}
interface Msg { id: string; sender_name: string; body: string; created_at: string }

/** Build a full sample quote record for explore mode from the shared list rows. */
function sampleQuoteFor(quoteId: string): Record<string, unknown> {
  const base = SAMPLE_FREIGHT_QUOTES.find((r) => r.id === quoteId) ?? SAMPLE_FREIGHT_QUOTES[0];
  return {
    ...base,
    origin_port: base.freight_mode === "air" ? "FRA" : "CNSHA",
    dest_port: base.freight_mode === "air" ? "YYZ" : "CAVAN",
    volume: base.freight_mode === "air" ? null : 54,
    commodity: "General merchandise",
    declared_value: 42000,
    delivery_method: "door_pickup",
    awarded_company_id: base.status === "Accepted" ? "explore-company" : null,
    ground_awarded_company_id: null,
    rejected_reason: null,
  };
}

const SAMPLE_OFFERS: Offer[] = [
  { id: "ex-fo-1", provider_name: "Meridian Global Forwarding", offer_kind: "freight", amount: 4180, currency: "CAD", transit_days: 24, valid_until: null, note: "All-in ocean FCL, weekly sailing, customs not included.", status: "Pending", created_at: new Date(Date.now() - 3600000 * 20).toISOString() },
  { id: "ex-fo-2", provider_name: "PacRim Freight Lines", offer_kind: "freight", amount: 3950, currency: "CAD", transit_days: 29, valid_until: null, note: "Slower routing via Prince Rupert.", status: "Pending", created_at: new Date(Date.now() - 3600000 * 9).toISOString() },
  { id: "ex-fo-3", provider_name: "PacRim Drayage", offer_kind: "ground", amount: 420, currency: "CAD", transit_days: 1, valid_until: null, note: "Container pickup at Vanterm, door delivery.", status: "Pending", created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
];

export function FreightDetailClient({ quoteId, role, userName }: { quoteId: string; role: UserRole | null; userName: string | null }) {
  const supabase = getBrowserSupabase();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const kind = freightRoleKind(role);
  const isCustomer = kind === "customer" || (isExploring && kind !== "freight" && kind !== "ground");
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const quoteQ = useQuery({
    queryKey: ["freight", "detail", quoteId],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc("freight_get_quote", { p_quote_id: quoteId });
      if (e) throw e;
      return (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    },
  });
  const docsQ = useQuery({
    queryKey: ["freight", "docs", quoteId],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc("freight_list_documents", { p_quote_id: quoteId });
      if (e) throw e;
      return (data as { id: string; file_path: string; file_name: string; doc_type: string }[] | null) ?? [];
    },
  });
  const offersQ = useQuery({
    queryKey: ["freight", "offers", quoteId],
    enabled: !isExploring,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc("freight_list_offers", { p_quote_id: quoteId });
      if (e) throw e;
      return (data as Offer[] | null) ?? [];
    },
  });
  const msgsQ = useQuery({
    queryKey: ["freight", "msgs", quoteId],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from("freight_quote_messages").select("*").eq("quote_id", quoteId)
        .order("created_at", { ascending: true });
      if (e) return [] as Msg[];
      return (data as Msg[] | null) ?? [];
    },
    refetchInterval: 8000,
    enabled: !isExploring,
  });

  const q = (isExploring ? sampleQuoteFor(quoteId) : quoteQ.data) as any;
  const docs = docsQ.data ?? [];
  const offers = useMemo(
    () => (isExploring ? SAMPLE_OFFERS.filter((o) => o.offer_kind === "freight" || Boolean(q?.needs_container_pickup)) : (offersQ.data ?? [])),
    [offersQ.data, isExploring, q?.needs_container_pickup],
  );
  const messages = msgsQ.data ?? [];
  const freightOffers = useMemo(() => offers.filter((o) => o.offer_kind === "freight"), [offers]);
  const groundOffers = useMemo(() => offers.filter((o) => o.offer_kind === "ground"), [offers]);
  const statusMeta = q ? FREIGHT_STATUS_META[q.status as FreightQuoteStatus] : null;

  const refreshAll = useCallback(async () => {
    await Promise.all([quoteQ.refetch(), offersQ.refetch()]);
  }, [quoteQ, offersQ]);

  const accept = useCallback(async (offerId: string) => {
    if (!guard("Accept a quote")) return;
    setBusyId(offerId); setError("");
    try {
      const { error: e } = await supabase.rpc("freight_accept_offer", { p_offer_id: offerId });
      if (e) throw e;
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept quote.");
    } finally {
      setBusyId(null);
    }
  }, [supabase, refreshAll]);

  const cancel = useCallback(async () => {
    if (!guard("Cancel a freight request")) return;
    if (!confirm("Cancel this request for all providers?")) return;
    try {
      const { error: e } = await supabase.rpc("freight_cancel_quote", { p_quote_id: quoteId });
      if (e) throw e;
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel.");
    }
  }, [supabase, quoteId, refreshAll]);

  const send = useCallback(async () => {
    if (!guard("Send a message")) return;
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    try {
      const { error: e } = await supabase.rpc("freight_send_message", { p_quote_id: quoteId, p_body: body });
      if (e) throw e;
      await msgsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message failed.");
    }
  }, [draft, supabase, quoteId, msgsQ]);

  const canChat = q && (q.awarded_company_id || q.ground_awarded_company_id);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/global-freight" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to freight exchange
      </Link>

      {!isExploring && quoteQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !q ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Request not found.</CardContent></Card>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="font-mono text-xs font-semibold text-muted-foreground">{q.reference_code}</span>
              <h1 className="text-xl font-semibold tracking-tight">{q.title}</h1>
            </div>
            {statusMeta ? <Badge className={statusMeta.className}>{statusMeta.label}</Badge> : null}
          </div>

          {q.status === "Rejected" && q.rejected_reason ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">Rejected: {q.rejected_reason}</div>
          ) : null}

          <Card><CardContent className="space-y-1 py-4 text-sm">
            <DetailRow label="Mode" value={FREIGHT_MODE_LABEL[q.freight_mode as FreightMode]} />
            <DetailRow label="From" value={`${q.origin_city || q.origin_country}${q.origin_port ? ` (${q.origin_port})` : ""}`} />
            <DetailRow label="To" value={`${q.dest_city || q.dest_country}${q.dest_port ? ` (${q.dest_port})` : ""}`} />
            <DetailRow label="Weight" value={`${q.weight} ${q.weight_unit}${q.volume ? ` · ${q.volume} CBM` : ""}`} />
            <DetailRow label="Pieces" value={String(q.pieces)} />
            {q.commodity ? <DetailRow label="Commodity" value={q.commodity} /> : null}
            {q.declared_value ? <DetailRow label="Declared value" value={formatMoney(q.declared_value, q.currency)} /> : null}
            <DetailRow label="Delivery" value={DELIVERY_METHOD_LABEL[q.delivery_method as DeliveryMethod]} />
            {q.needs_container_pickup ? <DetailRow label="Ground leg" value="Container pickup / drayage requested" /> : null}
          </CardContent></Card>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Documents ({docs.length})</h2>
            {docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents attached.</p> : docs.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-card/60 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-blue-400" /> {d.file_name || d.doc_type}
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Ship className="h-4 w-4 text-blue-400" /> Freight quotes ({freightOffers.length})</h2>
            {freightOffers.length === 0 ? <p className="text-sm text-muted-foreground">No freight quotes yet.</p> : freightOffers.map((o) => (
              <OfferCard key={o.id} offer={o} canAccept={isCustomer && q.status !== "Accepted" && q.status !== "Cancelled" && o.status === "Pending"} onAccept={() => accept(o.id)} busy={busyId === o.id} />
            ))}
          </section>

          {q.needs_container_pickup ? (
            <section className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Truck className="h-4 w-4 text-emerald-400" /> Container pickup quotes ({groundOffers.length})</h2>
              {groundOffers.length === 0 ? <p className="text-sm text-muted-foreground">No pickup quotes yet.</p> : groundOffers.map((o) => (
                <OfferCard key={o.id} offer={o} canAccept={isCustomer && !q.ground_awarded_company_id && q.status !== "Cancelled" && o.status === "Pending"} onAccept={() => accept(o.id)} busy={busyId === o.id} />
              ))}
            </section>
          ) : null}

          {canChat ? (
            <section className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold"><MessageCircle className="h-4 w-4 text-blue-400" /> Messages</h2>
              <div className="space-y-2">
                {messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet. Start the conversation.</p> : messages.map((m) => {
                  const mine = m.sender_name === userName;
                  return (
                    <div key={m.id} className={`max-w-[85%] rounded-lg border p-3 text-sm ${mine ? "ml-auto border-blue-500/40 bg-blue-500/10" : "border-white/5 bg-card/60"}`}>
                      {!mine ? <p className="mb-1 text-xs font-semibold text-muted-foreground">{m.sender_name}</p> : null}
                      <p>{m.body}</p>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-end gap-2">
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message…" className="min-h-[44px]" />
                <Button onClick={() => void send()}><Send className="h-4 w-4" /></Button>
              </div>
            </section>
          ) : null}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          {isCustomer && ["PendingReview", "Open", "Quoted"].includes(q.status) ? (
            <Button variant="secondary" onClick={() => void cancel()} className="text-red-400"><XCircle className="mr-1.5 h-4 w-4" /> Cancel request</Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function OfferCard({ offer, canAccept, onAccept, busy }: { offer: Offer; canAccept: boolean; onAccept: () => void; busy: boolean }) {
  const won = offer.status === "Accepted";
  return (
    <Card className={won ? "border-emerald-500/50 bg-emerald-500/5" : ""}>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{offer.provider_name}</span>
          <span className="text-base font-bold text-blue-400">{formatMoney(offer.amount, offer.currency)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {offer.transit_days > 0 ? <span>{offer.transit_days} days transit</span> : null}
          {won ? <Badge className="bg-emerald-500/15 text-emerald-300"><Check className="mr-1 h-3 w-3" /> Accepted</Badge> : null}
        </div>
        {offer.note ? <p className="text-sm text-muted-foreground">{offer.note}</p> : null}
        {canAccept ? <Button size="sm" onClick={onAccept} disabled={busy}><Check className="mr-1.5 h-4 w-4" /> {busy ? "Accepting…" : "Accept"}</Button> : null}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-white/5 py-2 last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>;
}
