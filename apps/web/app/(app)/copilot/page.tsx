"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, Radar, Lightbulb, ShieldCheck, AlertTriangle, Info, OctagonAlert,
  Check, X, Play, Brain, Trash2, Repeat2, TrendingDown, DollarSign, Plus, Send, Mic, Square,
  Paperclip, FileText, History, MessageSquare, SquarePen, ChevronRight,
} from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAssistant, type AiMessage, type AiImageAttachment } from "@/lib/ai";
import {
  buildCopilotSystemPrompt, parseCopilotReply, copilotSuggestions,
  type CopilotAction,
} from "@/lib/copilot";
import { cn } from "@/lib/utils";

interface ChatSession {
  session_id: string;
  title: string;
  msg_count: number;
  started_at: string;
  last_at: string;
}

/** Lightweight uuid v4 for grouping chat sessions (not cryptographic). */
function newSessionId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

type TabKey = "chat" | "alerts" | "insights";

interface UiMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions: CopilotAction[];
  attachments?: ChatAttachment[];
}

/** A pending or sent chat attachment (photo for vision, or a document). */
interface ChatAttachment {
  id: string;
  kind: "image" | "doc";
  name: string;
  /** Full data URI for images (used for the thumbnail and vision). */
  dataUrl?: string;
}

interface AiEvent {
  id: string;
  kind: string;
  severity: string;
  source: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

interface MemoryRow {
  id: string;
  content: string;
}

interface StreetTurnSuggestion {
  provider_order_id: string;
  provider_ref: string | null;
  receiver_order_id: string;
  receiver_ref: string | null;
  terminal: string | null;
  saved_miles: number | null;
  saved_cost: number | null;
}

const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-red-400", high: "text-red-400", medium: "text-yellow-400", low: "text-blue-400",
};
const SEVERITY_BG: Record<string, string> = {
  critical: "bg-red-500/15", high: "bg-red-500/15", medium: "bg-yellow-500/15", low: "bg-blue-500/15",
};

function kindIcon(kind: string) {
  if (kind === "error") return OctagonAlert;
  if (kind === "suggestion") return Lightbulb;
  if (kind === "info") return Info;
  return AlertTriangle;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function sanitizeActions(raw: unknown): CopilotAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is CopilotAction => typeof a === "object" && a !== null && typeof (a as { type?: unknown }).type === "string")
    .map((a) => ({ ...a, label: a.label ?? String(a.type), params: a.params ?? {} }));
}

