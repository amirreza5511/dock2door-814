"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Bell, Plus, Send } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface Thread {
  id: string;
  scope: string;
  booking_id: string | null;
  updated_at: string;
  last_message: string | null;
}

interface Message {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
  sender_name?: string | null;
}

interface Notification {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  created_at: string;
}

export default function TruckingMessagesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"threads" | "notifications">("threads");
  const [selected, setSelected] = useState<Thread | null>(null);
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, [supabase]);

  const threadsQ = useQuery({
    queryKey: ["trucking", "threads"],
    queryFn: async (): Promise<Thread[]> => {
      const { data, error } = await supabase
        .from("chat_threads")
        .select("id, scope, booking_id, updated_at, last_message_preview")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) return [];
      return (data ?? []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        scope: t.scope as string,
        booking_id: (t.booking_id as string | null) ?? null,
        updated_at: t.updated_at as string,
        last_message: (t.last_message_preview as string | null) ?? null,
      }));
    },
  });

  const messagesQ = useQuery({
    queryKey: ["trucking", "thread", selected?.id],
    enabled: Boolean(selected),
    refetchInterval: 5000,
    queryFn: async (): Promise<Message[]> => {
      if (!selected) return [];
      const { data, error } = await supabase
        .from("thread_messages")
        .select("id, thread_id, sender_user_id, body, created_at, profiles!inner(name)")
        .eq("thread_id", selected.id)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) return [];
      return (data ?? []).map((m: Record<string, unknown>) => ({
        id: m.id as string,
        thread_id: m.thread_id as string,
        sender_user_id: m.sender_user_id as string,
        body: m.body as string,
        created_at: m.created_at as string,
        sender_name: (m.profiles as { name?: string } | null)?.name ?? null,
      }));
    },
  });

  const notifsQ = useQuery({
    queryKey: ["trucking", "notifications"],
    refetchInterval: 30000,
    queryFn: async (): Promise<Notification[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, kind, read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return [];
      return (data as Notification[] | null) ?? [];
    },
  });

  const createThread = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("chat_threads")
        .insert({ scope: "Direct" })
        .select("id, scope, booking_id, updated_at, last_message_preview")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async (t: Record<string, unknown>) => {
      setSubject("");
      await qc.invalidateQueries({ queryKey: ["trucking", "threads"] });
      if (t) {
        setSelected({
          id: t.id as string,
          scope: t.scope as string,
          booking_id: (t.booking_id as string | null) ?? null,
          updated_at: t.updated_at as string,
          last_message: null,
        });
      }
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!selected || !body.trim()) return;
      const { error } = await supabase.from("thread_messages").insert({ thread_id: selected.id, body: body.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setBody("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["trucking", "thread", selected?.id] }),
        qc.invalidateQueries({ queryKey: ["trucking", "threads"] }),
      ]);
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["trucking", "notifications"] });
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQ.data]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Trucking</p>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">Threaded dispatch messaging and notifications.</p>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "threads" ? "default" : "outline"} size="sm" onClick={() => setTab("threads")}>
          <MessageSquare className="mr-1.5 h-4 w-4" /> Threads
        </Button>
        <Button variant={tab === "notifications" ? "default" : "outline"} size="sm" onClick={() => setTab("notifications")}>
          <Bell className="mr-1.5 h-4 w-4" /> Notifications
        </Button>
      </div>

      {tab === "threads" ? (
        <div className="flex h-[600px] overflow-hidden rounded-xl border">
          <div className="flex w-72 shrink-0 flex-col border-r bg-card">
            <div className="flex items-center gap-2 border-b px-3 py-3">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="New thread…" className="h-8" />
              <Button size="icon" className="h-8 w-8 shrink-0" disabled={createThread.isPending} onClick={() => createThread.mutate()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threadsQ.isLoading ? (
                <p className="p-4 text-xs text-muted-foreground">Loading…</p>
              ) : (threadsQ.data ?? []).length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">No conversations yet.</p>
              ) : (
                (threadsQ.data ?? []).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className={`w-full border-b px-4 py-3 text-left transition-colors hover:bg-accent ${selected?.id === t.id ? "bg-accent" : ""}`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="text-xs">{t.scope}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDate(t.updated_at)}</span>
                    </div>
                    {t.last_message && <p className="line-clamp-2 text-xs text-muted-foreground">{t.last_message}</p>}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-1 flex-col">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">Select a conversation to view messages.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b bg-card px-6 py-3">
                  <Badge variant="secondary">{selected.scope}</Badge>
                  {selected.booking_id && (
                    <span className="font-mono text-xs text-muted-foreground">Booking: {selected.booking_id.slice(0, 8)}…</span>
                  )}
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {messagesQ.isLoading ? (
                    <p className="text-center text-xs text-muted-foreground">Loading messages…</p>
                  ) : (messagesQ.data ?? []).length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground">No messages yet. Start the conversation.</p>
                  ) : (
                    (messagesQ.data ?? []).map((m) => {
                      const isMe = m.sender_user_id === currentUserId;
                      return (
                        <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[70%] rounded-xl px-3 py-2 ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                            {!isMe && <div className="mb-1 text-xs font-medium opacity-70">{m.sender_name ?? "Unknown"}</div>}
                            <p className="text-sm">{m.body}</p>
                            <p className="mt-1 text-xs opacity-60">
                              {new Date(m.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={endRef} />
                </div>
                <div className="flex gap-2 border-t bg-card px-4 py-3">
                  <Input
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Type a message…"
                    disabled={send.isPending}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.mutate(); } }}
                  />
                  <Button disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {notifsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (notifsQ.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Bell className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No notifications. New events appear here automatically.</p>
            </div>
          ) : (
            (notifsQ.data ?? []).map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted">
                    <Bell className="h-4 w-4 text-blue-400" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{n.title}</p>
                    <p className="text-xs text-muted-foreground">{n.body}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(n.created_at)}</p>
                  </div>
                </div>
                {!n.read && (
                  <Button variant="secondary" size="sm" disabled={markRead.isPending} onClick={() => markRead.mutate(n.id)}>
                    Mark read
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
