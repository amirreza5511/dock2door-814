"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ticket, MessageSquare, Check, Clock, CircleDot } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TicketRow {
  id: string;
  subject: string;
  summary: string;
  status: "open" | "in_progress" | "resolved";
  threadId: string | null;
  createdAt: string;
  requesterName?: string;
  requesterEmail?: string;
  companyName?: string;
}

const STATUS_META: Record<string, { className: string; label: string }> = {
  open: { className: "text-red-400", label: "Open" },
  in_progress: { className: "text-yellow-400", label: "In progress" },
  resolved: { className: "text-emerald-400", label: "Resolved" },
};

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Admin inbox for AI-filed support tickets: list, status, jump-to-chat. */
export default function TicketsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"active" | "all">("active");

  const ticketsQ = useQuery({
    queryKey: ["tickets", "all"],
    refetchInterval: 30000,
    queryFn: async (): Promise<TicketRow[]> => {
      const { data, error } = await supabase.rpc("list_support_tickets", { p_scope: "all" });
      if (error) {
        if (error.message.includes("function") || error.code === "PGRST202") return [];
        throw new Error(error.message);
      }
      return (data as TicketRow[] | null) ?? [];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (v: { id: string; status: "open" | "in_progress" | "resolved" }) => {
      const { error } = await supabase.rpc("set_support_ticket_status", { p_id: v.id, p_status: v.status });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tickets"] }),
  });

  const tickets = ticketsQ.data ?? [];
  const shown = filter === "active" ? tickets.filter((t) => t.status !== "resolved") : tickets;
  const activeCount = tickets.filter((t) => t.status !== "resolved").length;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <Ticket className="h-3.5 w-3.5" /> Support Tickets
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">AI escalations</h1>
        <p className="text-sm text-muted-foreground">{activeCount} active · filed by the AI copilot with a full conversation summary.</p>
      </div>

      <div className="flex gap-2">
        {(["active", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "active" ? `Active (${activeCount})` : "All"}
          </Button>
        ))}
      </div>

      {ticketsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading tickets…</p>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Check className="h-8 w-8 text-emerald-400" />
            <p className="font-semibold">No tickets</p>
            <p className="text-sm text-muted-foreground">
              When the AI copilot escalates a conversation to a human, the ticket lands here with a full summary.
            </p>
          </CardContent>
        </Card>
      ) : (
        shown.map((t) => {
          const meta = STATUS_META[t.status] ?? STATUS_META.open;
          return (
            <Card key={t.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{t.subject}</p>
                  <span className={cn("shrink-0 text-xs font-bold", meta.className)}>{meta.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.requesterName || t.requesterEmail || "Unknown user"}
                  {t.companyName ? ` · ${t.companyName}` : ""} · {timeAgo(t.createdAt)}
                </p>
                {t.summary ? (
                  <p className="whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
                    {t.summary}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {t.threadId ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/messages">
                        <MessageSquare className="mr-1.5 h-4 w-4" /> Open chat
                      </Link>
                    </Button>
                  ) : null}
                  {t.status === "open" ? (
                    <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: t.id, status: "in_progress" })}>
                      <Clock className="mr-1.5 h-4 w-4 text-yellow-400" /> Take it
                    </Button>
                  ) : null}
                  {t.status !== "resolved" ? (
                    <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: t.id, status: "resolved" })}>
                      <Check className="mr-1.5 h-4 w-4 text-emerald-400" /> Resolve
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: t.id, status: "open" })}>
                      <CircleDot className="mr-1.5 h-4 w-4" /> Reopen
                    </Button>
                  )}
                </div>
                {setStatus.isError ? <p className="text-xs text-red-400">{(setStatus.error as Error).message}</p> : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
