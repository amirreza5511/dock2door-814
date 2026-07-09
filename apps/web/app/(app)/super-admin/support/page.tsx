"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LifeBuoy, MessageCircle, RefreshCw } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SupportThreadRow {
  id: string;
  subject: string | null;
  updated_at: string;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  last_message: string | null;
  is_member: boolean;
  support_status?: string | null;
}

export default function SuperAdminSupportPage() {
  const supabase = getBrowserSupabase();
  const router = useRouter();

  const threadsQ = useQuery({
    queryKey: ["sa-support", "threads"],
    staleTime: 15_000,
    queryFn: async (): Promise<SupportThreadRow[]> => {
      const { data, error } = await supabase.rpc("list_support_threads");
      if (error) throw error;
      return (data ?? []) as SupportThreadRow[];
    },
  });

  const joinM = useMutation({
    mutationFn: async (threadId: string) => {
      const { error } = await supabase.rpc("admin_join_thread", { p_thread_id: threadId });
      if (error) throw error;
    },
  });

  const openThread = async (thread: SupportThreadRow) => {
    try {
      if (!thread.is_member) await joinM.mutateAsync(thread.id);
      router.push(`/messages?thread=${thread.id}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to open conversation");
    }
  };

  const threads = threadsQ.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10"><LifeBuoy className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Support Inbox</h1>
            <p className="text-sm text-muted-foreground">{threads.length} need{threads.length === 1 ? "s" : ""} a human</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => threadsQ.refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh</Button>
      </div>

      {threadsQ.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading support inbox…</p>
      ) : threadsQ.isError ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">Unable to load support inbox.</p>
          <Button size="sm" variant="outline" onClick={() => threadsQ.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : threads.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <LifeBuoy className="h-7 w-7" />
          <p className="text-sm font-medium">No support requests yet</p>
          <p className="max-w-sm text-xs">When a worker or company contacts dock2door support, their conversation appears here.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <button key={thread.id} onClick={() => void openThread(thread)} className="block w-full text-left">
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10"><MessageCircle className="h-4 w-4 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{thread.requester_name}</p>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">Needs human</Badge>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{new Date(thread.updated_at).toLocaleDateString()}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{thread.last_message ?? "No messages yet"}</p>
                    {thread.requester_email ? <p className="truncate text-[11px] text-muted-foreground/70">{thread.requester_email}</p> : null}
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
