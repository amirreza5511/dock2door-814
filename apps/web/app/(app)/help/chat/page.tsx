"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Lock, Send, Sparkles } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { askAssistant, type AiMessage } from "@/lib/ai";
import { HELP_ROLES, ROLE_TO_HELP_KEY } from "@/lib/help";

/** A tappable action card the assistant can attach to a reply. */
interface ChatAction {
  /** 'open' navigates to an in-app world/screen; 'signup' routes to sign-up. */
  type: "open" | "signup";
  label: string;
  route?: string;
}

/** A single field inside an intake form card the assistant builds. */
interface ChatFormField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number";
}

/** An intake form the assistant renders so the user just fills in the blanks. */
interface ChatForm {
  title?: string;
  submitLabel?: string;
  fields: ChatFormField[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[];
  form?: ChatForm;
  /** Once a form is submitted it becomes read-only. */
  formDone?: boolean;
}

/** In-app destinations the guest assistant is allowed to deep-link into. */
const ALLOWED_ROUTES: Record<string, true> = {
  "/ground-freight": true,
  "/global-freight": true,
  "/international": true,
  "/ship": true,
  "/directory": true,
};

/** Free assistant messages a guest gets before we ask them to sign in. */
const GUEST_FREE_MESSAGES = 5;

const SUGGESTIONS = [
  "What's the difference between LTL and FTL?",
  "I need to ship 3 pallets from Toronto to Vancouver — what will it cost?",
  "How do customs and duties work for importing into Canada?",
  "How do I post a load and get competing quotes?",
];

/**
 * Split a raw model reply into visible text + a trailing fenced ```actions block.
 * The block is JSON that may contain `actions` (tap-to-open cards) and/or `form`
 * (an intake form the user fills in). Unknown routes are dropped so the assistant
 * can never link somewhere invalid.
 */
function parseReply(raw: string): { text: string; actions: ChatAction[]; form?: ChatForm } {
  const match = raw.match(/```(?:actions|json)\s*([\s\S]*?)```\s*$/);
  if (!match) return { text: raw.trim(), actions: [] };
  const text = raw.slice(0, match.index).trim();
  try {
    const parsed = JSON.parse(match[1]) as { actions?: unknown; form?: unknown };
    const list = Array.isArray(parsed.actions) ? parsed.actions : [];
    const actions: ChatAction[] = list
      .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
      .map((a) => {
        const type = a.type === "signup" ? ("signup" as const) : ("open" as const);
        const label = typeof a.label === "string" ? a.label.trim() : "";
        const route = typeof a.route === "string" ? a.route : undefined;
        return { type, label, route };
      })
      .filter((a) => a.label.length > 0 && (a.type === "signup" || (a.route != null && ALLOWED_ROUTES[a.route])))
      .slice(0, 3);
    const form = parseForm(parsed.form);
    return { text: text || raw.trim(), actions, form };
  } catch {
    return { text: raw.trim(), actions: [] };
  }
}

/** Validates and normalizes a raw `form` object from the model. */
function parseForm(raw: unknown): ChatForm | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const rawFields = Array.isArray(obj.fields) ? obj.fields : [];
  const fields: ChatFormField[] = rawFields
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      key: typeof f.key === "string" ? f.key : "",
      label: typeof f.label === "string" ? f.label.trim() : "",
      placeholder: typeof f.placeholder === "string" ? f.placeholder : undefined,
      type: f.type === "number" ? ("number" as const) : ("text" as const),
    }))
    .filter((f) => f.key.length > 0 && f.label.length > 0)
    .slice(0, 8);
  if (fields.length === 0) return undefined;
  return {
    title: typeof obj.title === "string" ? obj.title.trim() : undefined,
    submitLabel: typeof obj.submitLabel === "string" ? obj.submitLabel.trim() : undefined,
    fields,
  };
}

/** Builds a compact knowledge summary of the manual so the AI answers accurately. */
function buildKnowledge(): string {
  return HELP_ROLES.map((r) => {
    const screens = r.screens.map((s) => `${s.title} (${s.summary})`).join("; ");
    return `ROLE ${r.name}: ${r.overview} Screens: ${screens}`;
  }).join("\n");
}

/**
 * Help Center AI chat — a senior logistics expert + product guide.
 * Mirrors the mobile app's guest assistant: expert answers, intake form cards,
 * deep-link action cards, and a free-message limit for guests.
 */
