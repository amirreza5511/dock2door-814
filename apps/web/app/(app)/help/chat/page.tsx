"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Send, Sparkles } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { askAssistant, type AiMessage } from "@/lib/ai";
import { HELP_ROLES, ROLE_TO_HELP_KEY } from "@/lib/help";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How do I post a load and get a quote?",
  "How do warehouse bookings get accepted?",
  "How do I clock in to my shift and get paid?",
  "Where do I see my invoices?",
];

/** Builds a compact knowledge summary of the manual so the AI answers accurately. */
function buildKnowledge(): string {
  return HELP_ROLES.map((r) => {
    const screens = r.screens.map((s) => `${s.title} (${s.summary})`).join("; ");
    return `ROLE ${r.name}: ${r.overview} Screens: ${screens}`;
  }).join("\n");
}

/** Help Center AI chat — answers questions using the in-app manual. */
export default function HelpChatPage() {
  const supabase = getBrowserSupabase();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);

  const roleQ = useQuery({
    queryKey: ["help", "my-role"],
    queryFn: async (): Promise<string | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
      return (data as { role?: string } | null)?.role ?? null;
    },
  });

  const myRole = roleQ.data ? HELP_ROLES.find((x) => x.key === ROLE_TO_HELP_KEY[roleQ.data as string]) : undefined;

  const systemPrompt = `You are the Dock2Door Help Center assistant. Dock2Door is a logistics, freight-delivery and labour-staffing platform with three worlds: Freight & Delivery (Uber for trucks), Logistics & Warehousing, and Labour. The current user's role is "${myRole?.name ?? roleQ.data ?? "guest"}".
Answer ONLY using the app knowledge below. Be concise, practical and step-by-step. Reference the exact screen names. If something isn't covered, say so briefly and suggest the closest screen. Reply in the same language the user writes in.

APP KNOWLEDGE:
${buildKnowledge()}`;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: trimmed };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setSending(true);

    try {
      const payload: AiMessage[] = [
        { role: "system", content: systemPrompt },
        ...history.map((m): AiMessage => ({ role: m.role, content: m.content })),
      ];
      const reply = await askAssistant(payload);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: "assistant", content: msg }]);
    } finally {
      setSending(false);
    }
  }, [messages, sending, systemPrompt]);

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="flex items-center gap-3 border-b border-white/5 pb-4">
        <Link href="/help" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-card transition-colors hover:bg-accent">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="font-semibold">Help Assistant</p>
          <p className="text-xs text-muted-foreground">Answers come from the app manual</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {empty ? (
          <div className="flex flex-col items-center gap-3 pt-12 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
            <p className="text-lg font-bold">How can I help?</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Ask anything about how Dock2Door works — I answer step-by-step from the manual.
            </p>
            <div className="mt-2 w-full max-w-md space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="w-full rounded-xl border border-white/10 bg-card p-3.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-primary text-primary-foreground"
                    : "rounded-bl-md border border-white/10 bg-card"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/10 bg-card px-4 py-2.5 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-white/5 pt-3"
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
          }}
          placeholder="Ask about any screen or workflow…"
          rows={1}
          disabled={sending}
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-white/10 bg-card px-4 py-3 text-sm outline-none focus:border-primary/50"
        />
        <button
          type="submit"
          disabled={sending || input.trim().length === 0}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
