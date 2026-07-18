"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Anchor } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

interface RequestRow {
  id: string;
  title: string;
  mode: string;
  container_no: string;
  port_of_entry: string;
  eta: string | null;
  status: string;
  quote_amount: number;
  customer_name: string;
  created_at: string;
  [k: string]: unknown;
}

const STATUS_CLASS: Record<string, string> = {
  Submitted: "bg-yellow-500/15 text-yellow-300",
  Quoted: "bg-blue-500/15 text-blue-300",
  InProgress: "bg-primary/15 text-primary",
  DocsRequired: "bg-yellow-500/15 text-yellow-300",
  Cleared: "bg-emerald-500/15 text-emerald-300",
  Rejected: "bg-red-500/15 text-red-300",
  Cancelled: "bg-white/10 text-muted-foreground",
};

export default function BrokerRequestsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"open" | "mine">("open");
  const [claimError, setClaimError] = useState("");

  const q = useQuery({
    queryKey: ["broker", "requests", tab],
    refetchInterval: 20000,
    queryFn: async (): Promise<RequestRow[]> => {
      const { data, error } = await supabase.rpc("broker_list_requests", { p_scope: tab });
      if (error) return [];
      return (data as RequestRow[] | null) ?? [];
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc("broker_claim_request", { p_request_id: requestId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setClaimError("");
      void qc.invalidateQueries({ queryKey: ["broker"] });
    },
    onError: (e: Error) => setClaimError(e.message),
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Customs Broker</p>
        <h1 className="text-2xl font-semibold tracking-tight">Clearance requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">Claim open requests, quote your fee and manage active clearances.</p>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "open" ? "default" : "outline"} size="sm" onClick={() => setTab("open")}>Open pool</Button>
        <Button variant={tab === "mine" ? "default" : "outline"} size="sm" onClick={() => setTab("mine")}>My requests</Button>
      </div>

      {claimError && <p className="text-sm text-red-400">{claimError}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">{tab === "open" ? "Waiting for a broker" : "Assigned to you"} ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {tab === "open" ? "No open requests right now — new ones appear here instantly." : "You haven't claimed any requests yet."}
              </p>
            </div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <Link href={`/customs-broker/requests/${r.id}`} className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Anchor className="h-3 w-3" />
                    {r.mode}{r.container_no ? ` · ${r.container_no}` : ""}{r.port_of_entry ? ` · ${r.port_of_entry}` : ""} · {r.customer_name} · {formatDate(r.created_at)}
                  </p>
                </Link>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_CLASS[r.status] ?? ""}>{r.status}</Badge>
                  {tab === "open" ? (
                    <Button size="sm" disabled={claimMutation.isPending} onClick={() => claimMutation.mutate(r.id)}>
                      Claim
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