export default function CopilotPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<TabKey>("chat");
  const [messages, setMessages] = useState<UiMsg[] | null>(null);
  const [input, setInput] = useState<string>("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string>("");
  const [memoryDraft, setMemoryDraft] = useState<string>("");
  const [ideas, setIdeas] = useState<string>("");
  const [ideasLoading, setIdeasLoading] = useState<boolean>(false);
  const [alertFilter, setAlertFilter] = useState<"open" | "all">("open");
  // The conversation currently on screen. null = latest session (resolved on
  // first load); a fresh uuid = a brand-new chat.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // Current user id — used to scope all cached copilot queries so switching
  // accounts in the same tab never shows another user's cached chat/data.
  const uidQ = useQuery({
    queryKey: ["auth", "uid"],
    staleTime: 0,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });
  const uid = uidQ.data ?? null;

  const contextQ = useQuery({
    queryKey: ["ai", "context", uid],
    enabled: !!uid,
    refetchInterval: 60000,
    queryFn: async (): Promise<Record<string, unknown> | null> => {
      const { data, error } = await supabase.rpc("ai_copilot_context");
      if (error) {
        if (error.message.includes("function") || error.code === "PGRST202") return null;
        throw error;
      }
      return (data as Record<string, unknown> | null) ?? {};
    },
  });

  const historyQ = useQuery({
    queryKey: ["ai", "chatHistory", uid, sessionId],
    enabled: !!uid,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      let sid = sessionId;
      if (!sid) {
        const { data: last } = await supabase
          .from("ai_chat_messages")
          .select("session_id")
          .eq("user_id", u.user.id)
          .not("session_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);
        sid = (Array.isArray(last) ? (last[0]?.session_id as string | undefined) : undefined) ?? null;
      }
      if (!sid) return [];
      const { data, error } = await supabase
        .from("ai_chat_messages")
        .select("*")
        .eq("user_id", u.user.id)
        .eq("session_id", sid)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) {
        if (error.code === "42P01" || error.message.includes("schema cache")) return [];
        throw error;
      }
      return data ?? [];
    },
  });

  const sessionsQ = useQuery({
    queryKey: ["ai", "chatSessions", uid],
    enabled: !!uid && showHistory,
    queryFn: async (): Promise<ChatSession[]> => {
      const { data, error } = await supabase.rpc("ai_chat_sessions");
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST202" || error.message.includes("schema cache")) return [];
        throw error;
      }
      return (data as ChatSession[] | null) ?? [];
    },
  });

  const memoriesQ = useQuery({
    queryKey: ["ai", "memories", uid],
    enabled: !!uid,
    queryFn: async (): Promise<MemoryRow[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("ai_memories")
        .select("id, content")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        if (error.code === "42P01" || error.message.includes("schema cache")) return [];
        throw error;
      }
      return (data as MemoryRow[] | null) ?? [];
    },
  });

  const eventsQ = useQuery({
    queryKey: ["ai", "events", uid],
    enabled: !!uid,
    refetchInterval: 30000,
    queryFn: async (): Promise<AiEvent[]> => {
      const { data, error } = await supabase
        .from("ai_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) {
        if (error.code === "42P01" || error.message.includes("schema cache")) return [];
        throw error;
      }
      return (data as AiEvent[] | null) ?? [];
    },
  });

  const streetTurnsQ = useQuery({
    queryKey: ["ai", "streetTurns", uid],
    enabled: !!uid,
    queryFn: async (): Promise<StreetTurnSuggestion[]> => {
      const { data, error } = await supabase.rpc("drayage_street_turn_suggestions");
      if (error) {
        if (error.message.includes("function") || error.code === "PGRST202") return [];
        throw error;
      }
      return (data as StreetTurnSuggestion[] | null) ?? [];
    },
  });

  const appendChat = useMutation({
    mutationFn: async (payload: { sessionId?: string | null; items: { role: "user" | "assistant"; content: string; actions?: unknown[] }[] }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      await supabase.from("ai_chat_messages").insert(
        payload.items.map((m) => ({ user_id: u.user!.id, session_id: payload.sessionId ?? null, role: m.role, content: m.content, actions: m.actions ?? [] })),
      );
    },
  });

  const addMemory = useMutation({
    mutationFn: async (content: string) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase.from("ai_memories").insert({ user_id: u.user.id, content });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "memories"] }),
  });

  const deleteMemory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ai_memories").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "memories"] }),
  });

  const clearChat = useMutation({
    mutationFn: async (sid?: string | null) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      let q = supabase.from("ai_chat_messages").delete().eq("user_id", u.user.id);
      if (sid) q = q.eq("session_id", sid);
      await q;
    },
    onSuccess: () => {
      setMessages([]);
      setSessionId(newSessionId());
      void qc.invalidateQueries({ queryKey: ["ai", "chatSessions"] });
    },
  });

  const runWatchdog = useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("ai_run_watchdog");
      if (error) {
        if (error.message.includes("function") || error.code === "PGRST202") return 0;
        throw new Error(error.message);
      }
      return Number(data ?? 0);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "events"] }),
  });

  const setEventStatus = useMutation({
    mutationFn: async (v: { id: string; status: "resolved" | "dismissed" }) => {
      const { error } = await supabase
        .from("ai_events")
        .update({ status: v.status, resolved_at: new Date().toISOString() })
        .eq("id", v.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "events"] }),
  });

  const linkStreetTurn = useMutation({
    mutationFn: async (s: { providerOrderId: string; receiverOrderId: string }) => {
      const { error } = await supabase.rpc("link_street_turn", {
        p_provider_order_id: s.providerOrderId,
        p_receiver_order_id: s.receiverOrderId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ai", "streetTurns"] }),
        qc.invalidateQueries({ queryKey: ["ai", "context"] }),
      ]);
    },
  });

  const context = contextQ.data;
  const isCompany = !!(context && typeof context === "object" && "orders" in context);
  const roleStr = typeof (context as { role?: unknown } | null | undefined)?.role === "string" ? String((context as { role?: string }).role) : "";
  const companyTypeStr = typeof (context as { companyType?: unknown } | null | undefined)?.companyType === "string" ? String((context as { companyType?: string }).companyType) : "";
  const suggestions = useMemo(() => copilotSuggestions(roleStr, companyTypeStr), [roleStr, companyTypeStr]);
  const memories = useMemo(() => memoriesQ.data ?? [], [memoriesQ.data]);
  const companyName = (context as { companyName?: string } | null | undefined)?.companyName ?? "";
  const dead = (context as { deadRuns7d?: { empty_miles?: number; deadhead_miles?: number; dead_cost?: number; savings_cost?: number } } | null | undefined)?.deadRuns7d;

  // Reset local chat state whenever the signed-in user changes so a new
  // account never sees the previous account's conversation.
  const chatUserRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (chatUserRef.current === undefined) {
      chatUserRef.current = uid;
      return;
    }
    if (chatUserRef.current !== uid) {
      chatUserRef.current = uid;
      setMessages(null);
      setDoneKeys(new Set());
    }
  }, [uid]);

  // Hydrate chat from persisted history once (for the active session). Also
  // capture the session_id so appends stay in this thread.
  useEffect(() => {
    if (messages === null && historyQ.data) {
      const raw = historyQ.data as { id: string; role: string; content: string; actions?: unknown; session_id?: string }[];
      const rows = raw.map((r): UiMsg => ({
        id: r.id,
        role: r.role === "assistant" ? "assistant" : "user",
        content: r.content,
        actions: sanitizeActions(r.actions),
      }));
      if (sessionId === null && raw[0]?.session_id) setSessionId(raw[0].session_id);
      setMessages(rows);
    }
  }, [historyQ.data, messages, sessionId]);

  // Kick a watchdog scan on open (fire-and-forget).
  const scannedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!scannedRef.current) {
      scannedRef.current = true;
      runWatchdog.mutate(undefined, { onError: () => undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length, sending]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    const pending = attachments;
    if ((!trimmed && pending.length === 0) || sending) return;
    const docNote = pending.filter((a) => a.kind === "doc").map((a) => `[Attached document: ${a.name}]`).join("\n");
    const imgCount = pending.filter((a) => a.kind === "image").length;
    const imgNote = imgCount > 0 ? `[Attached ${imgCount} photo(s)]` : "";
    const composed = [trimmed, imgNote, docNote].filter(Boolean).join("\n").trim() || "(see attachment)";
    const sid = sessionId ?? newSessionId();
    if (!sessionId) setSessionId(sid);
    const images: AiImageAttachment[] = pending
      .filter((a) => a.kind === "image" && a.dataUrl)
      .map((a) => ({ dataUrl: a.dataUrl as string }));
    const userMsg: UiMsg = { id: `u-${Date.now()}`, role: "user", content: composed, actions: [], attachments: pending };
    const history = [...(messages ?? []), userMsg];
    setMessages(history);
    setInput("");
    setAttachments([]);
    setSending(true);
    void appendChat.mutateAsync({ sessionId: sid, items: [{ role: "user", content: composed }] }).catch(() => undefined);
    try {
      const system = buildCopilotSystemPrompt(context ?? {}, memories.map((m) => m.content));
      const prior: AiMessage[] = history.slice(-16).map((m) => ({ role: m.role, content: m.content }));
      const raw = await askAssistant([{ role: "system", content: system }, ...prior], images);
      const parsed = parseCopilotReply(raw);
      const aiMsg: UiMsg = { id: `a-${Date.now()}`, role: "assistant", content: parsed.text, actions: parsed.actions };
      setMessages((prev) => [...(prev ?? []), aiMsg]);
      void appendChat.mutateAsync({ sessionId: sid, items: [{ role: "assistant", content: parsed.text, actions: parsed.actions }] }).catch(() => undefined);
      if (parsed.memory) {
        void addMemory.mutateAsync(parsed.memory).catch(() => undefined);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setMessages((prev) => [...(prev ?? []), { id: `e-${Date.now()}`, role: "assistant", content: msg, actions: [] }]);
    } finally {
      setSending(false);
    }
  }, [messages, sending, attachments, context, memories, appendChat, addMemory, sessionId]);

  // ── Attachments: photo (vision) or document ──
  const onPickFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const readAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
    const next: ChatAttachment[] = [];
    for (const file of Array.from(files)) {
      try {
        if (file.type.startsWith("image/")) {
          const dataUrl = await readAsDataUrl(file);
          next.push({ id: `img-${Date.now()}-${next.length}`, kind: "image", name: file.name, dataUrl });
        } else {
          next.push({ id: `doc-${Date.now()}-${next.length}`, kind: "doc", name: file.name });
        }
      } catch {
        /* skip unreadable file */
      }
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const runAction = useCallback(async (msgId: string, idx: number, action: CopilotAction) => {
    const key = `${msgId}:${idx}`;
    if (runningKey || doneKeys.has(key)) return;
    setRunningKey(key);
    setActionError("");
    try {
      const p = action.params as Record<string, unknown>;
      if (action.type === "dispatch_move") {
        if (!p.moveId || !p.driverUserId) throw new Error("The proposal is missing the move or driver id.");
        const { error } = await supabase.rpc("dispatch_drayage_move", {
          p_move_id: String(p.moveId),
          p_driver_user_id: String(p.driverUserId),
          p_appt_date: p.apptDate ? String(p.apptDate) : null,
          p_appt_time: p.apptTime ? String(p.apptTime) : "",
        });
        if (error) throw new Error(error.message);
      } else if (action.type === "assign_equipment") {
        if (!p.orderId) throw new Error("The proposal is missing the order id.");
        const { error } = await supabase.rpc("assign_drayage_equipment", {
          p_order_id: String(p.orderId),
          p_truck_id: p.truckId ? String(p.truckId) : null,
          p_chassis_id: p.chassisId ? String(p.chassisId) : null,
          p_trailer_id: p.trailerId ? String(p.trailerId) : null,
        });
        if (error) throw new Error(error.message);
      } else if (action.type === "set_charges") {
        if (!p.orderId) throw new Error("The proposal is missing the order id.");
        const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
        const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
        const { error } = await supabase.rpc("set_drayage_charges", {
          p_order_id: String(p.orderId),
          p_per_diem_free_days: num(p.perDiemFreeDays), p_per_diem_last_free_day: str(p.perDiemLastFreeDay), p_per_diem_daily_rate: num(p.perDiemDailyRate),
          p_demurrage_free_days: num(p.demurrageFreeDays), p_demurrage_last_free_day: str(p.demurrageLastFreeDay), p_demurrage_daily_rate: num(p.demurrageDailyRate),
          p_storage_free_days: num(p.storageFreeDays), p_storage_last_free_day: str(p.storageLastFreeDay), p_storage_daily_rate: num(p.storageDailyRate),
        });
        if (error) throw new Error(error.message);
      } else if (action.type === "link_street_turn") {
        if (!p.providerOrderId || !p.receiverOrderId) throw new Error("The proposal is missing order ids.");
        await linkStreetTurn.mutateAsync({ providerOrderId: String(p.providerOrderId), receiverOrderId: String(p.receiverOrderId) });
      } else if (action.type === "create_shift") {
        if (!p.title || !p.date || !p.startTime || !p.endTime) throw new Error("The proposal is missing shift details.");
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("Not signed in");
        const { data: prof } = await supabase.from("profiles").select("company_id").eq("id", u.user.id).maybeSingle();
        const companyId = (prof as { company_id?: string | null } | null)?.company_id;
        if (!companyId) throw new Error("Company context required to post a shift.");
        const category = p.category ? String(p.category) : "General";
        const { error } = await supabase.from("shift_posts").insert({
          employer_company_id: companyId,
          title: String(p.title),
          category,
          skills: [category],
          location_address: "",
          location_city: p.locationCity ? String(p.locationCity) : "",
          date: String(p.date),
          start_time: String(p.startTime),
          end_time: String(p.endTime),
          hourly_rate: p.hourlyRate != null ? Number(p.hourlyRate) : null,
          minimum_hours: 1,
          workers_needed: p.workersNeeded ? Number(p.workersNeeded) : 1,
          requirements: p.requirements ? String(p.requirements) : "",
          notes: p.notes ? String(p.notes) : "",
          status: "Posted",
        });
        if (error) throw new Error(error.message);
      } else if (action.type === "accept_applicant") {
        if (!p.applicationId) throw new Error("The proposal is missing the application id.");
        const { error } = await supabase.rpc("employer_accept_applicant", {
          p_application_id: String(p.applicationId),
          p_rate: p.rate != null ? Number(p.rate) : null,
        });
        if (error) throw new Error(error.message);
      } else if (action.type === "apply_shift") {
        if (!p.shiftId) throw new Error("The proposal is missing the shift id.");
        const { error } = await supabase.rpc("worker_apply_shift", { p_shift_id: String(p.shiftId) });
        if (error) throw new Error(error.message);
      } else if (action.type === "dispatch_load") {
        if (!p.loadId || !p.driverUserId) throw new Error("The proposal is missing the load or driver id.");
        const { error } = await supabase.rpc("dispatch_load", {
          p_load_id: String(p.loadId),
          p_driver_user_id: String(p.driverUserId),
        });
        if (error) throw new Error(error.message);
      } else if (action.type === "create_drayage_order") {
        if (!p.direction || !p.containerNumber) throw new Error("The proposal is missing the direction or container number.");
        const { error } = await supabase.rpc("create_drayage_order", {
          p_direction: String(p.direction),
          p_container_number: String(p.containerNumber),
          p_container_size: p.containerSize ? String(p.containerSize) : "40ft",
          p_container_type: "",
          p_bol_number: "",
          p_booking_number: "",
          p_commodity: p.commodity ? String(p.commodity) : "",
          p_weight_kg: p.weightKg != null ? Number(p.weightKg) : 0,
          p_is_hazmat: false,
          p_is_overweight: false,
          p_is_oversized: false,
          p_origin_terminal_id: null,
          p_destination_terminal_id: null,
          p_warehouse_company_id: null,
          p_pickup_address: p.pickupAddress ? String(p.pickupAddress) : "",
          p_pickup_city: p.pickupCity ? String(p.pickupCity) : "",
          p_pickup_lat: 0,
          p_pickup_lng: 0,
          p_delivery_address: p.deliveryAddress ? String(p.deliveryAddress) : "",
          p_delivery_city: p.deliveryCity ? String(p.deliveryCity) : "",
          p_delivery_lat: 0,
          p_delivery_lng: 0,
          p_port_reservation_date: null,
          p_port_reservation_time: "",
          p_is_prepull: false,
          p_prepull_pickup_date: null,
          p_prepull_yard_terminal_id: null,
          p_notes: p.notes ? String(p.notes) : "",
          p_target_drayage_company_id: p.targetDrayageCompanyId ? String(p.targetDrayageCompanyId) : null,
          p_handling_mode: "LiveUnload",
          p_pickup_back_date: null,
        });
        if (error) throw new Error(error.message);
      } else if (action.type === "forward_intake") {
        if (!p.targetCompanyId || !p.body) throw new Error("The proposal is missing the target company or the summary.");
        const { error } = await supabase.rpc("ai_forward_intake", {
          p_target_company_id: String(p.targetCompanyId),
          p_subject: p.subject ? String(p.subject) : action.label,
          p_body: String(p.body),
        });
        if (error) throw new Error(error.message);
        setTimeout(() => router.push("/messages"), 800);
      } else if (action.type === "escalate_human") {
        const { error } = await supabase.rpc("create_support_ticket", {
          p_subject: p.subject ? String(p.subject) : action.label,
          p_summary: p.summary ? String(p.summary) : "",
        });
        if (error) throw new Error(error.message);
        setTimeout(() => router.push("/messages"), 800);
      } else if (action.type === "run_watchdog") {
        await runWatchdog.mutateAsync();
      } else if (action.type === "request_customization") {
        const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : "Customize workspace";
        const { error } = await supabase.rpc("submit_customization_request", {
          p_title: title,
          p_details: typeof p.details === "string" ? p.details : "",
          p_payload: (typeof p.payload === "object" && p.payload !== null ? p.payload : {}) as Record<string, unknown>,
        });
        if (error) throw new Error(error.message);
      } else {
        throw new Error("Unknown action type.");
      }
      setDoneKeys((prev) => new Set(prev).add(key));
      const confirm = `✅ Done: ${action.label}`;
      setMessages((prev) => [...(prev ?? []), { id: `c-${Date.now()}`, role: "assistant", content: confirm, actions: [] }]);
      void appendChat.mutateAsync({ sessionId: sessionId ?? undefined, items: [{ role: "assistant", content: confirm }] }).catch(() => undefined);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ai", "context"] }),
        qc.invalidateQueries({ queryKey: ["ai", "events"] }),
        qc.invalidateQueries({ queryKey: ["drayage"] }),
      ]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setRunningKey(null);
    }
  }, [runningKey, doneKeys, supabase, linkStreetTurn, runWatchdog, appendChat, qc, router]);

  // ── Voice input via the browser's speech recognition ──
  const [recording, setRecording] = useState<boolean>(false);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);

  const toggleMic = useCallback(() => {
    if (recording) {
      recogRef.current?.stop();
      setRecording(false);
      return;
    }
    const recog = getSpeechRecognition();
    if (!recog) {
      setActionError("Voice input is not supported in this browser — try Chrome or Edge.");
      return;
    }
    recogRef.current = recog;
    recog.lang = navigator.language || "en-US";
    recog.interimResults = false;
    recog.continuous = false;
    recog.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, i) => event.results[i]?.[0]?.transcript ?? "").join(" ").trim();
      if (transcript) setInput((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
    };
    recog.onend = () => setRecording(false);
    recog.onerror = () => setRecording(false);
    setActionError("");
    setRecording(true);
    recog.start();
  }, [recording]);

  const generateIdeas = useCallback(async () => {
    if (ideasLoading) return;
    setIdeasLoading(true);
    setIdeas("");
    try {
      const system = buildCopilotSystemPrompt(context ?? {}, memories.map((m) => m.content));
      const raw = await askAssistant([
        { role: "system", content: system },
        { role: "user", content: "Give me your best concrete money-making and cost-cutting suggestions right now, strictly based on the snapshot: pairable street turns, accruing or soon-due per diem/demurrage/storage, idle or overdue rentals, dead-run cost, unassigned moves. Short bullet list with $ estimates where possible. Do NOT emit an actions block." },
      ]);
      setIdeas(parseCopilotReply(raw).text);
    } catch (e) {
      setIdeas(e instanceof Error ? e.message : "Unable to generate suggestions.");
    } finally {
      setIdeasLoading(false);
    }
  }, [ideasLoading, context, memories]);

  // Start a brand-new conversation WITHOUT deleting the current one.
  const startNewChat = useCallback(() => {
    if (sending || (messages ?? []).length === 0) return;
    setMessages([]);
    setInput("");
    setAttachments([]);
    setDoneKeys(new Set());
    setSessionId(newSessionId());
    void qc.invalidateQueries({ queryKey: ["ai", "chatSessions"] });
  }, [sending, messages, qc]);

  // Open a past conversation from the history list.
  const openSession = useCallback((sid: string) => {
    setShowHistory(false);
    if (sid === sessionId) return;
    setMessages(null);
    setDoneKeys(new Set());
    setSessionId(sid);
  }, [sessionId]);

  const timeAgo = useCallback((iso?: string | null): string => {
    if (!iso) return "";
    const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
    return `${Math.floor(secs / 86400)}d`;
  }, []);

  const events = eventsQ.data ?? [];
  const shownEvents = alertFilter === "open" ? events.filter((e) => e.status === "open") : events;
  const openCount = events.filter((e) => e.status === "open").length;
  const streetTurns = streetTurnsQ.data ?? [];
  const empty = (messages ?? []).length === 0;

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" /> AI Copilot
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{companyName ? `Watching ${companyName}` : "Your personal AI operator"}</h1>
        </div>
        {tab === "chat" ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowHistory(true)}>
              <History className="mr-1.5 h-4 w-4" /> History
            </Button>
            {!empty ? (
              <>
                <Button variant="outline" size="sm" onClick={startNewChat}>
                  <SquarePen className="mr-1.5 h-4 w-4" /> New chat
                </Button>
                <Button variant="outline" size="sm" onClick={() => clearChat.mutate(sessionId ?? undefined)} disabled={clearChat.isPending}>
                  <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex gap-2">
        {([
          ["chat", "Chat", Sparkles],
          ["alerts", "Alerts", Radar],
          ["insights", "Insights", Lightbulb],
        ] as [TabKey, string, typeof Sparkles][]).map(([key, label, Icon]) => (
          <Button key={key} size="sm" variant={tab === key ? "default" : "outline"} onClick={() => setTab(key)}>
            <Icon className="mr-1.5 h-4 w-4" /> {label}
            {key === "alerts" && openCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{openCount}</span>
            ) : null}
          </Button>
        ))}
      </div>

      {tab === "chat" ? (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-card/40 p-4">
            {empty ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15">
                  <Sparkles className="h-7 w-7 text-primary" />
                </div>
                <p className="text-lg font-semibold">Your own AI brain</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  I see your live data and I can actually do things — book workers, dispatch drivers, coordinate containers, reach providers, or bring in a human. You approve every action with one click. Speak or type in any language.
                </p>
                <div className="mt-2 grid w-full max-w-md gap-2">
                  {suggestions.map((s) => (
                    <button key={s} className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm transition hover:bg-accent" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              (messages ?? []).map((m) => (
                <div key={m.id}>
                  <div className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      m.role === "user" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border border-border bg-card",
                    )}>
                      {m.attachments && m.attachments.length > 0 ? (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {m.attachments.map((att) => (
                            att.kind === "image" && att.dataUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={att.id} src={att.dataUrl} alt={att.name} className="h-24 w-32 rounded-lg object-cover" />
                            ) : (
                              <span key={att.id} className="flex max-w-[200px] items-center gap-1.5 rounded-lg bg-black/20 px-2 py-1 text-xs">
                                <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{att.name}</span>
                              </span>
                            )
                          ))}
                        </div>
                      ) : null}
                      {m.content ? m.content : null}
                    </div>
                  </div>
                  {m.actions.map((a, idx) => {
                    const key = `${m.id}:${idx}`;
                    const done = doneKeys.has(key);
                    const running = runningKey === key;
                    return (
                      <div key={key} className="mt-2 max-w-[85%] space-y-2 rounded-xl border border-purple-500/40 bg-purple-500/10 p-3">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <ShieldCheck className="h-4 w-4 text-purple-400" /> {a.label}
                        </p>
                        {a.reason ? <p className="text-xs text-muted-foreground">{a.reason}</p> : null}
                        <div className="flex gap-2">
                          <Button size="sm" className={cn(done && "bg-emerald-600 hover:bg-emerald-600")} disabled={done || running} onClick={() => void runAction(m.id, idx, a)}>
                            {done ? <Check className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}
                            {running ? "Running…" : done ? "Executed" : "Approve & run"}
                          </Button>
                          {!done ? (
                            <Button size="sm" variant="outline" disabled={running} onClick={() => setDoneKeys((prev) => new Set(prev).add(key))}>
                              <X className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            {sending ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
                  Checking your operation…
                </div>
              </div>
            ) : null}
            {actionError ? <p className="text-xs text-red-400">{actionError}</p> : null}
            <div ref={bottomRef} />
          </div>

          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((att) => (
                <div key={att.id} className="relative flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
                  {att.kind === "image" && att.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={att.dataUrl} alt={att.name} className="h-10 w-10 rounded object-cover" />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded bg-primary/10"><FileText className="h-4 w-4 text-primary" /></span>
                  )}
                  <span className="max-w-[120px] truncate text-xs font-medium">{att.name}</span>
                  <button type="button" onClick={() => removeAttachment(att.id)} className="grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white" title="Remove">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,text/*,.doc,.docx,.xls,.xlsx"
              multiple
              hidden
              onChange={(e) => { void onPickFiles(e.target.files); e.target.value = ""; }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="Attach photo or document"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={recording ? "destructive" : "outline"}
              onClick={toggleMic}
              disabled={sending}
              title={recording ? "Stop listening" : "Voice input"}
            >
              {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={recording ? "Listening…" : 'Ask, act, attach, or say "remember…"'}
              disabled={sending}
              className="flex-1"
            />
            <Button type="submit" disabled={sending || (input.trim().length === 0 && attachments.length === 0)}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </>
      ) : tab === "alerts" ? (
        <div className="flex-1 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {(["open", "all"] as const).map((f) => (
                <Button key={f} size="sm" variant={alertFilter === f ? "default" : "outline"} onClick={() => setAlertFilter(f)}>
                  {f === "open" ? `Open (${openCount})` : "All"}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={runWatchdog.isPending}
              onClick={() => runWatchdog.mutate()}
            >
              <Radar className="mr-1.5 h-4 w-4" /> {runWatchdog.isPending ? "Scanning…" : "Scan now"}
            </Button>
          </div>
          {runWatchdog.isSuccess && runWatchdog.data != null ? (
            <p className="text-xs text-muted-foreground">
              Last scan: {runWatchdog.data > 0 ? `${runWatchdog.data} new finding(s) recorded.` : "no new issues found."}
            </p>
          ) : null}

          {shownEvents.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <ShieldCheck className="h-8 w-8 text-emerald-400" />
                <p className="font-semibold">All clear</p>
                <p className="text-sm text-muted-foreground">The watchdog found nothing that needs your attention. Errors and risks show up here automatically.</p>
              </CardContent>
            </Card>
          ) : (
            shownEvents.map((e) => {
              const KindIcon = kindIcon(e.kind);
              const isOpen = e.status === "open";
              return (
                <Card key={e.id} className={cn(isOpen && "border-l-2", isOpen && (e.severity === "critical" || e.severity === "high" ? "border-l-red-400" : "border-l-yellow-400"))}>
                  <CardContent className="space-y-2 py-4">
                    <div className="flex items-start gap-3">
                      <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", SEVERITY_BG[e.severity] ?? "bg-muted")}>
                        <KindIcon className={cn("h-4 w-4", SEVERITY_TEXT[e.severity] ?? "")} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-semibold", !isOpen && "text-muted-foreground")}>{e.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.severity.toUpperCase()} · {e.source === "app_error" ? "app error" : e.source} · {timeAgo(e.created_at)}{!isOpen ? ` · ${e.status}` : ""}
                        </p>
                      </div>
                    </div>
                    {e.body ? <p className="text-sm text-muted-foreground">{e.body}</p> : null}
                    {isOpen ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEventStatus.mutate({ id: e.id, status: "resolved" })}>
                          <Check className="mr-1.5 h-4 w-4 text-emerald-400" /> Resolved
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEventStatus.mutate({ id: e.id, status: "dismissed" })}>
                          <X className="mr-1.5 h-4 w-4" /> Dismiss
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto">
          {isCompany ? (
            <>
              <Card>
                <CardContent className="space-y-3 py-4">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <TrendingDown className="h-4 w-4 text-red-400" /> Dead runs — last 7 days
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border bg-card p-3 text-center">
                      <p className="text-lg font-bold">{(Number(dead?.empty_miles ?? 0) + Number(dead?.deadhead_miles ?? 0)).toFixed(1)} mi</p>
                      <p className="text-xs text-muted-foreground">empty miles</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-3 text-center">
                      <p className="text-lg font-bold text-red-400">${Number(dead?.dead_cost ?? 0).toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">cost</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-3 text-center">
                      <p className="text-lg font-bold text-emerald-400">${Number(dead?.savings_cost ?? 0).toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">saved</p>
                    </div>
                  </div>
                  <Link href="/drayage-company/dead-runs" className="text-sm font-semibold text-primary hover:underline">
                    Open full report ›
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 py-4">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Repeat2 className="h-4 w-4 text-purple-400" /> Street-turn opportunities
                  </p>
                  {streetTurns.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No pairable moves right now. New matches appear as empties head back.</p>
                  ) : (
                    streetTurns.map((s) => (
                      <div key={`${s.provider_order_id}-${s.receiver_order_id}`} className="flex items-center gap-3 border-t border-border pt-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{s.provider_ref} → {s.receiver_ref}</p>
                          <p className="text-xs text-muted-foreground">{s.terminal} · ≈{s.saved_miles ?? 0} mi · ${s.saved_cost ?? 0} saved</p>
                        </div>
                        <Button size="sm" disabled={linkStreetTurn.isPending} onClick={() => linkStreetTurn.mutate({ providerOrderId: s.provider_order_id, receiverOrderId: s.receiver_order_id })}>
                          Pair
                        </Button>
                      </div>
                    ))
                  )}
                  {linkStreetTurn.isError ? <p className="text-xs text-red-400">{(linkStreetTurn.error as Error).message}</p> : null}
                </CardContent>
              </Card>
            </>
          ) : null}

          <Card>
            <CardContent className="space-y-3 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <DollarSign className="h-4 w-4 text-emerald-400" /> Revenue advisor
              </p>
              <p className="text-sm text-muted-foreground">Concrete ways to make (or stop losing) money, based on your live data.</p>
              <Button disabled={ideasLoading} onClick={() => void generateIdeas()}>
                <Sparkles className="mr-1.5 h-4 w-4" /> {ideasLoading ? "Analyzing…" : "Generate suggestions"}
              </Button>
              {ideas ? (
                <div className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed">{ideas}</div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Brain className="h-4 w-4 text-blue-400" /> Memory
              </p>
              <p className="text-sm text-muted-foreground">Facts the copilot keeps across sessions. Say &ldquo;remember …&rdquo; in chat, or add one here.</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const c = memoryDraft.trim();
                  if (!c) return;
                  setMemoryDraft("");
                  addMemory.mutate(c);
                }}
              >
                <Input value={memoryDraft} onChange={(e) => setMemoryDraft(e.target.value)} placeholder="e.g. Always keep two chassis at the yard" className="flex-1" />
                <Button type="submit" variant="outline" disabled={memoryDraft.trim().length === 0 || addMemory.isPending}>
                  <Plus className="h-4 w-4" />
                </Button>
              </form>
              {memories.map((m) => (
                <div key={m.id} className="flex items-center gap-3 border-t border-border pt-3">
                  <p className="flex-1 text-sm">{m.content}</p>
                  <button className="text-muted-foreground transition hover:text-red-400" onClick={() => deleteMemory.mutate(m.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chat history — browse & reopen past conversations */}
      {showHistory ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowHistory(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-xl">
            <div className="flex items-center gap-2 pb-3">
              <History className="h-4 w-4 text-primary" />
              <p className="flex-1 text-base font-semibold">Your conversations</p>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowHistory(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <button
              className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-primary/40 bg-primary/10 p-3 text-left"
              onClick={() => { setShowHistory(false); startNewChat(); }}
            >
              <SquarePen className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">New chat</span>
            </button>
            <div className="max-h-[420px] overflow-y-auto">
              {sessionsQ.isLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
              ) : (sessionsQ.data ?? []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No saved conversations yet.</div>
              ) : (
                (sessionsQ.data as ChatSession[]).map((sesh) => (
                  <button
                    key={sesh.session_id}
                    className={cn(
                      "flex w-full items-center gap-3 border-t border-border py-3 text-left",
                      sesh.session_id === sessionId && "rounded-lg border-t-transparent bg-primary/10 px-2",
                    )}
                    onClick={() => openSession(sesh.session_id)}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">
                      <span className="block truncate text-sm font-medium">{sesh.title || "Chat"}</span>
                      <span className="block text-xs text-muted-foreground">{timeAgo(sesh.last_at)} · {sesh.msg_count} messages</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
