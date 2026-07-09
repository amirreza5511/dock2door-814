"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface Thread {
  id: string;
  scope: string;
  booking_id: string | null;
  updated_at: string;
  created_at: string;
  unread_count?: number;
  last_message?: string | null;
  participants?: string[];
}

interface Message {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
  sender_name?: string | null;
}

export default function MessagesPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [body, setBody] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: { user: { id: string } | null } }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, []);

  const threadsQ = useQuery({
    queryKey: ["messages", "threads"],
    queryFn: async () => {
      // last_message_preview is written by the tg_notify_thread_message trigger
      // (migration 0040) — no need to fetch thread_messages rows here.
      const { data, error } = await supabase
        .from("chat_threads")
        .select("id, scope, booking_id, updated_at, created_at, last_message_preview")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        id: t.id,
        scope: t.scope,
        booking_id: t.booking_id,
        updated_at: t.updated_at,
        created_at: t.created_at,
        last_message: (t.last_message_preview as string | null) ?? null,
      } as Thread));
    },
  });

  const messagesQ = useQuery({
    queryKey: ["messages", "thread", selectedThread?.id],
    queryFn: async () => {
      if (!selectedThread) return [];
      const { data, error } = await supabase
        .from("thread_messages")
        .select(`id, thread_id, sender_user_id, body, created_at, profiles!inner(name)`)
        .eq("thread_id", selectedThread.id)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((m: any) => ({
        id: m.id,
        thread_id: m.thread_id,
        sender_user_id: m.sender_user_id,
        body: m.body,
        created_at: m.created_at,
        sender_name: m.profiles?.name ?? null,
      })) as Message[];
    },
    enabled: Boolean(selectedThread),
    refetchInterval: 5000, // poll every 5s
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!selectedThread || !body.trim()) return;
      const { error } = await supabase.from("thread_messages").insert({
        thread_id: selectedThread.id,
        body: body.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["messages", "thread", selectedThread?.id] });
      qc.invalidateQueries({ queryKey: ["messages", "threads"] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQ.data]);

  // Deep-link support: /messages?thread=<id> preselects the thread once loaded.
  useEffect(() => {
    if (selectedThread) return;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("thread");
    if (!wanted) return;
    const match = (threadsQ.data ?? []).find((t: Thread) => t.id === wanted);
    if (match) setSelectedThread(match);
  }, [threadsQ.data, selectedThread]);

  return (
    <div className="mx-auto max-w-7xl space-y-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
        <p className="text-sm text-muted-foreground">Conversations with booking and service partners.</p>
      </div>

      <div className="flex h-[600px] rounded-xl border overflow-hidden">
        {/* Thread list */}
        <div className="w-72 shrink-0 border-r flex flex-col bg-card">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-medium">Conversations</p>
            <p className="text-xs text-muted-foreground">{threadsQ.data?.length ?? 0} threads</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threadsQ.isLoading ? (
              <p className="p-4 text-xs text-muted-foreground">Loading…</p>
            ) : (threadsQ.data ?? []).length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No conversations yet.</p>
            ) : (
              (threadsQ.data ?? []).map((t: Thread) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedThread(t)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-accent transition-colors ${
                    selectedThread?.id === t.id ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs">{t.scope}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(t.updated_at)}</span>
                  </div>
                  {t.last_message && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.last_message}</p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Message pane */}
        <div className="flex flex-1 flex-col">
          {!selectedThread ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">Select a conversation to view messages.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="border-b px-6 py-3 flex items-center gap-3 bg-card">
                <Badge variant="secondary">{selectedThread.scope}</Badge>
                {selectedThread.booking_id && (
                  <span className="text-xs text-muted-foreground font-mono">
                    Booking: {selectedThread.booking_id.slice(0, 8)}…
                  </span>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messagesQ.isLoading ? (
                  <p className="text-xs text-muted-foreground text-center">Loading messages…</p>
                ) : (messagesQ.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center">No messages yet. Start the conversation.</p>
                ) : (
                  (messagesQ.data ?? []).map((m: Message) => {
                    const isMe = m.sender_user_id === currentUserId;
                    return (
                      <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[70%] rounded-xl px-3 py-2 ${
                          isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                        }`}>
                          {!isMe && (
                            <div className="text-xs font-medium mb-1 opacity-70">{m.sender_name ?? "Unknown"}</div>
                          )}
                          <p className="text-sm">{m.body}</p>
                          <p className={`text-xs mt-1 opacity-60`}>
                            {new Date(m.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="border-t px-4 py-3 flex gap-2 bg-card">
                <Input
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Type a message…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.mutate(); }
                  }}
                  disabled={send.isPending}
                />
                <Button disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>
                  Send
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {send.error && (
        <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {(send.error as Error).message}
        </div>
      )}
    </div>
  );
}
