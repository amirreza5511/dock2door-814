"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Sparkles } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { askAssistant, type AiMessage } from "@/lib/ai";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How do I clock in to my shift?",
  "Explain how hours get confirmed and paid.",
  "Write a short shift description for a forklift operator.",
  "What documents do I need to start working?",
];

/** General AI assistant — mirrors the mobile /assistant screen. */
export default function AssistantPage() {
  const supabase = getBrowserSupabase();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);

  const roleQ = useQuery({
    queryKey: ["assistant", "my-role"],
    queryFn: async (): Promise<string | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
      return (data as { role?: string } | null)?.role ?? null;
    },
  });

  const systemPrompt = `You are Dock2Door's helpful in-app assistant for a logistics and labour-staffing platform. The current user role is "${roleQ.data ?? "guest"}". Answer concisely and practically about shifts, clocking in/out, warehousing, bookings, and general logistics. If asked something unrelated, answer briefly and helpfully.`;

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
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="font-semibold">AI Assistant</p>
          <p className="text-xs text-muted-foreground">Ask anything about your work</p>
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
              I can explain how the app works, draft shift posts, and answer logistics questions.
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
          placeholder="Message the assistant…"
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