export default function HelpChatPage() {
  const supabase = getBrowserSupabase();
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);

  const meQ = useQuery({
    queryKey: ["help", "chat-me"],
    queryFn: async (): Promise<{ userId: string | null; role: string | null }> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { userId: null, role: null };
      const { data } = await supabase.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
      return { userId: u.user.id, role: (data as { role?: string } | null)?.role ?? null };
    },
  });

  const isGuest = !meQ.data?.userId;
  const myRole = meQ.data?.role ? HELP_ROLES.find((x) => x.key === ROLE_TO_HELP_KEY[meQ.data.role as string]) : undefined;

  const systemPrompt = `You are the Dock2Door AI — a senior logistics, supply-chain and freight-transport expert AND the product guide for the Dock2Door platform (identical mobile app + web app; everything below works on both).

YOUR EXPERTISE (answer like a seasoned professional, not a generic chatbot):
- End-to-end supply chain: procurement, inbound/outbound, warehousing, inventory, fulfillment, last-mile and reverse logistics.
- Freight modes & pricing: LTL, FTL, LCL, FCL, drayage/container trucking, ocean, air; how chargeable/volumetric weight, accessorials, fuel surcharges, per diem, demurrage and detention work.
- Incoterms 2020 (EXW, FOB, CIF, DAP, DDP, etc.), customs clearance, HS codes, duties/taxes and required documents (BOL, commercial invoice, packing list, AWB, B/L).
- Transport regulations & compliance: carrier authority/operating licenses, insurance & liability, weight/axle limits, hours-of-service/driver rules, dangerous-goods/hazmat basics, and cross-border (Canada/US/international) requirements. Give practical guidance and ALWAYS remind the user to confirm current local rules with the relevant authority — never invent specific legal citations.

Dock2Door is a B2B logistics super-app with these worlds (domains):
1. Labour — post & fill work shifts; workers find shifts; employment agencies bring their own crews.
2. Logistics & Warehousing — book warehouse space (dry/chilled/frozen), industrial services, trucking & fulfillment.
3. Freight & Delivery — "Uber for trucks": shippers post loads (parcel to full truckload), owner-operators & fleet carriers accept and dispatch.
4. Container Drayage — post import/export container orders; drayage companies claim, dispatch drivers & track live; customs brokers clear shipments.
5. Rentals & Services — rent equipment (forklifts, cranes), book mobile repair, and insure cargo.
6. Global Freight — international shipping exchange: post one freight request (air/ocean/truck, FCL/LCL) and receive competing quotes from forwarders and carriers worldwide.
7. LTL & FTL Quotes — post a truck load (LTL part-load, FTL full-truck, or LCL shared container) locally, across Canada, or internationally with optional final-mile to the door, get an instant ballpark estimate, and receive competing quotes from carriers and companies.
The current user's role is "${myRole?.name ?? meQ.data?.role ?? "guest visitor (no account yet)"}".
${isGuest ? "This person is exploring WITHOUT an account. Answer their logistics question expertly first, then briefly connect it to the right world/screen and warmly invite them to create an account to post a real order or get live quotes. Keep it helpful, not pushy." : ""}
LANGUAGE: Reply in the SAME language the user writes in (if they write Persian/Farsi, answer in fluent Persian). Keep app screen/world names recognizable.
Be concise, practical and step-by-step. Reference the exact screen/world names when relevant. If something isn't covered by the platform, say so briefly and suggest the closest world. Keep replies complete but tight — never leave a sentence unfinished.

MANY USERS KNOW NOTHING ABOUT LOGISTICS. Don't dump jargon or ask them to fill a long form themselves. Instead, gently gather what you need with a simple INTAKE FORM CARD, then do the thinking for them.

CHOOSING THE RIGHT MODE (critical — do NOT default everything to LTL):
- A small parcel / box / envelope / a few cartons / anything a courier could carry (roughly under ~70 kg and not on a pallet) is a PARCEL. Send it to "/ship" — NEVER call this LTL. If a user says "a package" / "یک بسته" / "a box", treat it as parcel unless they clearly describe pallets or heavy freight.
- LTL (Less-than-Truckload) is ONLY for palletized / freight-sized shipments that don't fill a truck (roughly 1–6 pallets or ~100–5,000 kg) → "/ground-freight".
- FTL (Full Truckload) is a full/near-full truck or very heavy load → "/ground-freight".
- LCL / FCL is ocean containers (shared vs. full) for overseas cargo → "/global-freight" (or "/ground-freight" LCL for a shared container inland).
- Air / ocean international freight → "/global-freight".
When the size is unclear, ASK (how many pieces, on pallets or loose, rough weight) before naming a mode. Only recommend LTL/FTL once you're confident it's palletized freight, not a courier parcel.

END-OF-REPLY BLOCK:
When it helps, append EXACTLY ONE fenced block at the very END of your reply. It is JSON that may contain a "form" (fields the user fills in) and/or "actions" (tap-to-open cards). Nothing after it.

1) INTAKE FORM — use this to collect a shipment's/job's details ONE friendly step at a time. Ask only for what you still need, in plain words with examples:
\`\`\`actions
{"form":{"title":"Tell me about your load","submitLabel":"Get my estimate","fields":[{"key":"from","label":"Where does it ship FROM? (city)","placeholder":"e.g. Toronto"},{"key":"to","label":"Where should it go? (city)","placeholder":"e.g. Vancouver"},{"key":"what","label":"What are you shipping?","placeholder":"e.g. 5 pallets of furniture"},{"key":"weight","label":"Rough total weight?","placeholder":"e.g. 800 kg","type":"number"},{"key":"when","label":"When is it ready?","placeholder":"e.g. next Monday"}]}}
\`\`\`
Keep forms short (max ~6 fields). After the user submits, their answers arrive as their next message; then explain in simple terms what it means (which mode — LTL/FTL/LCL), give a rough ballpark estimate and range, and guide the next step. Never show a form and an 'open' card at the same time.

2) OPEN / SIGN-UP CARDS — once details are gathered, send them to the right place:
\`\`\`actions
{"actions":[{"type":"open","label":"Get LTL & FTL truck quotes","route":"/ground-freight"}]}
\`\`\`
Allowed routes ONLY: "/ground-freight" (LTL/FTL/LCL truck quotes), "/global-freight" (international air/ocean freight quotes), "/international" (import/export tools), "/ship" (parcel & load shipping), "/directory" (browse companies). Use type "signup" (no route) when the next step needs an account (posting a real load, sending a request, seeing live quotes). Max 2 action cards. Omit the block entirely when nothing fits. The visible text before the block must read naturally on its own.

APP KNOWLEDGE:
${buildKnowledge()}`;

  // Guests get a handful of free replies before we invite them to sign in.
  const [guestReplies, setGuestReplies] = useState<number>(0);
  const gated = isGuest && guestReplies >= GUEST_FREE_MESSAGES;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (isGuest && guestReplies >= GUEST_FREE_MESSAGES) return;

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
      const { text: replyText, actions, form } = parseReply(reply);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: replyText, actions, form }]);
      if (isGuest) setGuestReplies((n) => n + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: "assistant", content: msg }]);
    } finally {
      setSending(false);
    }
  }, [messages, sending, systemPrompt, isGuest, guestReplies]);

  const runAction = useCallback((action: ChatAction) => {
    if (action.type === "signup") { router.push("/login"); return; }
    if (action.route && ALLOWED_ROUTES[action.route]) router.push(action.route);
  }, [router]);

  // Per-message form answers, keyed by message id then field key.
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const setField = useCallback((msgId: string, key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [msgId]: { ...(prev[msgId] ?? {}), [key]: value } }));
  }, []);

  const submitForm = useCallback((msg: ChatMessage) => {
    if (!msg.form || msg.formDone || sending) return;
    const answers = formData[msg.id] ?? {};
    const filled = msg.form.fields.filter((f) => (answers[f.key] ?? "").trim().length > 0);
    if (filled.length === 0) return;
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, formDone: true } : m)));
    const summary = filled.map((f) => `- ${f.label}: ${(answers[f.key] ?? "").trim()}`).join("\n");
    void send(`Here are my details:\n${summary}`);
  }, [formData, sending, send]);

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
          <p className="font-semibold">AI Logistics Assistant</p>
          <p className="text-xs text-muted-foreground">Senior freight & supply-chain expert · knows every screen</p>
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
              Ask anything about shipping, freight pricing, customs, or how Dock2Door works — in any language.
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
            <div key={m.id} className="space-y-2">
              <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
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

              {m.role === "assistant" && m.form && (
                <div className="space-y-3 rounded-2xl border border-primary/30 bg-card p-4">
                  {m.form.title && <p className="text-sm font-bold">{m.form.title}</p>}
                  {m.form.fields.map((f) => (
                    <div key={`${m.id}-f-${f.key}`} className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">{f.label}</label>
                      <input
                        value={(formData[m.id] ?? {})[f.key] ?? ""}
                        onChange={(e) => setField(m.id, f.key, e.target.value)}
                        placeholder={f.placeholder}
                        disabled={m.formDone}
                        inputMode={f.type === "number" ? "decimal" : undefined}
                        className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 disabled:opacity-60"
                      />
                    </div>
                  ))}
                  {!m.formDone && (
                    <button
                      onClick={() => submitForm(m)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <Sparkles className="h-4 w-4" />
                      {m.form.submitLabel ?? "Ask AI"}
                    </button>
                  )}
                </div>
              )}

              {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                <div className="space-y-2">
                  {m.actions.map((a, i) => (
                    <button
                      key={`${m.id}-a-${i}`}
                      onClick={() => runAction(a)}
                      className="flex w-full items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-left transition-colors hover:bg-primary/20"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15">
                        {a.type === "signup" ? <Lock className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
                      </span>
                      <span className="flex-1 text-sm font-semibold">{a.label}</span>
                      <Send className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {gated && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-primary/40 bg-card p-6 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <p className="text-base font-bold">You&rsquo;ve reached the free limit</p>
            <p className="text-sm text-muted-foreground">Sign in and get credits to keep chatting with the logistics assistant.</p>
            <Link
              href="/login"
              className="mt-2 w-full rounded-xl bg-primary py-3 text-center text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Sign in &amp; get credits
            </Link>
          </div>
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
          placeholder="Ask about shipping, pricing, customs — any language…"
          rows={1}
          disabled={sending || gated}
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-white/10 bg-card px-4 py-3 text-sm outline-none focus:border-primary/50 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending || gated || input.trim().length === 0}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
